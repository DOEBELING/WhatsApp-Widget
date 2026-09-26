<?php
/**
 * WhatsApp Widget – hosted notification service: shared functions
 * https://github.com/DOEBELING/WhatsApp-Widget
 * License: GPL-3.0-or-later
 *
 * The service never lets a request choose the recipient of a mail. Site owners
 * confirm their address once (double opt-in) and get a site key: their address
 * and allowed domains, encrypted with the server secret. The server stores no
 * addresses; it only keeps short-lived counters for rate limits and a list of
 * revoked keys.
 */

declare(strict_types=1);

if (!defined('WAW_SERVICE')) {
    http_response_code(404);
    exit;
}

ini_set('display_errors', '0');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

const WAW_POW_WINDOW = 900; // seconds a proof of work stays valid
const WAW_TOKEN_PREFIXES = ['key' => 'wwk1_', 'verify' => 'wwv1_', 'revoke' => 'wwr1_'];
const WAW_WIDGET_OPTIONS = [
    'phone', 'name', 'status', 'welcome', 'placeholder', 'lang', 'position', 'launcher',
    'auto-open', 'target', 'theme', 'color', 'privacy-url', 'ask-phone',
];

// ---------------------------------------------------------------------------
// Configuration and responses
// ---------------------------------------------------------------------------

function waw_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    // The configuration belongs outside the web root, next to it.
    $candidates = array_filter([
        getenv('WAW_CONFIG') ?: null,
        dirname(__DIR__, 2) . '/whatsapp-widget-config.php',
        __DIR__ . '/config.php',
    ]);
    foreach ($candidates as $file) {
        if (is_file($file)) {
            $config = require $file;
            break;
        }
    }
    if (!is_array($config)) {
        waw_fail(500, 'The service is not configured.');
    }
    $secret = base64_decode((string) ($config['secret'] ?? ''), true);
    if ($secret === false || strlen($secret) < 32) {
        waw_fail(500, 'The secret in the configuration is missing or too short.');
    }
    if (!function_exists('sodium_crypto_secretbox')) {
        waw_fail(500, 'The PHP extension sodium is missing.');
    }
    $config['secret_bytes'] = $secret;
    $config['base_url'] = rtrim((string) $config['base_url'], '/');
    return $config;
}

function waw_fail(int $status, string $message = ''): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=UTF-8');
    echo $message;
    exit;
}

function waw_method(string ...$allowed): string
{
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($method, $allowed, true)) {
        header('Allow: ' . implode(', ', $allowed));
        waw_fail(405);
    }
    return $method;
}

function waw_input(string $name, int $maxLength = 4000): string
{
    $value = trim((string) ($_POST[$name] ?? $_GET[$name] ?? ''));
    return strlen($value) > $maxLength ? '' : $value;
}

