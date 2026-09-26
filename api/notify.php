<?php
/**
 * Step 3: the widget sends a visitor's message. The recipient comes only from
 * the encrypted site key, never from the request, so this is no open relay.
 */

declare(strict_types=1);

const WAW_SERVICE = true;
require __DIR__ . '/lib.php';

$config = waw_config();
$method = waw_method('POST', 'OPTIONS');
$host = waw_origin_host();
if ($host === null) {
    waw_fail(403, 'origin');
}
if ($method === 'OPTIONS') {
    waw_allow_origin();
    header('Access-Control-Allow-Methods: POST');
    waw_fail(204);
}

$siteKey = waw_input('key', 1000);
$key = waw_unseal('key', $siteKey);
if ($key === null) {
    waw_fail(403, 'key');
}
if (!waw_host_allowed($host, $key['d'])) {
    waw_fail(403, 'origin');
}
waw_allow_origin();
if (waw_is_revoked($key['i'])) {
    waw_fail(410, 'revoked');
}

$message = waw_input('message', 10000);
$phone = waw_input('phone', 40);
$page = waw_input('page', 500);

if (!waw_valid_message($message) || ($phone !== '' && !waw_plausible_phone($phone))) {
    waw_fail(422, 'input');
}
if (!waw_pow_valid(waw_input('pow', 40), $siteKey, (int) $config['pow_bits'])) {
    waw_fail(403, 'pow');
}

$limits = $config['limits'];
if (!waw_limit('notify-key-hour|' . $key['i'], $limits['notify_per_key_hour'], 3600)
    || !waw_limit('notify-key-day|' . $key['i'], $limits['notify_per_key_day'], 86400)
    || !waw_limit('notify-ip|' . waw_visitor_id(), $limits['notify_per_ip_hour'], 3600)
    || !waw_limit('notify-all', $limits['notify_global_hour'], 3600)) {
    waw_fail(429, 'limit');
}

$lang = $key['l'];
$lines = [waw_text($lang, 'notify_intro', ['domain' => $host]), '', $message, '', '---'];
if ($phone !== '') {
    $lines[] = waw_text($lang, 'phone') . ': ' . $phone;
    $lines[] = waw_text($lang, 'reply') . ': https://wa.me/' . waw_whatsapp_number($phone);
} else {
    $lines[] = waw_text($lang, 'no_phone');
}
if (preg_match('#^https?://#i', $page)) {
    $lines[] = waw_text($lang, 'page') . ': ' . $page;
}
$lines[] = waw_text($lang, 'time') . ': ' . date('Y-m-d H:i:s T');
$lines[] = '';
$lines[] = waw_text($lang, 'stop') . ': ' . $config['base_url'] . '/api/revoke.php?t='
    . waw_seal('revoke', ['i' => $key['i'], 'd' => $key['d'], 'l' => $lang]);

$sent = waw_mail($key['e'], waw_text($lang, 'notify_subject'), implode("\n", $lines));
waw_fail($sent ? 204 : 500);
