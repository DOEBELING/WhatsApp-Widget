# Changelog

All notable changes to the widget. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/): a new major version (`v3`) may break existing
websites, minor and patch versions within `v2` don't.

## [2.0.0] – unreleased

First public release. v1 was only used on andreas.doebeling.de and needed a PHP backend.

### Added
- Widget as one static file: one `<script>` tag, no backend, no cookies, no external requests before “Send”.
- Configuration with `data-*` attributes or `WhatsAppWidget.init()`.
- Open the chat with the floating button, after a delay, from own links and buttons (`data-wa-open`, with prefilled
  message) or with the JavaScript API (`open`, `close`, `toggle`, `destroy`, `buildUrl`, `proofOfWork`).
- 1–3 welcome messages with typing animation. After 6 seconds (`badgeDelay`) the first message “arrives”:
  badge on the button, one pulse, the message is already in the chat.
- After “Send” the input is locked and “Open WhatsApp” opens the same message again; the conversation
  continues in WhatsApp.
- Events for own analytics: `whatsapp-widget:open`, `:close`, `:send`, `:notify`.
- Light, dark and automatic theme, own colours, German and English texts.
- Keyboard and screen reader support, respects “reduced motion”.
- Optional e-mail notification with the visitor’s phone or WhatsApp number (international, the field starts with
  `+49`, see `countryCode`): hosted service (`data-site-key`) or own PHP script
  (`data-notify-url`), protected by proof of work.
- Configurator with live preview on wa-widget.doebeling.de.
- Versioned URLs: `/v2/` gets fixes automatically, `/v2.0.0/` never changes and can be used with an integrity hash.

[2.0.0]: https://github.com/DOEBELING/WhatsApp-Widget/releases/tag/v2.0.0