/** Language for pages: from the token if known, otherwise from the browser. */
function waw_request_lang(?array $token = null): string
{
    if (in_array($token['l'] ?? null, ['de', 'en'], true)) {
        return $token['l'];
    }
    return str_starts_with(strtolower((string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')), 'de') ? 'de' : 'en';
}

/** Minimal HTML page for the confirmation and revocation steps. */
function waw_page(string $title, string $bodyHtml, int $status = 200, string $lang = 'en'): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=UTF-8');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    $title = waw_html($title);
    $lang = $lang === 'de' ? 'de' : 'en';
    echo <<<HTML
    <!DOCTYPE html>
    <html lang="{$lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex"><title>{$title}</title>
    <style>
      body{margin:0;background:#f7f5f0;color:#1d2327;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      main{max-width:560px;margin:48px auto;padding:24px 16px}
      h1{font-size:1.5rem;line-height:1.25}
      button{padding:12px 20px;border:0;border-radius:999px;background:#0f766e;color:#fff;font:inherit;font-weight:600;cursor:pointer}
      code{word-break:break-all}
      .muted{color:#5c6770;font-size:.9em}
    </style></head>
    <body><main><h1>{$title}</h1>{$bodyHtml}</main></body></html>
    HTML;
    exit;
}

function waw_html(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// ---------------------------------------------------------------------------
// Sealed tokens (site key, confirmation link, revocation link)
// ---------------------------------------------------------------------------

function waw_b64u_encode(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function waw_b64u_decode(string $text): ?string
{
    if (!preg_match('/^[A-Za-z0-9_-]*$/', $text)) {
        return null;
    }
    $bytes = base64_decode(str_pad(strtr($text, '-_', '+/'), (int) ceil(strlen($text) / 4) * 4, '='), true);
    return $bytes === false ? null : $bytes;
}

/** A separate key per purpose, so a confirmation link can never be used as a site key. */
function waw_token_key(string $purpose): string
{
    return hash_hmac('sha256', 'waw-token:' . $purpose, waw_config()['secret_bytes'], true);
}

function waw_seal(string $purpose, array $payload): string
{
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $box = sodium_crypto_secretbox($json, $nonce, waw_token_key($purpose));
    return WAW_TOKEN_PREFIXES[$purpose] . waw_b64u_encode($nonce . $box);
}

function waw_unseal(string $purpose, string $token): ?array
{
    $prefix = WAW_TOKEN_PREFIXES[$purpose];
    if (!str_starts_with($token, $prefix) || strlen($token) > 8000) {
        return null;
    }
    $raw = waw_b64u_decode(substr($token, strlen($prefix)));
    $minLength = SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES;
    if ($raw === null || strlen($raw) <= $minLength) {
        return null;
    }
    $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $json = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, waw_token_key($purpose));
    if ($json === false) {
        return null;
    }
    $payload = json_decode($json, true);
    return is_array($payload) ? $payload : null;
}

// ---------------------------------------------------------------------------
// Storage: rate limits, one-time use, revoked keys
// ---------------------------------------------------------------------------

function waw_storage_path(string $name): string
{
    $dir = rtrim((string) (waw_config()['storage_dir'] ?? ''), '/');
    if ($dir === '' || (!is_dir($dir) && !@mkdir($dir, 0700, true))) {
        waw_fail(500, 'The storage directory is missing or not writable.');
    }
    if (random_int(1, 200) === 1) {
        waw_storage_cleanup($dir);
    }
    return $dir . '/' . $name;
}

/** File names are keyed hashes, so they reveal neither IP addresses nor e-mail addresses. */
function waw_storage_id(string $value): string
{
    return hash_hmac('sha256', $value, waw_config()['secret_bytes']);
}

function waw_storage_cleanup(string $dir): void
{
    foreach (glob($dir . '/{rl,once}-*', GLOB_BRACE) ?: [] as $file) {
        if (filemtime($file) < time() - 2 * 86400) {
            @unlink($file);
        }
    }
}

/** Sliding window limit. Returns false when the limit is reached. */
function waw_limit(string $bucket, int $max, int $window): bool
{
    if ($max <= 0) {
        return true;
    }
    $handle = fopen(waw_storage_path('rl-' . waw_storage_id($bucket)), 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        return true; // don't block visitors because of a file system problem
    }
    $now = time();
    $timestamps = json_decode((string) stream_get_contents($handle), true);
    $timestamps = array_values(array_filter(
        is_array($timestamps) ? $timestamps : [],
        fn ($t) => is_int($t) && $t > $now - $window
    ));
    $allowed = count($timestamps) < $max;
    if ($allowed) {
        $timestamps[] = $now;
    }
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($timestamps));
    flock($handle, LOCK_UN);
    fclose($handle);
    return $allowed;
}

/** Returns true the first time a value is seen within $ttl seconds. */
function waw_once(string $value, int $ttl): bool
{
    $file = waw_storage_path('once-' . waw_storage_id($value));
    if (is_file($file) && filemtime($file) > time() - $ttl) {
        return false;
    }
    touch($file);
    return true;
}

function waw_is_revoked(string $keyId): bool
{
    $file = waw_storage_path('revoked.txt');
    return is_file($file) && in_array($keyId, file($file, FILE_IGNORE_NEW_LINES) ?: [], true);
}

function waw_revoke(string $keyId): void
{
    if (!waw_is_revoked($keyId)) {
        file_put_contents(waw_storage_path('revoked.txt'), $keyId . "\n", FILE_APPEND | LOCK_EX);
    }
}

/** Visitor IP as keyed hash with a daily changing input; used for rate limits only. */
function waw_visitor_id(): string
{
    return waw_storage_id(gmdate('Y-m-d') . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
}

// ---------------------------------------------------------------------------
// Origin, domains, proof of work
// ---------------------------------------------------------------------------

/** Host (and port, if any) of the page that sent the request, from the Origin header. */
function waw_origin_host(): ?string
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $host = $origin === '' ? null : parse_url($origin, PHP_URL_HOST);
    if (!is_string($host) || $host === '') {
        return null;
    }
    $port = parse_url($origin, PHP_URL_PORT);
    return strtolower($host) . ($port ? ':' . $port : '');
}

function waw_allow_origin(): void
{
    header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
    header('Vary: Origin');
}

/** "example.com" also allows "www.example.com". */
function waw_host_allowed(string $host, array $domains): bool
{
    foreach ($domains as $domain) {
        if ($host === $domain || $host === 'www.' . $domain) {
            return true;
        }
    }
    return false;
}

/** Parses "example.com, https://www.example.org/" into a list of up to 5 host names. */
function waw_parse_domains(string $input): array
{
    $domains = [];
    foreach (preg_split('/[\s,;]+/', strtolower($input)) ?: [] as $entry) {
        $entry = preg_replace('#^https?://#', '', $entry);
        $entry = preg_replace('#[/?\#].*$#', '', (string) $entry);
        $entry = preg_replace('/^www\./', '', (string) $entry);
        if ($entry !== '' && preg_match('/^(?=.{1,253}(:|$))([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(:\d{1,5})?$/', $entry)) {
            $domains[$entry] = true;
        }
    }
    return array_slice(array_keys($domains), 0, 5);
}

/**
 * Checks a hashcash-style proof of work from the widget: sha256("waw1:<time>:<sha256(scope)>:<nonce>")
 * must start with $bits zero bits. Each proof can be used only once.
 */
function waw_pow_valid(string $pow, string $scope, int $bits): bool
{
    if ($bits <= 0) {
        return true;
    }
    if (!preg_match('/^(\d{9,11}):(\d{1,15})$/', $pow, $m) || abs(time() - (int) $m[1]) > WAW_POW_WINDOW) {
        return false;
    }
    $hash = hash('sha256', 'waw1:' . $m[1] . ':' . hash('sha256', $scope) . ':' . $m[2], true);
    return waw_leading_zero_bits($hash) >= $bits && waw_once('pow|' . $scope . '|' . $pow, 2 * WAW_POW_WINDOW);
}

function waw_leading_zero_bits(string $bytes): int
{
    $bits = 0;
    foreach (str_split($bytes) as $char) {
        $byte = ord($char);
        if ($byte === 0) {
            $bits += 8;
            continue;
        }
        while (($byte & 0x80) === 0) {
            $bits++;
            $byte <<= 1;
        }
        break;
    }
    return $bits;
}

// ---------------------------------------------------------------------------
// Messages, phone numbers, widget snippet
// ---------------------------------------------------------------------------

function waw_valid_message(string $message): bool
{
    $max = (int) (waw_config()['max_message_length'] ?? 2000);
    return $message !== '' && mb_strlen($message, 'UTF-8') <= $max;
}

function waw_plausible_phone(string $phone): bool
{
    $digits = preg_replace('/\D/', '', $phone);
    return preg_match('#^\+?[\d\s()./-]+$#', $phone) === 1 && strlen($digits) >= 6 && strlen($digits) <= 15;
}

/** Converts "+49 176 …", "0049 176 …" or "0176 …" to "49176…" for wa.me links. */
function waw_whatsapp_number(string $phone): string
{
    $phone = str_replace('(0)', '', $phone);
    $digits = preg_replace('/\D/', '', $phone);
    if (str_starts_with(ltrim($phone), '+')) {
        return $digits;
    }
    if (str_starts_with($digits, '00')) {
        return substr($digits, 2);
    }
    if (str_starts_with($digits, '0')) {
        return (string) (waw_config()['default_country_code'] ?? '49') . substr($digits, 1);
    }
    return $digits;
}

/** Keeps only known widget options (data-* attribute names) with short string values. */
function waw_parse_widget_options(string $json): array
{
    $input = json_decode($json, true);
    $options = [];
    foreach (is_array($input) ? $input : [] as $name => $value) {
        if (in_array($name, WAW_WIDGET_OPTIONS, true) && is_scalar($value) && strlen((string) $value) <= 500) {
            $options[$name] = (string) $value;
        }
    }
    return $options;
}

function waw_snippet(array $options, string $siteKey): string
{
    $lines = ['<script src="' . waw_config()['base_url'] . '/whatsapp-widget.js"'];
    foreach ($options + ['site-key' => $siteKey] as $name => $value) {
        $lines[] = '        data-' . $name . '="' . waw_html((string) $value) . '"';
    }
    $lines[] = '        defer></script>';
    return implode("\n", $lines);
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

function waw_mime_header(string $text): string
{
    return preg_match('/[^\x20-\x7e]/', $text) ? '=?UTF-8?B?' . base64_encode($text) . '?=' : $text;
}

/** Sends a plain text mail. Visitor input only ever goes into the body. */
function waw_mail(string $to, string $subject, string $body): bool
{
    $config = waw_config();
    $headers = [
        'From' => waw_mime_header((string) ($config['sender_name'] ?? 'WhatsApp Widget')) . ' <' . $config['sender'] . '>',
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => 'quoted-printable',
        'Auto-Submitted' => 'auto-generated',
    ];
    $body = quoted_printable_encode(str_replace(["\r\n", "\n"], ["\n", "\r\n"], $body));
    return mail($to, waw_mime_header($subject), $body, $headers);
}

function waw_text(string $lang, string $id, array $vars = []): string
{
    static $texts = [
        'en' => [
            'verify_subject' => 'Confirm e-mail notifications for your WhatsApp widget',
            'verify_body' => "Someone, hopefully you, asked to receive the messages from the WhatsApp widget on {domains} at this e-mail address.\n\nConfirm here (the link is valid for 24 hours):\n{link}\n\nBy confirming, you accept the data processing agreement (version {dpa}):\n{dpa_url}\n\nIf this was not you, ignore this e-mail. Nothing will happen.",
            'key_subject' => 'Your WhatsApp widget is ready',
            'key_body' => "E-mail notifications for {domains} are active. Add this code to your website, before </body>:\n\n{snippet}\n\nKeep this e-mail. To stop the notifications, open this link:\n{revoke}",
            'notify_subject' => 'New message via the WhatsApp widget',
            'notify_intro' => 'New message via the WhatsApp widget on {domain}',
            'phone' => 'Phone',
            'reply' => 'Reply on WhatsApp',
            'no_phone' => 'Phone: not given. The visitor may still send the message in WhatsApp.',
            'page' => 'Page',
            'time' => 'Time',
            'stop' => 'Stop these notifications',
            'expired_title' => 'Link expired',
            'expired_body' => 'This confirmation link is invalid or older than 24 hours. Please request a new one in the configurator.',
            'confirm_title' => 'Confirm e-mail notifications',
            'confirm_body' => 'Messages from the WhatsApp widget on <strong>{domains}</strong> will be sent to <strong>{email}</strong>.',
            'confirm_dpa' => 'By confirming, you accept the <a href="{dpa_url}">data processing agreement</a> (version {dpa}).',
            'confirm_button' => 'Confirm',
            'used_title' => 'Already confirmed',
            'used_body' => 'This link has already been used. Your site key is in the e-mail we sent after the confirmation.',
            'invalid_title' => 'Invalid link',
            'invalid_body' => 'This link is invalid.',
            'revoke_title' => 'Stop e-mail notifications',
            'revoke_body' => 'After this step, messages from the WhatsApp widget on <strong>{domains}</strong> are no longer sent by e-mail. The widget itself keeps working. You can request a new site key in the configurator at any time.',
            'revoke_button' => 'Stop notifications',
            'revoked_title' => 'Notifications stopped',
            'revoked_body' => 'E-mail notifications for <strong>{domains}</strong> are switched off.',
        ],
        'de' => [
            'verify_subject' => 'E-Mail-Benachrichtigungen für dein WhatsApp-Widget bestätigen',
            'verify_body' => "Jemand, hoffentlich du, möchte die Nachrichten aus dem WhatsApp-Widget auf {domains} an diese E-Mail-Adresse erhalten.\n\nHier bestätigen (der Link gilt 24 Stunden):\n{link}\n\nMit der Bestätigung akzeptierst du den Vertrag zur Auftragsverarbeitung (Version {dpa}):\n{dpa_url}\n\nWarst du das nicht? Dann ignoriere diese E-Mail. Es passiert nichts.",
            'key_subject' => 'Dein WhatsApp-Widget ist bereit',
            'key_body' => "Die E-Mail-Benachrichtigungen für {domains} sind aktiv. Füge diesen Code auf deiner Website vor </body> ein:\n\n{snippet}\n\nBewahre diese E-Mail auf. Über diesen Link kannst du die Benachrichtigungen abschalten:\n{revoke}",
            'notify_subject' => 'Neue Nachricht über das WhatsApp-Widget',
            'notify_intro' => 'Neue Nachricht über das WhatsApp-Widget auf {domain}',
            'phone' => 'Telefon',
            'reply' => 'Auf WhatsApp antworten',
            'no_phone' => 'Telefon: nicht angegeben. Vielleicht sendet die Person die Nachricht noch in WhatsApp.',
            'page' => 'Seite',
            'time' => 'Zeit',
            'stop' => 'Diese Benachrichtigungen abschalten',
            'expired_title' => 'Link abgelaufen',
            'expired_body' => 'Dieser Bestätigungslink ist ungültig oder älter als 24 Stunden. Bitte fordere im Konfigurator einen neuen an.',
            'confirm_title' => 'E-Mail-Benachrichtigungen bestätigen',
            'confirm_body' => 'Nachrichten aus dem WhatsApp-Widget auf <strong>{domains}</strong> gehen an <strong>{email}</strong>.',
            'confirm_dpa' => 'Mit der Bestätigung akzeptierst du den <a href="{dpa_url}">Vertrag zur Auftragsverarbeitung</a> (Version {dpa}).',
            'confirm_button' => 'Bestätigen',
            'used_title' => 'Bereits bestätigt',
            'used_body' => 'Dieser Link wurde schon verwendet. Deinen Site-Key findest du in der E-Mail, die wir dir nach der Bestätigung geschickt haben.',
            'invalid_title' => 'Ungültiger Link',
            'invalid_body' => 'Dieser Link ist ungültig.',
            'revoke_title' => 'E-Mail-Benachrichtigungen abschalten',
            'revoke_body' => 'Danach werden Nachrichten aus dem WhatsApp-Widget auf <strong>{domains}</strong> nicht mehr per E-Mail verschickt. Das Widget selbst funktioniert weiter. Einen neuen Site-Key kannst du jederzeit im Konfigurator anfordern.',
            'revoke_button' => 'Benachrichtigungen abschalten',
            'revoked_title' => 'Benachrichtigungen abgeschaltet',
            'revoked_body' => 'Die E-Mail-Benachrichtigungen für <strong>{domains}</strong> sind abgeschaltet.',
        ],
    ];
    $text = $texts[$lang][$id] ?? $texts['en'][$id];
    return strtr($text, array_combine(array_map(fn ($k) => '{' . $k . '}', array_keys($vars)), array_values($vars)) ?: []);
}
