/*!
 * WhatsApp Widget v0.2.0-draft
 * https://github.com/DOEBELING/WhatsApp-Widget
 * License: GPL-3.0-or-later
 *
 * Looks like a live chat, but only opens WhatsApp (app or web) with a
 * prefilled message. No backend, no cookies, no tracking, no external requests.
 * Optional: e-mail notification via the hosted service (data-site-key) or your
 * own server (data-notify-url, see addons/php/).
 *
 * WhatsApp icon: Font Awesome Free 6 by @fontawesome - https://fontawesome.com
 * License: CC BY 4.0 - https://fontawesome.com/license/free
 */
(() => {
  'use strict';

  const VERSION = '0.2.0-draft';
  const LOG_PREFIX = '[WhatsAppWidget]';
  const EVENT_PREFIX = 'whatsapp-widget:';
  const MAX_WELCOME_MESSAGES = 3;
  const HOSTED_NOTIFY_URL = 'https://whatsapp-widget.doebeling.dev/api/notify.php';
  const POW_BITS = 18;          // proof of work for notifications, see proofOfWork()
  const POW_MAX_AGE = 600;      // seconds; the server accepts proofs up to 15 minutes old

  const DEFAULTS = {
    phone: '',            // required, international format, e.g. '+49 911 1234567'
    name: '',             // contact name in the header
    avatar: '',           // image URL; empty = initials
    status: '',           // text below the name, e.g. 'Usually replies within a day'
    welcome: [],          // 1-3 welcome messages
    placeholder: '',      // empty = localised default
    lang: '',             // 'de' | 'en'; empty = <html lang>, fallback 'en'
    position: 'right',    // 'right' | 'left'
    launcher: true,       // show the floating button
    badge: true,          // show an unread badge on the launcher when the first welcome message "arrives"
    badgeDelay: 6,        // seconds until the first welcome message arrives (badge and one pulse)
    autoOpen: false,      // false | seconds until the chat opens by itself
    target: 'auto',       // 'auto' (wa.me) | 'web' (WhatsApp Web) | 'app' (whatsapp://)
    theme: 'light',       // 'light' | 'dark' | 'auto'
    color: '',            // primary colour for header, launcher and send button
    privacyNotice: null,  // null = localised default, '' = hide
    privacyUrl: '',       // link to your privacy policy
    typing: true,         // "typing..." animation before welcome messages
    siteKey: '',          // site key of the hosted e-mail notification (from the configurator)
    notifyUrl: '',        // own endpoint that receives the message (see addons/php/); set by siteKey
    askPhone: null,       // 'required' | 'optional' | false - visitor's number; default 'required' with notifyUrl
    countryCode: '+49',   // the phone field starts with this country code; numbers need one
  };

  // Non-ASCII characters are written as \u escapes, so the texts also work on
  // websites that don't use UTF-8 (the script inherits the page's encoding).
  const I18N = {
    en: {
      open: 'Open WhatsApp chat',
      close: 'Close chat',
      placeholder: 'Type a message',
      inputLabel: 'Message',
      send: 'Send',
      typing: 'typing\u2026',
      privacy: 'Nothing is transmitted before you click \u201cSend\u201d. After that, your message and contact details go to WhatsApp (Meta).',
      privacyLink: 'Privacy policy',
      opened: 'WhatsApp has been opened in a new tab. Please send your message there.',
      openWhatsApp: 'Open WhatsApp',
      locked: 'Continue in WhatsApp',
      unread: (n) => `${n} unread message${n === 1 ? '' : 's'}`,
      privacyNotify: (askPhone) => `Nothing is transmitted before you click \u201cSend\u201d. After that, your message${{ required: ' and phone number', optional: ' and phone number (if given)' }[askPhone] || ''} go${askPhone ? '' : 'es'} to us by e-mail, and your message and contact details go to WhatsApp (Meta).`,
      phoneLabel: 'Your phone/WhatsApp number',
      phoneOptional: 'Your phone/WhatsApp number (optional)',
      notifyFailed: 'Your message could not be sent to us. Please send it in WhatsApp.',
    },
    de: {
      open: 'WhatsApp-Chat \u00f6ffnen',
      close: 'Chat schlie\u00dfen',
      placeholder: 'Nachricht schreiben',
      inputLabel: 'Nachricht',
      send: 'Senden',
      typing: 'schreibt \u2026',
      privacy: 'Vor dem Klick auf \u201eSenden\u201c wird nichts \u00fcbertragen. Danach gehen Nachricht und Kontaktdaten an WhatsApp (Meta).',
      privacyLink: 'Datenschutzerkl\u00e4rung',
      opened: 'WhatsApp wurde in einem neuen Tab ge\u00f6ffnet. Bitte die Nachricht dort absenden.',
      openWhatsApp: 'WhatsApp \u00f6ffnen',
      locked: 'Weiter in WhatsApp',
      unread: (n) => `${n} ungelesene Nachricht${n === 1 ? '' : 'en'}`,
      privacyNotify: (askPhone) => `Vor dem Klick auf \u201eSenden\u201c wird nichts \u00fcbertragen. Danach gehen Nachricht${{ required: ' und Telefonnummer', optional: ' und ggf. Telefonnummer' }[askPhone] || ''} per E-Mail an uns sowie Nachricht und Kontaktdaten an WhatsApp (Meta).`,
      phoneLabel: 'Telefon-/WhatsApp-Nummer',
      phoneOptional: 'Telefon-/WhatsApp-Nummer (optional)',
      notifyFailed: 'Die Nachricht konnte nicht an uns \u00fcbermittelt werden. Bitte in WhatsApp absenden.',
    },
  };

  const ICONS = {
    whatsapp: '<svg viewBox="0 0 448 512" aria-hidden="true" focusable="false"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.1 15 12 3.4 13.9z"/></svg>',
    ticks: '<svg viewBox="0 0 16 11" aria-hidden="true" focusable="false"><path d="M11.1.6 4.9 7.9 2.3 5.4l-.9.9 3.5 3.5L12 1.5zM15.1.6 8.9 7.9l-.6-.6-.9 1 1.5 1.5L16 1.5z"/></svg>',
  };

  const STYLES = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }

    .waw {
      --_primary: var(--waw-color, #075e54);
      --_launcher: var(--waw-launcher-color, var(--waw-color, #25d366));
      --_header-fg: var(--waw-header-text, #fff);
      --_chat-bg: var(--waw-chat-bg, #efeae2);
      --_panel-bg: var(--waw-panel-bg, #f0f2f5);
      --_bubble-in: var(--waw-bubble-in, #fff);
      --_bubble-out: var(--waw-bubble-out, #d9fdd3);
      --_input-bg: var(--waw-input-bg, #fff);
      --_notice-bg: var(--waw-notice-bg, #ffeecd);
      --_text: var(--waw-text, #111b21);
      --_muted: var(--waw-muted, #667781);
      --_offset: var(--waw-offset, 20px);
      position: fixed;
      bottom: var(--_offset);
      right: var(--_offset);
      z-index: var(--waw-z-index, 2147483000);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
      font: 14px/1.4 var(--waw-font, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      color: var(--_text);
      -webkit-font-smoothing: antialiased;
    }
    .waw[data-position="left"] { right: auto; left: var(--_offset); align-items: flex-start; }

    .waw[data-theme="dark"] {
      --_primary: var(--waw-color, #202c33);
      --_chat-bg: var(--waw-chat-bg, #0b141a);
      --_panel-bg: var(--waw-panel-bg, #202c33);
      --_bubble-in: var(--waw-bubble-in, #202c33);
      --_bubble-out: var(--waw-bubble-out, #005c4b);
      --_input-bg: var(--waw-input-bg, #2a3942);
      --_notice-bg: var(--waw-notice-bg, #182229);
      --_text: var(--waw-text, #e9edef);
      --_muted: var(--waw-muted, #8696a0);
    }
    @media (prefers-color-scheme: dark) {
      .waw[data-theme="auto"] {
        --_primary: var(--waw-color, #202c33);
        --_chat-bg: var(--waw-chat-bg, #0b141a);
        --_panel-bg: var(--waw-panel-bg, #202c33);
        --_bubble-in: var(--waw-bubble-in, #202c33);
        --_bubble-out: var(--waw-bubble-out, #005c4b);
      --_input-bg: var(--waw-input-bg, #2a3942);
        --_notice-bg: var(--waw-notice-bg, #182229);
        --_text: var(--waw-text, #e9edef);
        --_muted: var(--waw-muted, #8696a0);
      }
    }

    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible, textarea:focus-visible, a:focus-visible {
      outline: 2px solid var(--_launcher);
      outline-offset: 2px;
    }
    .waw-sr {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }

    /* Chat window */
    .waw-window {
      display: flex;
      flex-direction: column;
      width: min(360px, calc(100vw - 2 * var(--_offset)));
      height: min(520px, calc(100vh - 120px));
      height: min(520px, calc(100dvh - 120px));
      overflow: hidden;
      background: var(--_chat-bg);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(11, 20, 26, .28), 0 2px 8px rgba(11, 20, 26, .16);
      opacity: 0;
      transform: translateY(16px) scale(.96);
      transform-origin: bottom right;
      transition: opacity .2s ease, transform .2s ease;
    }
    .waw[data-position="left"] .waw-window { transform-origin: bottom left; }
    .waw-window.is-open { opacity: 1; transform: none; }

    .waw-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 8px 12px 14px;
      background: var(--_primary);
      color: var(--_header-fg);
    }
    .waw-avatar {
      flex: 0 0 40px;
      width: 40px; height: 40px;
      border-radius: 50%;
      overflow: hidden;
      display: grid; place-items: center;
      background: rgba(255, 255, 255, .2);
      font-weight: 600;
      font-size: 15px;
      letter-spacing: .02em;
    }
    .waw-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .waw-avatar svg { width: 22px; height: 22px; fill: currentColor; }
    .waw-contact { flex: 1; min-width: 0; }
    .waw-name { font-weight: 600; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .waw-status { font-size: 13px; line-height: 1.3; opacity: .85; min-height: 1.3em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .waw-status:empty { display: none; } /* no status line: the name is centred */
    .waw-close {
      flex: 0 0 40px; width: 40px; height: 40px;
      display: grid; place-items: center;
      border: 0; border-radius: 50%;
      background: transparent;
      color: var(--_header-fg);
    }
    .waw-close:hover { background: rgba(255, 255, 255, .15); }
    .waw-close svg { width: 22px; height: 22px; fill: currentColor; }

    /* Messages */
    .waw-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      overscroll-behavior: contain;
    }
    .waw-notice {
      align-self: center;
      max-width: 92%;
      margin: 0 0 8px;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--_notice-bg);
      color: var(--_muted);
      font-size: 12.5px;
      text-align: center;
      box-shadow: 0 1px .5px rgba(11, 20, 26, .13);
    }
    .waw-notice a { color: inherit; }
    .waw-bubble {
      position: relative;
      max-width: 85%;
      padding: 6px 8px 8px 10px;
      border-radius: 8px;
      background: var(--_bubble-in);
      box-shadow: 0 1px .5px rgba(11, 20, 26, .13);
      white-space: pre-line;
      overflow-wrap: anywhere;
      animation: waw-pop .18s ease-out;
    }
    .waw-bubble.in { align-self: flex-start; border-top-left-radius: 0; }
    .waw-bubble.out { align-self: flex-end; border-top-right-radius: 0; background: var(--_bubble-out); }
    .waw-bubble.in::before, .waw-bubble.out::before {
      content: "";
      position: absolute;
      top: 0;
      width: 8px; height: 12px;
      background: inherit;
    }
    .waw-bubble.in::before { left: -8px; clip-path: polygon(0 0, 100% 0, 100% 100%); }
    .waw-bubble.out::before { right: -8px; clip-path: polygon(0 0, 100% 0, 0 100%); }
    .waw-meta {
      float: right;
      margin: 6px 0 -4px 12px;
      font-size: 11px;
      color: var(--_muted);
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .waw-meta svg { width: 16px; height: 11px; fill: #53bdeb; }
    .waw-bubble.info { align-self: center; background: var(--_notice-bg); color: var(--_muted); font-size: 12.5px; text-align: center; }
    .waw-bubble.info::before { display: none; }
    .waw-bubble.info a { color: inherit; font-weight: 600; }

    .waw-dots { display: inline-flex; gap: 4px; padding: 4px 2px; }
    .waw-dots span {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--_muted);
      animation: waw-blink 1.2s infinite ease-in-out both;
    }
    .waw-dots span:nth-child(2) { animation-delay: .15s; }
    .waw-dots span:nth-child(3) { animation-delay: .3s; }

    /* Composer */
    .waw-composer {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;
      padding: 8px 10px 10px;
      background: var(--_panel-bg);
    }
    .waw-phone {
      flex: 1 0 100%;
      height: 38px;
      padding: 0 14px;
      border: 0;
      border-radius: 19px;
      background: var(--_input-bg);
      color: var(--_text);
      font: inherit;
      font-size: 14px;
      outline: none;
    }
    .waw-phone::placeholder { color: var(--_muted); }
    .waw-phone[aria-invalid="true"] { box-shadow: inset 0 0 0 2px #e53935; }
    .waw-input {
      flex: 1;
      min-height: 42px;
      max-height: 120px;
      padding: 10px 14px;
      border: 0;
      border-radius: 21px;
      background: var(--_input-bg);
      color: var(--_text);
      font: inherit;
      font-size: 15px;
      line-height: 22px;
      resize: none;
      outline: none;
    }
    .waw-input::placeholder { color: var(--_muted); }
    .waw-locked {
      flex: 1;
      min-width: 0;
      height: 42px;
      padding: 10px 14px;
      border-radius: 21px;
      background: var(--_input-bg);
      color: var(--_muted);
      font-size: 15px;
      line-height: 22px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .waw-send {
      flex: 0 0 42px; width: 42px; height: 42px;
      display: grid; place-items: center;
      border: 0; border-radius: 50%;
      background: var(--_launcher);
      color: #fff;
      transition: opacity .15s ease, transform .15s ease;
    }
    .waw-send svg { width: 20px; height: 20px; fill: currentColor; margin-left: 2px; }
    .waw-send:disabled { opacity: .45; cursor: default; }
    .waw-send:not(:disabled):hover { transform: scale(1.06); }
    .waw-open {
      flex: 0 0 auto;
      height: 42px;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 0 14px;
      border: 0; border-radius: 21px;
      background: var(--_launcher);
      color: #fff;
      font-size: 14px; font-weight: 600;
      white-space: nowrap;
    }
    .waw-open svg { width: 18px; height: 18px; fill: currentColor; }
    .waw-open:hover { filter: brightness(1.06); }

    /* Launcher */
    .waw-launcher {
      position: relative;
      width: 60px; height: 60px;
      display: grid; place-items: center;
      border: 0; border-radius: 50%;
      background: var(--_launcher);
      color: #fff;
      box-shadow: 0 6px 20px rgba(11, 20, 26, .3);
      transition: transform .2s ease;
    }
    .waw-launcher:hover { transform: scale(1.06); }
    .waw-launcher.is-pulsing { animation: waw-pulse .8s ease-out; }
    .waw-ring {
      position: absolute; inset: 0;
      border: 3px solid var(--_launcher);
      border-radius: 50%;
      opacity: 0;
      pointer-events: none;
    }
    .waw-launcher.is-pulsing .waw-ring { animation: waw-ring .8s ease-out; }
    .waw-launcher svg { width: 32px; height: 32px; fill: currentColor; }
    .waw-launcher .waw-icon-close { display: none; }
    .waw-launcher[aria-expanded="true"] .waw-icon-open { display: none; }
    .waw-launcher[aria-expanded="true"] .waw-icon-close { display: grid; }
    .waw-badge {
      position: absolute;
      top: -2px; right: -2px;
      min-width: 22px; height: 22px;
      padding: 0 6px;
      border-radius: 11px;
      background: #e53935;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      line-height: 22px;
      text-align: center;
      box-shadow: 0 0 0 2px #fff;
      animation: waw-pop .2s ease-out;
    }

    @keyframes waw-pop { from { opacity: 0; transform: translateY(4px); } }
    @keyframes waw-blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
    @keyframes waw-pulse { 35% { transform: scale(1.12); } }
    @keyframes waw-ring { from { opacity: .7; transform: scale(1); } to { opacity: 0; transform: scale(1.6); } }

    @media (prefers-reduced-motion: reduce) {
      .waw-window, .waw-launcher, .waw-send { transition: none; }
      .waw-bubble, .waw-badge, .waw-launcher.is-pulsing, .waw-launcher.is-pulsing .waw-ring { animation: none; }
      .waw-dots span { animation: none; opacity: .6; }
    }
  `;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value; // only used for our own static icons
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  function toBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
  }

  function toSeconds(value) {
    if (value === undefined || value === null || value === false || value === '') return false;
    if (value === true) return 0;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : false;
  }

  /**
   * Normalises a phone number to the digits-only international format that
   * WhatsApp expects ("+49 (0) 911 12 34-5" -> "49911123345").
   */
  function normalizePhone(value) {
    let phone = String(value || '').replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
    if (phone.startsWith('+')) phone = phone.slice(1);
    else if (phone.startsWith('00')) phone = phone.slice(2);
    else if (phone.startsWith('0')) {
      console.error(`${LOG_PREFIX} "phone" must be in international format, e.g. "+49 911 1234567" instead of "0911 1234567".`);
      return '';
    }
    phone = phone.replace(/\D/g, '');
    if (phone.length < 7 || phone.length > 15) {
      console.error(`${LOG_PREFIX} "phone" is missing or invalid: "${value}".`);
      return '';
    }
    return phone;
  }

  /**
   * Brings the visitor's number into international format: "0049 176 ..." and
   * "0176 ..." become "+49 176 ..." (with the configured country code), and the
   * leading 0 in "+49 0176 ..." is dropped.
   */
  function normalizeVisitorPhone(value, countryCode) {
    let phone = String(value || '').trim().replace(/\(0\)/g, '').replace(/\s+/g, ' ');
    if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
    else if (phone.startsWith('0')) phone = `${countryCode} ${phone.slice(1)}`;
    if (phone.startsWith(countryCode)) {
      phone = phone.replace(new RegExp(`^\\${countryCode}[\\s./-]*0(?=\\d)`), `${countryCode} `);
    }
    return phone;
  }

  /** The visitor's number must be international: "+", country code, 8-15 digits. */
  function isPlausiblePhone(value) {
    const digits = value.replace(/\D/g, '');
    return /^\+[1-9][\d\s()./-]*$/.test(value) && digits.length >= 8 && digits.length <= 15;
  }

  // SHA-256 (FIPS 180-4) for the proof of work. crypto.subtle is async per hash
  // and far too slow for hundreds of thousands of small hashes.
  const SHA256_K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const SHA256_INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  /** Processes one 64-byte block (bytes[offset..offset+63]) into state. */
  function sha256Block(state, bytes, offset, w) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)))
        + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)))
        + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
    state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
  }

  /** Pads the message and hashes all remaining blocks, starting from state after `done` bytes. */
  function sha256Finish(state, bytes, done, totalLength, w) {
    const rest = bytes.length - done;
    const padded = new Uint8Array(rest + 9 <= 64 ? 64 : 128);
    padded.set(bytes.subarray(done));
    padded[rest] = 0x80;
    const bits = totalLength * 8;
    const end = padded.length;
    padded[end - 5] = Math.floor(bits / 2 ** 32) & 0xff;
    padded[end - 4] = (bits >>> 24) & 0xff;
    padded[end - 3] = (bits >>> 16) & 0xff;
    padded[end - 2] = (bits >>> 8) & 0xff;
    padded[end - 1] = bits & 0xff;
    for (let offset = 0; offset < end; offset += 64) sha256Block(state, padded, offset, w);
    return state;
  }

  function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const state = SHA256_INIT.slice();
    const w = new Int32Array(64);
    const full = bytes.length - (bytes.length % 64);
    for (let offset = 0; offset < full; offset += 64) sha256Block(state, bytes, offset, w);
    sha256Finish(state, bytes.subarray(0, bytes.length), full, bytes.length, w);
    return state.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  /**
   * Proof of work against automated abuse of the e-mail notification (hashcash):
   * finds a number so that sha256("waw1:<time>:<sha256(scope)>:<number>") starts with
   * `bits` zero bits. Takes about a second, runs while the visitor types, sends nothing.
   */
  async function proofOfWork(scope, bits = POW_BITS) {
    const time = Math.floor(Date.now() / 1000);
    const prefix = new TextEncoder().encode(`waw1:${time}:${sha256Hex(scope)}:`);
    const full = prefix.length - (prefix.length % 64);
    const w = new Int32Array(64);
    const midstate = SHA256_INIT.slice();
    for (let offset = 0; offset < full; offset += 64) sha256Block(midstate, prefix, offset, w);
    const tail = prefix.subarray(full);
    const buffer = new Uint8Array(tail.length + 16);
    buffer.set(tail);
    const mask = bits >= 32 ? -1 : ~(-1 >>> bits);
    // Random start, so visitors of the same site don't find the same (one-time) proof in the same second.
    const start = Math.floor(Math.random() * 2 ** 40);
    for (let nonce = start; ; nonce++) {
      const digits = String(nonce);
      for (let i = 0; i < digits.length; i++) buffer[tail.length + i] = digits.charCodeAt(i);
      const message = buffer.subarray(0, tail.length + digits.length);
      const state = sha256Finish(midstate.slice(), message, 0, full + message.length, w);
      if ((state[0] & mask) === 0 && (bits <= 32 || state[1] >>> (64 - bits) === 0)) {
        return `${time}:${nonce}`;
      }
      if ((nonce - start) % 20000 === 19999) await sleep(0); // keep the page responsive
    }
  }

  function buildUrl(phone, text, target) {
    const message = encodeURIComponent(text || '');
    switch (target) {
      case 'web':
        return `https://web.whatsapp.com/send?phone=${phone}&text=${message}`;
      case 'app':
        return `whatsapp://send?phone=${phone}&text=${message}`;
      default:
        return `https://wa.me/${phone}${message ? `?text=${message}` : ''}`;
    }
  }

  function detectLanguage(preferred) {
    const candidates = [preferred, document.documentElement.lang, navigator.language];
    for (const candidate of candidates) {
      const lang = String(candidate || '').slice(0, 2).toLowerCase();
      if (I18N[lang]) return lang;
    }
    return 'en';
  }

  function initials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('');
  }

  function readScriptConfig(script) {
    if (!script || !script.dataset) return null;
    const data = script.dataset;
    if (!data.phone) return null;
    return {
      phone: data.phone,
      name: data.name,
      avatar: data.avatar,
      status: data.status,
      welcome: data.welcome ? data.welcome.split('|') : undefined,
      placeholder: data.placeholder,
      lang: data.lang,
      position: data.position,
      launcher: data.launcher,
      badge: data.badge,
      badgeDelay: data.badgeDelay,
      autoOpen: data.autoOpen,
      target: data.target,
      theme: data.theme,
      color: data.color,
      privacyNotice: data.privacyNotice,
      privacyUrl: data.privacyUrl,
      typing: data.typing,
      siteKey: data.siteKey,
      notifyUrl: data.notifyUrl,
      askPhone: data.askPhone,
      countryCode: data.countryCode,
    };
  }

  function normalizeConfig(input) {
    const raw = {};
    for (const [key, value] of Object.entries(input || {})) {
      if (value !== undefined) raw[key] = value;
    }
    const config = { ...DEFAULTS, ...raw };

    config.phone = normalizePhone(config.phone);
    config.welcome = [].concat(config.welcome || [])
      .map((message) => String(message).trim())
      .filter(Boolean);
    if (config.welcome.length > MAX_WELCOME_MESSAGES) {
      console.warn(`${LOG_PREFIX} Only the first ${MAX_WELCOME_MESSAGES} welcome messages are shown.`);
      config.welcome = config.welcome.slice(0, MAX_WELCOME_MESSAGES);
    }
    config.lang = detectLanguage(config.lang);
    config.position = config.position === 'left' ? 'left' : 'right';
    config.launcher = toBoolean(config.launcher, true);
    config.badge = toBoolean(config.badge, true);
    config.badgeDelay = toSeconds(config.badgeDelay);
    if (config.badgeDelay === false) config.badgeDelay = DEFAULTS.badgeDelay;
    config.typing = toBoolean(config.typing, true);
    config.autoOpen = toSeconds(config.autoOpen);
    config.target = ['web', 'app'].includes(config.target) ? config.target : 'auto';
    config.theme = ['dark', 'auto'].includes(config.theme) ? config.theme : 'light';
    if (config.siteKey && !config.notifyUrl) config.notifyUrl = HOSTED_NOTIFY_URL;
    if (config.askPhone === null || config.askPhone === undefined || config.askPhone === '') {
      config.askPhone = config.notifyUrl ? 'required' : false; // a message without a number can't be answered
    }
    config.askPhone = ['optional', 'required'].includes(config.askPhone) ? config.askPhone : false;
    const countryCode = String(config.countryCode || '').replace(/\D/g, '');
    config.countryCode = /^[1-9]\d{0,2}$/.test(countryCode) ? `+${countryCode}` : DEFAULTS.countryCode;
    if (config.askPhone && !config.notifyUrl) {
      console.warn(`${LOG_PREFIX} "askPhone" needs "notifyUrl", otherwise nobody receives the number. Ignored.`);
      config.askPhone = false;
    }
    if (config.notifyUrl && !config.privacyUrl) {
      console.warn(`${LOG_PREFIX} With "notifyUrl" the message is sent to your server. Please set "privacyUrl".`);
    }
    return config;
  }

  // ---------------------------------------------------------------------------
  // Widget
  // ---------------------------------------------------------------------------

  class Widget {
    constructor(config) {
      this.config = config;
      this.t = I18N[config.lang];
      this.isOpen = false;
      this.welcomePlayed = false;
      this.delivered = 0;   // welcome messages already in the chat before it was opened
      this.locked = false;  // true after "Send": the conversation continues in WhatsApp
      this.timers = [];
      this.returnFocus = null;
      this.onDocumentClick = this.onDocumentClick.bind(this);
      this.render();
      document.addEventListener('click', this.onDocumentClick);
      if (config.autoOpen !== false) this.scheduleAutoOpen(config.autoOpen);
      if (this.launcher && config.badge && config.welcome.length) {
        this.later(() => this.deliverFirstMessage(), config.badgeDelay * 1000);
      }
    }

    render() {
      const { config, t } = this;

      this.host = el('whatsapp-widget');
      if (config.color) this.host.style.setProperty('--waw-color', config.color);
      const root = this.host.attachShadow({ mode: 'open' });
      this.root = root;

      const avatar = el('div', { className: 'waw-avatar', 'aria-hidden': 'true' });
      if (config.avatar) avatar.append(el('img', { src: config.avatar, alt: '' }));
      else if (initials(config.name)) avatar.textContent = initials(config.name);
      else avatar.innerHTML = ICONS.whatsapp;

      this.statusEl = el('div', { className: 'waw-status', text: config.status });
      this.closeButton = el('button', {
        type: 'button', className: 'waw-close', 'aria-label': t.close, html: ICONS.close,
      });

      this.messagesEl = el('div', { className: 'waw-messages', role: 'log', 'aria-live': 'polite' });
      const defaultNotice = config.notifyUrl ? t.privacyNotify(config.askPhone) : t.privacy;
      const notice = config.privacyNotice === null ? defaultNotice : String(config.privacyNotice);
      if (notice) {
        const noticeEl = el('p', { className: 'waw-notice', text: `${notice} ` });
        if (config.privacyUrl) {
          noticeEl.append(el('a', {
            href: config.privacyUrl, target: '_blank', rel: 'noopener', text: t.privacyLink,
          }));
        }
        this.messagesEl.append(noticeEl);
      }

      this.input = el('textarea', {
        id: 'waw-input',
        className: 'waw-input',
        rows: '1',
        placeholder: config.placeholder || t.placeholder,
        enterkeyhint: 'send',
      });
      this.sendButton = el('button', {
        type: 'submit', className: 'waw-send', 'aria-label': t.send, disabled: true, html: ICONS.send,
      });
      this.form = el('form', { className: 'waw-composer' }, [
        el('label', { className: 'waw-sr', for: 'waw-input', text: t.inputLabel }),
        this.input,
        this.sendButton,
      ]);
      if (config.askPhone) {
        const phoneLabel = config.askPhone === 'required' ? t.phoneLabel : t.phoneOptional;
        this.phoneInput = el('input', {
          id: 'waw-phone',
          className: 'waw-phone',
          type: 'tel',
          autocomplete: 'tel',
          inputmode: 'tel',
          placeholder: phoneLabel,
          value: `${config.countryCode} `,
          required: config.askPhone === 'required',
        });
        this.phoneInput.addEventListener('input', () => this.updateComposer());
        this.phoneInput.addEventListener('blur', () => {
          this.phoneInput.value = this.visitorPhone() || `${config.countryCode} `;
          this.updateComposer();
        });
        this.form.prepend(el('label', { className: 'waw-sr', for: 'waw-phone', text: phoneLabel }), this.phoneInput);
      }

      this.window = el('section', {
        className: 'waw-window',
        role: 'dialog',
        'aria-labelledby': 'waw-name',
        hidden: true,
      }, [
        el('header', { className: 'waw-header' }, [
          avatar,
          el('div', { className: 'waw-contact' }, [
            el('div', { className: 'waw-name', id: 'waw-name', text: config.name || 'WhatsApp' }),
            this.statusEl,
          ]),
          this.closeButton,
        ]),
        this.messagesEl,
        this.form,
      ]);

      const wrapper = el('div', {
        className: 'waw',
        'data-position': config.position,
        'data-theme': config.theme,
        lang: config.lang,
      }, [this.window]);

      if (config.launcher) {
        this.launcher = el('button', {
          type: 'button', className: 'waw-launcher', 'aria-label': t.open, 'aria-expanded': 'false',
        }, [
          el('span', { className: 'waw-ring', 'aria-hidden': 'true' }),
          el('span', { className: 'waw-icon-open', html: ICONS.whatsapp }),
          el('span', { className: 'waw-icon-close', html: ICONS.close }),
        ]);
        this.launcher.addEventListener('animationend', (event) => {
          if (event.target === this.launcher) this.launcher.classList.remove('is-pulsing');
        });
        this.launcher.addEventListener('click', () => this.toggle());
        wrapper.append(this.launcher);
      }

      root.append(el('style', { text: STYLES }), wrapper);

      this.closeButton.addEventListener('click', () => this.close());
      this.window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.close();
      });
      this.input.addEventListener('input', () => {
        this.updateComposer();
        if (this.config.notifyUrl && !this.pow) this.startProofOfWork();
      });
      this.input.addEventListener('keydown', (event) => {
        const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !coarsePointer) {
          event.preventDefault();
          this.send();
        }
      });
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.send();
      });

      document.body.append(this.host);
    }

    // Public API ---------------------------------------------------------------

    open(options = {}) {
      if (typeof options.message === 'string' && !this.locked) this.input.value = options.message;
      if (this.isOpen) {
        this.updateComposer();
        if (options.focus !== false) this.focusInput();
        return;
      }
      this.isOpen = true;
      this.returnFocus = document.activeElement;
      this.window.hidden = false;
      this.updateComposer(); // needs a visible textarea to measure its height
      void this.window.offsetWidth; // restart the CSS transition
      this.window.classList.add('is-open');
      if (this.launcher) this.launcher.setAttribute('aria-expanded', 'true');
      if (this.badge) {
        this.badge.remove();
        this.badge = null;
      }
      if (options.focus !== false) this.focusInput();
      if (!this.welcomePlayed) this.playWelcome();
      this.emit('open', { auto: Boolean(options.auto) });
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.window.classList.remove('is-open');
      if (this.launcher) this.launcher.setAttribute('aria-expanded', 'false');
      const hide = () => {
        if (!this.isOpen) this.window.hidden = true;
      };
      if (prefersReducedMotion()) hide();
      else this.later(hide, 200);
      if (this.root.activeElement) {
        const target = this.returnFocus && this.returnFocus !== document.body && this.returnFocus !== this.host
          ? this.returnFocus
          : this.launcher;
        if (target && typeof target.focus === 'function') target.focus();
      }
      this.emit('close');
    }

    toggle(options) {
      if (this.isOpen) this.close();
      else this.open(options);
    }

    destroy() {
      this.timers.forEach(clearTimeout);
      document.removeEventListener('click', this.onDocumentClick);
      this.host.remove();
    }

    // Internals ----------------------------------------------------------------

    send() {
      const message = this.input.value.trim();
      if (!message || this.locked) return;

      if (!this.isComposerValid()) return;

      const url = buildUrl(this.config.phone, message, this.config.target);
      const phone = this.visitorPhone();
      const proceed = this.emit('send', { message, url, phone }, true);
      if (!proceed) return;

      const notifying = this.config.notifyUrl ? this.notify({ message, phone }) : null;

      if (this.config.target === 'app') {
        // Leaving the page could cancel the notification, so wait for it.
        Promise.resolve(notifying).finally(() => this.openWhatsApp(url));
      } else {
        // Open WhatsApp synchronously inside the click/keypress handler,
        // otherwise browsers treat it as an unwanted popup.
        this.openWhatsApp(url);
      }

      this.addBubble('out', message);
      this.lock(url);
      this.addInfo(this.t.opened);
    }

    openWhatsApp(url) {
      if (this.config.target === 'app') window.location.href = url;
      else window.open(url, '_blank', 'noopener');
    }

    // After "Send" the conversation continues in WhatsApp: the input is locked and
    // the send button becomes an "Open WhatsApp" button with the same message.
    lock(url) {
      const hadFocus = [this.input, this.phoneInput].includes(this.root.activeElement);
      this.locked = true;
      this.input.value = '';
      for (const field of [this.input, this.phoneInput]) {
        if (!field) continue;
        field.disabled = true;
        field.hidden = true;
      }
      this.sendButton.hidden = true;
      this.openButton = el('button', { type: 'button', className: 'waw-open' }, [
        el('span', { html: ICONS.whatsapp }),
        el('span', { text: this.t.openWhatsApp }),
      ]);
      this.openButton.addEventListener('click', () => this.openWhatsApp(url));
      this.form.append(
        el('div', { className: 'waw-locked', text: this.t.locked, title: this.t.locked }),
        this.openButton,
      );
      if (hadFocus) this.openButton.focus({ preventScroll: true });
    }

    // The first welcome message "arrives" while the chat is still closed:
    // badge, one pulse of the launcher, and the message is already in the chat.
    deliverFirstMessage() {
      if (this.isOpen || this.welcomePlayed) return;
      this.addBubble('in', this.config.welcome[0]);
      this.delivered = 1;
      this.badge = el('span', { className: 'waw-badge', text: '1' });
      this.badge.append(el('span', { className: 'waw-sr', text: `, ${this.t.unread(1)}` }));
      this.launcher.append(this.badge);
      this.launcher.classList.remove('is-pulsing');
      void this.launcher.offsetWidth; // restart the animation
      this.launcher.classList.add('is-pulsing');
    }

    /**
     * Sends the message to the optional self-hosted endpoint (see addons/php/).
     * Uses a "simple" form POST (no CORS preflight) with keepalive, so the request
     * finishes even if the page navigates to the WhatsApp app. Sends no cookies.
     */
    async notify({ message, phone }) {
      let ok = false;
      let status = 0;
      const claimed = this.startProofOfWork(true);
      this.pow = null; // each proof of work can be used only once; the next message starts a new one
      try {
        const pow = await claimed;
        const body = new URLSearchParams({ message, pow, page: window.location.origin + window.location.pathname });
        if (phone) body.append('phone', phone);
        if (this.config.siteKey) body.append('key', this.config.siteKey);
        const response = await fetch(this.config.notifyUrl, { method: 'POST', body, keepalive: true, credentials: 'omit' });
        // Both the add-on and the hosted service answer 204. A 200 usually means a wrong URL
        // that returns a normal page, so it must not count as delivered.
        ok = response.status === 204;
        status = response.status;
      } catch (error) {
        // network error or blocked request: the visitor gets the hint below
      }
      if (!ok) this.addInfo(this.t.notifyFailed);
      this.emit('notify', { ok, status });
    }

    /** Starts the proof of work (once per message). With `fresh`, replaces a proof that is too old. */
    startProofOfWork(fresh = false) {
      if (fresh && this.pow && Date.now() - this.pow.started > POW_MAX_AGE * 1000) this.pow = null;
      if (!this.pow) {
        this.pow = { started: Date.now(), result: proofOfWork(this.config.siteKey || window.location.host) };
      }
      return this.pow.result;
    }

    addInfo(text) {
      this.messagesEl.append(el('div', { className: 'waw-bubble info', text }));
      this.scrollToBottom();
    }

    isComposerValid() {
      if (this.input.value.trim().length === 0) return false;
      if (!this.phoneInput) return true;
      const phone = this.visitorPhone();
      if (!phone) return this.config.askPhone !== 'required';
      return isPlausiblePhone(phone);
    }

    // The visitor's number in international format; '' if only the country code is filled in.
    visitorPhone() {
      if (!this.phoneInput) return '';
      const phone = normalizeVisitorPhone(this.phoneInput.value, this.config.countryCode);
      return phone === this.config.countryCode ? '' : phone;
    }

    async playWelcome() {
      this.welcomePlayed = true;
      const animate = this.config.typing && !prefersReducedMotion();
      for (const message of this.config.welcome.slice(this.delivered)) {
        if (animate) {
          this.statusEl.textContent = this.t.typing;
          const typing = el('div', { className: 'waw-bubble in', 'aria-hidden': 'true' }, [
            el('span', { className: 'waw-dots' }, [el('span'), el('span'), el('span')]),
          ]);
          this.messagesEl.append(typing);
          this.scrollToBottom();
          await sleep(Math.min(2200, Math.max(900, message.length * 25)));
          typing.remove();
        }
        this.addBubble('in', message);
      }
      this.statusEl.textContent = this.config.status;
    }

    addBubble(direction, text) {
      const time = new Date().toLocaleTimeString(this.config.lang, { hour: '2-digit', minute: '2-digit' });
      const meta = el('span', { className: 'waw-meta' }, [el('span', { text: time })]);
      if (direction === 'out') meta.insertAdjacentHTML('beforeend', ICONS.ticks);
      const bubble = el('div', { className: `waw-bubble ${direction}` }, [
        el('span', { text }),
        meta,
      ]);
      this.messagesEl.append(bubble);
      this.scrollToBottom();
    }

    updateComposer() {
      this.sendButton.disabled = !this.isComposerValid();
      if (this.phoneInput) {
        const phone = this.visitorPhone();
        this.phoneInput.setAttribute('aria-invalid', String(Boolean(phone) && !isPlausiblePhone(phone)));
      }
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(this.input.scrollHeight, 120)}px`;
    }

    focusInput() {
      (this.locked ? this.openButton : this.input).focus({ preventScroll: true });
    }

    scrollToBottom() {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    scheduleAutoOpen(seconds) {
      // Auto-open is skipped on small screens, where the chat would cover the page.
      const smallScreen = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
      if (smallScreen) return;
      this.later(() => {
        if (!this.isOpen) this.open({ focus: false, auto: true });
      }, seconds * 1000);
    }

    onDocumentClick(event) {
      const trigger = event.target.closest && event.target.closest('[data-wa-open]');
      if (!trigger) return;
      event.preventDefault();
      const message = trigger.getAttribute('data-wa-open');
      this.open(message ? { message } : {});
    }

    later(callback, ms) {
      this.timers.push(setTimeout(callback, ms));
    }

    emit(name, detail = {}, cancelable = false) {
      const event = new CustomEvent(EVENT_PREFIX + name, { detail, cancelable });
      return document.dispatchEvent(event);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API and auto-init
  // ---------------------------------------------------------------------------

  let instance = null;

  function whenReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  const api = {
    version: VERSION,
    init(options) {
      const config = normalizeConfig(options);
      if (!config.phone) return null;
      whenReady(() => {
        if (instance) instance.destroy();
        instance = new Widget(config);
      });
      return api;
    },
    open(options) { if (instance) instance.open(options); },
    close() { if (instance) instance.close(); },
    toggle(options) { if (instance) instance.toggle(options); },
    destroy() {
      if (instance) instance.destroy();
      instance = null;
    },
    proofOfWork: (scope, bits) => proofOfWork(String(scope), bits),
    buildUrl(phone, message, target) {
      const normalized = normalizePhone(phone);
      return normalized ? buildUrl(normalized, message, target) : '';
    },
  };

  window.WhatsAppWidget = api;

  const scriptConfig = readScriptConfig(document.currentScript);
  if (scriptConfig) api.init(scriptConfig);
})();
