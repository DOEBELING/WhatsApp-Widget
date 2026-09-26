const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Set by tests/run.mjs
const BASE = process.env.WAW_BASE;
const MAIL = process.env.WAW_MAIL;
const SHOTS = process.env.WAW_SHOTS;
const shot = (name) => path.join(SHOTS, name);
const ORIGIN = BASE;
const results = [];
const ok = (name) => results.push(`PASS ${name}`);
const $ = (page, sel) => page.locator(`whatsapp-widget ${sel}`);

(async () => {
  const browser = await chromium.launch();

  // --- End-to-end: widget -> real PHP add-on (built-in server with fake sendmail) ----------
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('status of 404')) errors.push(m.text()); });
    await page.route(`${ORIGIN}/blank`, (r) => r.fulfill({ contentType: 'text/html', body: '<html lang="de"><body><h1>Shop</h1></body></html>' }));
    await page.goto(`${ORIGIN}/blank`);
    await page.addScriptTag({ url: `${ORIGIN}/whatsapp-widget.js` });
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (u) => { window.__opened.push(u); return null; };
      window.__notify = [];
      document.addEventListener('whatsapp-widget:notify', (e) => window.__notify.push(e.detail));
      WhatsAppWidget.init({
        phone: '+49 911 1234567', name: 'Test', typing: false,
        notifyUrl: '/addons/php/whatsapp-notify.php', privacyUrl: '/datenschutz',
      });
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => WhatsAppWidget.open());
    const notice = await $(page, '.waw-notice').innerText();
    assert.ok(notice.startsWith('Vor dem Klick auf „Senden“ wird nichts übertragen. Danach gehen Nachricht und Telefonnummer per E-Mail an uns sowie Nachricht und Kontaktdaten an WhatsApp (Meta).'), notice);
    assert.strictEqual(await $(page, '.waw-phone').getAttribute('required'), '');
    ok('notifyUrl: phone field required by default, add-on privacy notice');

    assert.strictEqual(await $(page, '.waw-phone').inputValue(), '+49 ', 'phone field starts with the country code');
    assert.strictEqual(await $(page, '.waw-phone').getAttribute('placeholder'), 'Telefon-/WhatsApp-Nummer');
    await $(page, '.waw-input').fill('Habt ihr Dinkelbrötchen?');
    assert.ok(await $(page, '.waw-send').isDisabled(), 'required phone missing (only +49) -> disabled');
    assert.strictEqual(await $(page, '.waw-phone').getAttribute('aria-invalid'), 'false');
    for (const invalid of ['abc', '176 1234567']) {
      await $(page, '.waw-phone').fill(invalid);
      assert.strictEqual(await $(page, '.waw-phone').getAttribute('aria-invalid'), 'true', invalid);
      assert.ok(await $(page, '.waw-send').isDisabled(), invalid);
    }
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.evaluate(() => window.__opened.length), 0, 'Enter does not bypass validation');
    ok('required phone: starts with +49, send disabled when missing, invalid or without country code');

    await $(page, '.waw-phone').fill('0176 123 456 78');
    assert.strictEqual(await $(page, '.waw-phone').getAttribute('aria-invalid'), 'false');
    assert.ok(!(await $(page, '.waw-send').isDisabled()));
    await $(page, '.waw-input').focus();
    assert.strictEqual(await $(page, '.waw-phone').inputValue(), '+49 176 123 456 78', 'national number gets the country code');
    await $(page, '.waw-send').click();
    await page.waitForFunction(() => window.__notify.length === 1, null, { timeout: 5000 });
    const notify = await page.evaluate(() => window.__notify[0]);
    assert.deepStrictEqual(notify, { ok: true, status: 204 });
    const opened = await page.evaluate(() => window.__opened[0]);
    assert.strictEqual(opened, 'https://wa.me/499111234567?text=Habt%20ihr%20Dinkelbr%C3%B6tchen%3F');
    ok('send: POST to PHP add-on returns 204, WhatsApp opened with correct URL');

    await page.waitForTimeout(300);
    const mail = fs.readFileSync(MAIL, 'utf8');
    assert.ok(mail.includes('Habt ihr Dinkelbrötchen?'), mail);
    assert.ok(mail.includes('Phone: +49 176 123 456 78'), mail);
    assert.ok(mail.includes('Reply on WhatsApp: https://wa.me/4917612345678'));
    assert.ok(mail.includes(`Page: ${ORIGIN}/blank`));
    ok('mail received with message, phone, reply link and page');
    assert.ok(await $(page, '.waw-phone').isDisabled() && !(await $(page, '.waw-phone').isVisible()), 'phone field locked after "Send"');
    assert.strictEqual((await $(page, '.waw-open').innerText()).trim(), 'WhatsApp öffnen');
    const infos = await $(page, '.waw-bubble.info').allInnerTexts();
    assert.deepStrictEqual(infos, ['WhatsApp wurde in einem neuen Tab ge\u00f6ffnet. Bitte die Nachricht dort absenden.'], infos.join('|'));
    ok('no "has reached us" notice; input and phone locked');
    assert.deepStrictEqual(errors, []);
    ok('no console errors');
  }

  // --- askPhone without notifyUrl is ignored with a warning --------------------------------
  {
    const page = await (await browser.newContext()).newPage();
    const warnings = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    await page.route(`${ORIGIN}/blank`, (r) => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><body></body></html>' }));
    await page.goto(`${ORIGIN}/blank`);
    await page.addScriptTag({ url: `${ORIGIN}/whatsapp-widget.js` });
    await page.evaluate(() => WhatsAppWidget.init({ phone: '+49 911 1234567', askPhone: 'required' }));
    await page.waitForTimeout(100);
    assert.strictEqual(await $(page, '.waw-phone').count(), 0);
    assert.ok(warnings.some((w) => w.includes('"askPhone" needs "notifyUrl"')), warnings.join('\n'));
    ok('askPhone without notifyUrl: no field, warning');
  }

  // --- askPhone false + failing endpoint -----------------------------------------------------
  {
    const page = await (await browser.newContext()).newPage();
    await page.route(`${ORIGIN}/blank`, (r) => r.fulfill({ contentType: 'text/html', body: '<html lang="de"><body></body></html>' }));
    await page.goto(`${ORIGIN}/blank`);
    await page.addScriptTag({ url: `${ORIGIN}/whatsapp-widget.js` });
    await page.evaluate(() => {
      window.open = () => null;
      WhatsAppWidget.init({ phone: '+49 911 1234567', typing: false, notifyUrl: '/does-not-exist.php', askPhone: false });
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => WhatsAppWidget.open());
    assert.strictEqual(await $(page, '.waw-phone').count(), 0);
    const notice = await $(page, '.waw-notice').innerText();
    assert.ok(notice.includes('Danach gehen Nachricht per E-Mail an uns sowie'), notice);
    await $(page, '.waw-input').fill('Test');
    await $(page, '.waw-send').click();
    await page.waitForFunction(() => document.querySelector('whatsapp-widget').shadowRoot.querySelectorAll('.waw-bubble.info').length === 2, null, { timeout: 10000 });
    const infos = await $(page, '.waw-bubble.info').allInnerTexts();
    assert.ok(infos.some((t) => t.startsWith('Die Nachricht konnte nicht an uns übermittelt werden.')), infos.join('|'));
    ok('askPhone false: no field; failed request shows fallback hint');
  }

  // --- Example 4 as on GitHub Pages (demo intercepts the request) ---------------------------
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/examples/04-php-addon.html`);
    await $(page, '.waw-launcher').click();
    await page.waitForFunction(() => document.querySelector('whatsapp-widget').shadowRoot.querySelectorAll('.waw-bubble.in:not([aria-hidden])').length === 2, null, { timeout: 8000 });
    await $(page, '.waw-phone').fill('+49 176 12345678');
    await $(page, '.waw-input').fill('Hello, we need a new logo for our bakery.');
    await page.screenshot({ path: shot('ex4-addon.png') });
    await $(page, '.waw-send').click();
    // The request is sent after the proof of work, which can take a few seconds.
    await page.waitForFunction(() => document.querySelector('.demo-log').textContent.includes('whatsapp-widget:notify'), null, { timeout: 30000 });
    const log = await page.locator('.demo-log').innerText();
    assert.ok(log.includes('POST /whatsapp-notify.php (demo, not sent) – body: message='), log);
    assert.ok(log.includes('phone=%2B49+176+12345678'), log);
    assert.ok(log.includes('whatsapp-widget:notify {"ok":true,"status":204}'), log);
    ok('example 4: demo shows request body, notify event');
    await page.mouse.move(10, 400);
    await page.waitForTimeout(200);
    await page.screenshot({ path: shot('ex4-sent.png') });
    assert.deepStrictEqual(errors, []);
  }

  await browser.close();
  console.log(results.join('\n'));
})().catch((e) => { console.error(results.join('\n')); console.error('FAIL', e); process.exit(1); });
