/*
 * Demo helper for the example pages. You do NOT need this on your website.
 *
 * The examples use the placeholder number +49 000 0000000. So that nobody is
 * sent to an invalid WhatsApp chat, this script shows the generated WhatsApp
 * link in a small log instead of opening it. Requests to the PHP add-on are
 * shown instead of sent, too. It also logs all widget events, so you can see
 * what happens and how to use them for your own code.
 */
(() => {
  const PLACEHOLDER_PHONE = '490000000000';

  const script = document.currentScript;
  const log = document.createElement('div');
  log.className = `demo-log ${script && script.dataset.log === 'right' ? 'right' : ''}`;
  log.setAttribute('aria-live', 'polite');

  function write(title, text, url) {
    const entry = document.createElement('div');
    const label = document.createElement('b');
    label.textContent = title;
    entry.append(label, document.createTextNode(` ${text}`));
    if (url) {
      entry.append(document.createElement('br'));
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = url;
      entry.append(link);
    }
    log.prepend(entry);
  }

  const originalOpen = window.open.bind(window);
  window.open = (url, ...args) => {
    if (String(url).includes(PLACEHOLDER_PHONE)) {
      write('window.open', '(demo, not opened) – with your number this would open:', url);
      return null;
    }
    return originalOpen(url, ...args);
  };

  // The examples send no e-mails.
  // Show the request instead of sending it.
  const originalFetch = window.fetch.bind(window);
  window.fetch = (resource, options = {}) => {
    if (String(resource).endsWith('whatsapp-notify.php')) {
      write(`POST ${resource}`, `(demo, not sent) – body: ${String(options.body || '')}`);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return originalFetch(resource, options);
  };

  document.addEventListener('whatsapp-widget:notify', (event) => {
    write('whatsapp-widget:notify', JSON.stringify(event.detail));
  });

  document.addEventListener('whatsapp-widget:open', (event) => {
    write('whatsapp-widget:open', event.detail.auto ? '(auto-open)' : '(by visitor)');
  });
  document.addEventListener('whatsapp-widget:close', () => write('whatsapp-widget:close', ''));
  document.addEventListener('whatsapp-widget:send', (event) => {
    const { message, phone } = event.detail;
    write('whatsapp-widget:send', JSON.stringify(phone ? { message, phone } : message));
  });

  document.addEventListener('DOMContentLoaded', () => document.body.append(log));
})();
