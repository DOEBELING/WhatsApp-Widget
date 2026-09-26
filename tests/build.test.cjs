// Tests tools/build-site.sh: version folders, versions.json, integrity hashes,
// the version check, and the "pin exact version" option of the configurator.
const { chromium } = require('playwright');
const assert = require('assert');
const { execFileSync, spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8768;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (name) => results.push(`PASS ${name}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waw-build-'));
const repo = path.join(tmp, 'repo');
const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo, stdio: 'pipe' }).toString();
const build = (out) => spawnSync(path.join(repo, 'tools/build-site.sh'), [out], { cwd: repo, encoding: 'utf8' });
const setVersion = (version) => {
  const file = path.join(repo, 'whatsapp-widget.js');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/const VERSION = '[^']+'/, `const VERSION = '${version}'`));
};

let server;
(async () => {
  // A throwaway repository with the current files and two release tags.
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT })
    .toString().split('\0').filter((f) => f && fs.existsSync(path.join(ROOT, f)));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(repo, file));
  }
  fs.chmodSync(path.join(repo, 'tools/build-site.sh'), 0o755);
  git('init', '-q');
  setVersion('2.0.0');
  git('add', '-A');
  git('commit', '-qm', 'Release 2.0.0');
  git('tag', 'v2.0.0');
  setVersion('2.0.1');
  git('commit', '-qam', 'Release 2.0.1');
  git('tag', 'v2.0.1');

  const out = path.join(tmp, 'site');
  const result = build(out);
  assert.strictEqual(result.status, 0, result.stderr);

  const exists = (p) => fs.existsSync(path.join(out, p));
  for (const p of ['index.html', 'whatsapp-widget.js', 'api/notify.php', 'api/.htaccess', 'examples/01-minimal.html', 'LICENSE',
    'v2.0.0/whatsapp-widget.js', 'v2.0.1/whatsapp-widget.js', 'v2/whatsapp-widget.js', 'v2/.htaccess', 'v2.0.0/.htaccess']) {
    assert.ok(exists(p), `missing ${p}`);
  }
  for (const p of ['.github', 'tests', 'tools', 'addons', 'README.md', 'api/config.sample.php', '.gitignore']) {
    assert.ok(!exists(p), `must not be deployed: ${p}`);
  }
  ok('site contains the release folders and no repository-only files');

  const read = (p) => fs.readFileSync(path.join(out, p), 'utf8');
  assert.ok(read('v2.0.0/whatsapp-widget.js').includes("const VERSION = '2.0.0'"));
  assert.ok(read('v2/whatsapp-widget.js').includes("const VERSION = '2.0.1'"), 'v2 = newest 2.x.y');
  assert.ok(read('v2.0.0/.htaccess').includes('immutable') && read('v2.0.0/.htaccess').includes('Access-Control-Allow-Origin'));
  assert.ok(read('v2/.htaccess').includes('max-age=3600'));
  const versions = JSON.parse(read('versions.json'));
  const sri = (p) => `sha384-${crypto.createHash('sha384').update(fs.readFileSync(path.join(out, p))).digest('base64')}`;
  assert.deepStrictEqual(versions, {
    latest: '2.0.1',
    majors: { 2: '2.0.1' },
    versions: {
      '2.0.0': { integrity: sri('v2.0.0/whatsapp-widget.js') },
      '2.0.1': { integrity: sri('v2.0.1/whatsapp-widget.js') },
    },
  });
  ok('v2 points to the newest release; versions.json with correct integrity hashes; cache and CORS headers');

  git('tag', 'v2.0.2'); // VERSION in the file is still 2.0.1
  const mismatch = build(path.join(tmp, 'site-mismatch'));
  assert.notStrictEqual(mismatch.status, 0);
  assert.ok(mismatch.stderr.includes("Tag v2.0.2: whatsapp-widget.js declares VERSION '2.0.1'"), mismatch.stderr);
  ok('build fails if tag and VERSION don\'t match');

  // Browser: configurator and integrity check on the built site.
  server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', out], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/versions.json`)).ok) break; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'de-DE' });
  await page.goto(`${BASE}/?lang=de`);
  await page.waitForSelector('#pin-row:not([hidden])');
  assert.strictEqual(await page.locator('#pin-version').innerText(), '(v2.0.1)');
  let snippet = await page.locator('#snippet').innerText();
  assert.ok(snippet.startsWith('<script src="https://wa-widget.doebeling.de/v2/whatsapp-widget.js"'), snippet);
  await page.check('#f-pin');
  snippet = await page.locator('#snippet').innerText();
  assert.ok(snippet.startsWith(`<script src="https://wa-widget.doebeling.de/v2.0.1/whatsapp-widget.js"\n        integrity="${versions.versions['2.0.1'].integrity}"\n        crossorigin="anonymous"`), snippet);
  ok('configurator: /v2/ by default, exact version with integrity hash when pinned');

  const load = async (src, integrity) => {
    const p = await browser.newPage();
    await p.route(`${BASE}/sri`, (r) => r.fulfill({ contentType: 'text/html', body:
      `<html><body><script src="${src}" integrity="${integrity}" crossorigin="anonymous" data-phone="+49 911 1234567"></script></body></html>` }));
    await p.goto(`${BASE}/sri`);
    const version = await p.evaluate(() => window.WhatsAppWidget && window.WhatsAppWidget.version);
    await p.close();
    return version;
  };
  assert.strictEqual(await load('/v2.0.0/whatsapp-widget.js', versions.versions['2.0.0'].integrity), '2.0.0');
  assert.strictEqual(await load('/v2.0.0/whatsapp-widget.js', versions.versions['2.0.1'].integrity), undefined);
  ok('browser loads the pinned version with the right hash and blocks it with a wrong one');

  await browser.close();
  console.log(results.join('\n'));
})().catch((e) => { console.error(results.join('\n')); console.error('FAIL', e); process.exitCode = 1; })
  .finally(() => {
    if (server) server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
