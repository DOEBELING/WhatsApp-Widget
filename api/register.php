<?php
/**
 * Step 1: a site owner asks for e-mail notifications (double opt-in).
 * Called by the configurator on the same site. Sends a confirmation link.
 */

declare(strict_types=1);

const WAW_SERVICE = true;
require __DIR__ . '/lib.php';

$config = waw_config();
waw_method('POST');

// Only the configurator on this site may register.
$ownHost = strtolower((string) parse_url($config['base_url'], PHP_URL_HOST));
$ownPort = parse_url($config['base_url'], PHP_URL_PORT);
if (waw_origin_host() !== $ownHost . ($ownPort ? ':' . $ownPort : '')) {
    waw_fail(403, 'origin');
}

$email = waw_input('email', 254);
$domains = waw_parse_domains(waw_input('domains', 1000));
$lang = waw_input('lang') === 'de' ? 'de' : 'en';
$options = waw_parse_widget_options(waw_input('options', 3000));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    waw_fail(422, 'email');
}
if ($domains === []) {
    waw_fail(422, 'domains');
}
if (waw_input('dpa') !== '1') {
    waw_fail(422, 'dpa');
}
if (!waw_pow_valid(waw_input('pow', 40), 'register:' . strtolower($email), (int) $config['pow_bits'])) {
    waw_fail(403, 'pow');
}

$limits = $config['limits'];
if (!waw_limit('register-ip|' . waw_visitor_id(), $limits['register_per_ip_hour'], 3600)
    || !waw_limit('register-email|' . strtolower($email), $limits['register_per_email_day'], 86400)
    || !waw_limit('register-all', $limits['register_global_hour'], 3600)) {
    waw_fail(429, 'limit');
}

$token = waw_seal('verify', [
    'e' => $email,
    'd' => $domains,
    'l' => $lang,
    'o' => $options,
    'x' => time() + 86400,
]);

$sent = waw_mail($email, waw_text($lang, 'verify_subject'), waw_text($lang, 'verify_body', [
    'domains' => implode(', ', $domains),
    'link' => $config['base_url'] . '/api/verify.php?t=' . $token,
    'dpa' => $config['dpa_version'],
    'dpa_url' => $config['dpa_url'],
]));

waw_fail($sent ? 202 : 500, $sent ? 'sent' : 'mail');
