// HTTP checks for the self-hosted PHP script (addons/php/whatsapp-notify.php).
// Runs against a copy with an hourly limit of 3 mails, served by tests/run.mjs.
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const BASE = process.env.WAW_ADDON_BASE;
const URL_LIMITED = `${BASE}/whatsapp-notify.php`;
const ORIGIN = `Origin: ${BASE}`;
const results = [];
const ok = (name) => results.push(`PASS ${name}`);

// Loads the widget in Node to compute proofs of work exactly like the browser.
global.window = { location: { host: 'test' } };
global.document = { currentScript: null, readyState: 'complete', documentElement: {} };
global.navigator = { language: 'en' };
require(path.join(__dirname, '..', 'whatsapp-widget.js'));
const proofOfWork = () => window.WhatsAppWidget.proofOfWork(new URL(BASE).host);

function status(...args) {
  return execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', ...args, URL_LIMITED]).toString();
}
const form = (fields) => Object.entries(fields).flatMap(([k, v]) => ['--data-urlencode', `${k}=${v}`]);
const phone = '+49 176 1234567';

(async () => {
  assert.strictEqual(status('-X', 'POST', ...form({ message: 'hi', phone })), '403');
  assert.strictEqual(status('-X', 'POST', '-H', 'Origin: https://evil.example', ...form({ message: 'hi', phone })), '403');
  ok('403 without or with a foreign Origin');

  assert.strictEqual(status('-H', ORIGIN), '405');
  assert.strictEqual(status('-X', 'OPTIONS', '-H', ORIGIN), '204');
  ok('405 for GET, 204 for OPTIONS');

  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: ' ', phone })), '422');
  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'hi' })), '422');
  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'hi', phone: '123\r\nBcc: x@evil.example' })), '422');
  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'a'.repeat(2001), phone })), '422');
  ok('422 for empty or too long message, missing phone, header injection attempt');

  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'hi', phone })), '403');
  const pow = await proofOfWork();
  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'hi', phone, pow })), '204');
  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'hi', phone, pow })), '403');
  ok('403 without proof of work, 204 with, 403 when reused');

  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'b', phone, pow: await proofOfWork() })), '204');
  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'c', phone, pow: await proofOfWork() })), '204');
  assert.strictEqual(status('-X', 'POST', '-H', ORIGIN, ...form({ message: 'd', phone, pow: await proofOfWork() })), '429');
  ok('429 when the hourly limit is reached');

  console.log(results.join('\n'));
})().catch((e) => { console.error(results.join('\n')); console.error('FAIL', e); process.exit(1); });
