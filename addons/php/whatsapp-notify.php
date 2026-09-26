<?php
/**
 * WhatsApp Widget – optional e-mail notification (self-hosted add-on)
 * https://github.com/DOEBELING/WhatsApp-Widget
 * Copyright (C) 2025-2026 Andreas Döbeling, DÖBELING Projektbüro
 * License: AGPL-3.0-or-later with additional terms, see ADDITIONAL-TERMS.md in
 * the repository. If you change this script and run it for a website, visitors
 * are its users: offer them the source code of your version (AGPL section 13).
 *
 * Receives the message (and optionally the visitor's phone number) from the
 * widget and sends it to you by e-mail, with a link to reply on WhatsApp.
 * Use it if you want to keep the request even when the visitor does not send
 * the message in WhatsApp.
 *
 * Setup:
 *   1. Adjust the configuration below.
 *   2. Upload this file to your web server (PHP 8.1 or newer).
 *   3. Add data-notify-url="/whatsapp-notify.php" to the widget's script tag.
 *   4. Mention the transfer in your privacy policy and set data-privacy-url.
 *
 * The script stores nothing and writes no logs. The only file it writes is a
 * counter for the hourly limit, which contains timestamps but no personal data.
 */

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

$config = [
    // Where the notification goes.
    'recipient' => 'you@example.com',

    // Sender address. Use an address of your own domain, otherwise the mail may be
    // rejected (SPF/DMARC).
    'sender' => 'website@example.com',

    'subject' => 'New message via the WhatsApp widget',

    // Websites that may send messages to this script, e.g. ['https://www.example.com'].
    // Empty: only pages on the same host as this script.
    'allowed_origins' => [],

    // Reject messages without the visitor's phone number. Keep this in line with the
    // widget option data-ask-phone (default with data-notify-url: "required").
    'phone_required' => true,

    // Used to turn national numbers ("0176 …") into a WhatsApp link ("49176 …").
    'default_country_code' => '49',

    'max_message_length' => 2000,

    // Simple protection against abuse: maximum number of mails per hour (all visitors together).
    'max_mails_per_hour' => 30,
];

// ---------------------------------------------------------------------------
// No changes needed below this line
// ---------------------------------------------------------------------------

ini_set('display_errors', '0');
header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/** Ends the request with an HTTP status code and no content. */
function respond(int $status): never
{
    http_response_code($status);
    exit;
}

function isAllowedOrigin(string $origin, array $allowedOrigins): bool
{
    if ($origin === '') {
        return false;
    }
    if ($allowedOrigins !== []) {
        return in_array(rtrim($origin, '/'), array_map(fn ($o) => rtrim($o, '/'), $allowedOrigins), true);
    }
    $originHost = parse_url($origin, PHP_URL_HOST);
    $originPort = parse_url($origin, PHP_URL_PORT);
    $ownHost = $_SERVER['HTTP_HOST'] ?? '';
    return $originHost !== null
        && strcasecmp($originHost . ($originPort ? ':' . $originPort : ''), $ownHost) === 0;
}

function isPlausiblePhone(string $phone): bool
{
    $digits = preg_replace('/\D/', '', $phone);
    return preg_match('#^\+?[\d\s()./-]+$#', $phone) === 1
        && strlen($digits) >= 6
        && strlen($digits) <= 15;
}

/** Converts "+49 176 …", "0049 176 …" or "0176 …" to "49176…" for wa.me links. */
function toWhatsAppNumber(string $phone, string $defaultCountryCode): string
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
        return $defaultCountryCode . substr($digits, 1);
    }
    return $digits;
}

/** Global hourly limit, stored as a list of timestamps in the temp directory. */
function withinRateLimit(int $maxPerHour): bool
{
    $file = sys_get_temp_dir() . '/whatsapp-notify-' . md5(__FILE__) . '.json';
    $handle = fopen($file, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        return true; // don't block visitors because of a file system problem
    }
    $now = time();
    $timestamps = json_decode((string) stream_get_contents($handle), true);
    $timestamps = array_values(array_filter(
        is_array($timestamps) ? $timestamps : [],
        fn ($t) => is_int($t) && $t > $now - 3600
    ));
    $allowed = count($timestamps) < $maxPerHour;
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

// CORS: browsers send an Origin header with every POST request made with fetch().
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (!isAllowedOrigin($origin, $config['allowed_origins'])) {
    respond(403);
}
header('Access-Control-Allow-Origin: ' . $origin);
header('Vary: Origin');

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST');
    respond(204);
}
if ($method !== 'POST') {
    header('Allow: POST, OPTIONS');
    respond(405);
}

$message = trim((string) ($_POST['message'] ?? ''));
$phone = trim((string) ($_POST['phone'] ?? ''));
$page = trim((string) ($_POST['page'] ?? ''));

$length = function_exists('mb_strlen') ? mb_strlen($message, 'UTF-8') : strlen($message);
if ($message === '' || $length > $config['max_message_length']) {
    respond(422);
}
if ($phone === '' ? $config['phone_required'] : !isPlausiblePhone($phone)) {
    respond(422);
}
if ($page !== '' && (strlen($page) > 500 || !preg_match('#^https?://#i', $page))) {
    $page = '';
}
if (!withinRateLimit($config['max_mails_per_hour'])) {
    respond(429);
}

$lines = [
    'New message via the WhatsApp widget',
    '',
    $message,
    '',
    '---',
];
if ($phone !== '') {
    $lines[] = 'Phone: ' . $phone;
    $lines[] = 'Reply on WhatsApp: https://wa.me/' . toWhatsAppNumber($phone, $config['default_country_code']);
} else {
    $lines[] = 'Phone: not given. The visitor may still send the message in WhatsApp.';
}
if ($page !== '') {
    $lines[] = 'Page: ' . $page;
}
$lines[] = 'Time: ' . date('Y-m-d H:i:s T');

$headers = [
    'From' => $config['sender'],
    'MIME-Version' => '1.0',
    'Content-Type' => 'text/plain; charset=UTF-8',
    'Content-Transfer-Encoding' => '8bit',
];
$subject = '=?UTF-8?B?' . base64_encode($config['subject']) . '?=';

// All visitor input goes into the mail body only, never into the headers.
$sent = mail($config['recipient'], $subject, implode("\r\n", $lines), $headers);

respond($sent ? 204 : 500);
