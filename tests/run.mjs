// Starts PHP's built-in web server with a test configuration and a fake sendmail,
// then runs all browser and HTTP tests. Usage: npm test (in this directory).
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS, '..');
const PORT = 8767;
const ADDON_PORT = 8766;
const BASE = `http://127.0.0.1:${PORT}`;
const ADDON_BASE = `http://127.0.0.1:${ADDON_PORT}`;
const SUITES = ['widget.test.cjs', 'addon.test.cjs', 'addon-http.test.cjs', 'service.test.cjs', 'build.test.cjs'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waw-test-'));
const mail = path.join(tmp, 'mail.txt');
const shots = process.env.WAW_SHOTS || path.join(tmp, 'shots');
for (const dir of ['storage', 'php-tmp', 'addon']) fs.mkdirSync(path.join(tmp, dir));
fs.mkdirSync(shots, { recursive: true });
fs.writeFileSync(mail, '');

// Configuration of the hosted service; low limit per key so the test can reach it.
fs.writeFileSync(path.join(tmp, 'config.php'), `<?php
return [
    'secret' => '${randomBytes(32).toString('base64')}',
    'base_url' => '${BASE}',
    'sender' => 'notify@whatsapp-widget.test',
    'sender_name' => 'WhatsApp Widget',
    'storage_dir' => ${JSON.stringify(path.join(tmp, 'storage'))},
    'dpa_url' => '${BASE}/dpa.html',
    'dpa_version' => 'test',
    'pow_bits' => 18,
    'max_message_length' => 2000,
    'default_country_code' => '49',
    'limits' => [
        'notify_per_key_hour' => 5, 'notify_per_key_day' => 100, 'notify_per_ip_hour' => 50, 'notify_global_hour' => 1000,
        'register_per_ip_hour' => 20, 'register_per_email_day' => 10, 'register_global_hour' => 100,
    ],
];
`);

// Copy of the self-hosted script with an hourly limit of 3 for the HTTP checks.
const addon = fs.readFileSync(path.join(ROOT, 'addons/php/whatsapp-notify.php'), 'utf8');
fs.writeFileSync(path.join(tmp, 'addon/whatsapp-notify.php'), addon.replace(/'max_mails_per_hour' => \d+/, "'max_mails_per_hour' => 3"));

const phpArgs = [
  '-d', `sendmail_path=cat >> ${mail}`,
  '-d', `sys_temp_dir=${path.join(tmp, 'php-tmp')}`,
  '-d', 'display_errors=0',
];
const servers = [
  spawn('php', [...phpArgs, '-S', `127.0.0.1:${PORT}`, '-t', ROOT], {
    env: { ...process.env, WAW_CONFIG: path.join(tmp, 'config.php') }, stdio: 'ignore',
  }),
  spawn('php', [...phpArgs, '-S', `127.0.0.1:${ADDON_PORT}`, '-t', path.join(tmp, 'addon')], { stdio: 'ignore' }),
];

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url, { method: 'OPTIONS' })).status > 0) return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server not reachable: ${url}`);
}

function run(file) {
  fs.writeFileSync(mail, '');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(TESTS, file)], {
      env: { ...process.env, WAW_BASE: BASE, WAW_ADDON_BASE: ADDON_BASE, WAW_MAIL: mail, WAW_SHOTS: shots },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

let failed = [];
try {
  execFileSync('php', ['-r', 'exit(function_exists("sodium_crypto_secretbox") ? 0 : 1);']);
  await waitFor(`${BASE}/whatsapp-widget.js`);
  await waitFor(`${ADDON_BASE}/whatsapp-notify.php`);
  for (const suite of SUITES) {
    console.log(`\n=== ${suite}`);
    if (!(await run(suite))) failed.push(suite);
  }
} catch (error) {
  console.error(error.message);
  failed.push('setup');
} finally {
  servers.forEach((server) => server.kill());
  if (!process.env.WAW_SHOTS) fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : '\nAll tests passed.');
process.exit(failed.length ? 1 : 0);
