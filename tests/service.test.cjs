const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Set by tests/run.mjs
const BASE = process.env.WAW_BASE;
const MAIL = process.env.WAW_MAIL;
const SHOTS = process.env.WAW_SHOTS;
const shot = (name) => path.join(SHOTS, name);
const results = [];
const ok = (name) => results.push(`PASS ${name}`);
const $w = (page, sel) => page.locator(`whatsapp-widget ${sel}`);

/** All captured mails, quoted-printable decoded. */
function mails() {
  return fs.readFileSync(MAIL, 'utf8').split(/^(?=To: )/m).filter(Boolean).map((raw) => {
    const [head, ...rest] = raw.split(/\r?\n\r?\n/);
    const qp = rest.join('\n\n').replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < qp.length; i++) {
      if (qp[i] === '=' && /^[0-9A-F]{2}$/.test(qp.substr(i + 1, 2))) { bytes.push(parseInt(qp.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(...Buffer.from(qp[i]));
    }
    return { head, body: Buffer.from(bytes).toString('utf8') };
  });
}

(async () => {
  fs.writeFileSync(MAIL, '');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // --- Configurator: preview and snippet ------------------------------------------------
  // --- Configurator: language ------------------------------------------------------------
  await page.goto(`${BASE}/`);
  assert.strictEqual(await page.locator('h1').innerText(), 'WhatsApp chat for your website', 'browser language en');
  await page.fill('#f-name', 'Keep me');
  await page.click('.lang-switch button[data-lang="de"]');
  assert.strictEqual(await page.locator('h1').innerText(), 'WhatsApp-Chat für deine Website');
  assert.strictEqual(await page.inputValue('#f-name'), 'Keep me', 'input kept');
  assert.strictEqual(await page.inputValue('#f-welcome'), 'Hallo! 👋 Wie können wir helfen?', 'default welcome translated');
  assert.ok(page.url().endsWith('/?lang=de'));
  assert.strictEqual(await page.getAttribute('html', 'lang'), 'de');
  await page.waitForTimeout(500);
  assert.ok((await $w(page, '.waw-notice').innerText()).startsWith('Vor dem Klick'), 'preview follows page language');
  await page.goto(`${BASE}/?lang=en`);
  assert.strictEqual(await page.locator('legend').first().innerText(), 'Your contact');
  ok('configurator: language switch without reload, ?lang=, default texts, preview language');

  await page.goto(`${BASE}/?lang=de`);
  await page.fill('#f-phone', '+49 911 1234567');
  await page.fill('#f-name', 'Bäckerei Test');
  await page.fill('#f-welcome', 'Hallo!\nWie können wir helfen?');
  await page.selectOption('#f-lang', 'de');
  await page.waitForTimeout(500);
  let snippet = await page.locator('#snippet').innerText();
  assert.ok(snippet.includes('data-phone="+49 911 1234567"') && snippet.includes('data-welcome="Hallo!|Wie können wir helfen?"'), snippet);
  assert.strictEqual(await $w(page, '.waw-name').innerText(), 'Bäckerei Test');
  ok('configurator: snippet and live preview follow the form');

  await page.check('input[name="notify"][value="hosted"]');
  await page.waitForTimeout(500);
  assert.strictEqual(await $w(page, '.waw-phone').count(), 1, 'preview shows phone field');
  assert.ok((await $w(page, '.waw-notice').innerText()).includes('per E-Mail an uns'));
  ok('configurator: hosted mode shows phone field and add-on notice in preview');

  // --- Registration (double opt-in) --------------------------------------------------------
  await page.click('#f-register');
  assert.ok((await page.locator('#register-status').innerText()).includes('gültige E-Mail'));
  await page.fill('#f-email', 'owner@example.com');
  await page.fill('#f-domains', `https://${new URL(BASE).host}/, other.example`);
  await page.click('#f-register');
  assert.ok((await page.locator('#register-status').innerText()).includes('Vertrag zur Auftragsverarbeitung'));
  await page.check('#f-dpa');
  await page.click('#f-register');
  await page.waitForFunction(() => document.querySelector('#register-status').textContent.startsWith('Erledigt'), null, { timeout: 15000 });
  ok('configurator: validation, proof of work and registration (202)');

  let all = mails();
  assert.strictEqual(all.length, 1);
  assert.ok(all[0].head.includes('To: owner@example.com'));
  assert.ok(all[0].body.includes(`WhatsApp-Widget auf ${new URL(BASE).host}, other.example`), all[0].body);
  const verifyLink = all[0].body.match(/https?:\/\/\S+\/api\/verify\.php\?t=\S+/)[0];
  ok('verification mail (German, domains, link)');

  // --- Confirmation: GET shows a button only, POST creates the key -------------------------
  await page.goto(verifyLink);
  assert.strictEqual(mails().length, 1, 'GET must not create a key');
  assert.ok((await page.locator('main').innerText()).includes('owner@example.com'));
  assert.strictEqual(await page.locator('button[type="submit"]').innerText(), 'Bestätigen');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/?lang=de`, { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.ok(await page.locator('#setup-success').isVisible());
  assert.ok((await page.locator('#setup-success').innerText()).startsWith('E-Mail-Benachrichtigungen sind aktiv.'));
  snippet = await page.locator('#snippet').innerText();
  const siteKey = snippet.match(/data-site-key="(wwk1_[A-Za-z0-9_-]+)"/)[1];
  assert.ok(snippet.includes('data-name="Bäckerei Test"'), 'options restored');
  assert.strictEqual(await page.inputValue('#f-name'), 'Bäckerei Test');
  ok('confirmation: scanner-safe GET, POST redirects to configurator with key and restored options');
  await page.screenshot({ path: shot('configurator.png'), fullPage: false });

  all = mails();
  assert.strictEqual(all.length, 2);
  assert.ok(all[1].body.includes(`data-site-key="${siteKey}"`), 'key mail contains snippet');
  const revokeLink = all[1].body.match(/https?:\/\/\S+\/api\/revoke\.php\?t=\S+/)[0];
  ok('key mail with ready-made snippet and revoke link');

  await page.goto(verifyLink);
  await page.click('button[type="submit"]');
  assert.strictEqual(await page.locator('h1').innerText(), 'Bereits bestätigt');
  ok('confirmation link works only once');

  // --- Widget with site key -> notify.php ----------------------------------------------------
  const shop = await context.newPage();
  shop.on('pageerror', (e) => errors.push(e.message));
  // The PHP dev server answers unknown paths with index.html, so serve a blank shop page directly.
  await shop.route(`${BASE}/blank-shop`, (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="de"><body><h1>Shop</h1></body></html>' }));
  await shop.goto(`${BASE}/blank-shop`);
  await shop.addScriptTag({ url: `${BASE}/whatsapp-widget.js` });
  await shop.evaluate((key) => {
    window.open = () => null;
    window.__notify = [];
    document.addEventListener('whatsapp-widget:notify', (e) => window.__notify.push(e.detail));
    WhatsAppWidget.init({ phone: '+49 911 1234567', siteKey: key, notifyUrl: '/api/notify.php', typing: false, privacyUrl: '/p' });
  }, siteKey);
  await shop.waitForTimeout(100);
  await shop.evaluate(() => WhatsAppWidget.open());
  await $w(shop, '.waw-input').fill('Habt ihr Dinkelbrötchen?');
  await $w(shop, '.waw-phone').fill('0176 123 456 78');
  await $w(shop, '.waw-send').click();
  await shop.waitForFunction(() => window.__notify.length === 1, null, { timeout: 15000 });
  assert.deepStrictEqual(await shop.evaluate(() => window.__notify[0]), { ok: true, status: 204 });
  all = mails();
  const notification = all[all.length - 1];
  assert.ok(notification.head.includes('To: owner@example.com'));
  assert.ok(notification.body.includes('Habt ihr Dinkelbrötchen?'));
  assert.ok(notification.body.includes('Telefon: +49 176 123 456 78'), notification.body);
  assert.ok(notification.body.includes('Auf WhatsApp antworten: https://wa.me/4917612345678'));
  assert.ok(notification.body.includes(`Diese Benachrichtigungen abschalten: ${BASE}/api/revoke.php?t=`));
  ok('widget with site key: proof of work, notify 204, mail to the owner only');

  // --- Attacks on notify.php -------------------------------------------------------------------
  const post = (headers, form) => shop.evaluate(async ({ headers, form }) => {
    // plain fetch from the page (same origin); Origin header is set by the browser
    const r = await fetch('/api/notify.php', { method: 'POST', body: new URLSearchParams(form), headers });
    return r.status;
  }, { headers, form });
  const pow = () => shop.evaluate((key) => WhatsAppWidget.proofOfWork(key), siteKey);

  assert.strictEqual(await post({}, { key: siteKey, message: 'x', pow: '1:1' }), 403);
  ok('notify without valid proof of work: 403');

  const p1 = await pow();
  assert.strictEqual(await post({}, { key: siteKey, message: 'first', pow: p1 }), 204);
  assert.strictEqual(await post({}, { key: siteKey, message: 'replay', pow: p1 }), 403);
  ok('proof of work can be used only once');

  const tampered = siteKey.slice(0, -4) + (siteKey.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.strictEqual(await post({}, { key: tampered, message: 'x', pow: await pow() }), 403);
  ok('tampered site key: 403');

  const curlStatus = (args) => require('child_process').execSync(`curl -s -o /dev/null -w "%{http_code}" ${args}`).toString();
  assert.strictEqual(curlStatus(`-X POST -H "Origin: https://evil.example" --data-urlencode "key=${siteKey}" -d message=x -d pow=${await pow()} ${BASE}/api/notify.php`), '403');
  ok('foreign origin with valid key and proof of work: 403');

  // rate limit per key (test config: 5 per hour; 2 used so far)
  assert.strictEqual(await post({}, { key: siteKey, message: '4', pow: await pow() }), 204);
  assert.strictEqual(await post({}, { key: siteKey, message: '5', pow: await pow() }), 204);
  assert.strictEqual(await post({}, { key: siteKey, message: '6', pow: await pow() }), 204);
  assert.strictEqual(await post({}, { key: siteKey, message: '7', pow: await pow() }), 429);
  ok('rate limit per site key: 429');

  // --- Register from a foreign origin --------------------------------------------------------
  assert.strictEqual(curlStatus(`-X POST -H "Origin: https://evil.example" -d email=a@b.de -d domains=x.de -d dpa=1 ${BASE}/api/register.php`), '403');
  ok('register from a foreign origin: 403');

  // --- Revoke ----------------------------------------------------------------------------------
  await page.goto(revokeLink);
  await page.click('button[type="submit"]');
  assert.strictEqual(await page.locator('h1').innerText(), 'Benachrichtigungen abgeschaltet');
  assert.strictEqual(await post({}, { key: siteKey, message: 'after revoke', pow: await pow() }), 410);
  ok('revoke link: scanner-safe, afterwards notify returns 410');

  assert.ok(!fs.readFileSync(MAIL, 'utf8').includes('evil.example'), 'no mail to attackers');
  const invalidDe = require('child_process').execSync(`curl -s -H "Accept-Language: de-DE,de;q=0.9" "${BASE}/api/revoke.php?t=wwr1_x"`).toString();
  const invalidEn = require('child_process').execSync(`curl -s "${BASE}/api/verify.php?t=wwv1_x"`).toString();
  assert.ok(invalidDe.includes('<title>Ungültiger Link</title>') && invalidDe.includes('lang="de"'));
  assert.ok(invalidEn.includes('<title>Link expired</title>') && invalidEn.includes('lang="en"'));
  ok('server pages: language from token, otherwise from Accept-Language');
  assert.deepStrictEqual(errors, []);
  ok('no page errors');

  await browser.close();
  console.log(results.join('\n'));
})().catch((e) => { console.error(results.join('\n')); console.error('FAIL', e); process.exit(1); });
