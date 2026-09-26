<?php
/**
 * Step 2: the site owner confirms the link from the e-mail.
 *
 * GET only shows a button, so link scanners in mail systems can't confirm by
 * accident. POST creates the site key, mails it with the ready-made snippet
 * and sends the owner back to the configurator.
 */

declare(strict_types=1);

const WAW_SERVICE = true;
require __DIR__ . '/lib.php';

$config = waw_config();
$method = waw_method('GET', 'POST');
$token = waw_input('t', 8000);
$request = waw_unseal('verify', $token);

$lang = waw_request_lang($request);

if ($request === null || ($request['x'] ?? 0) < time()) {
    waw_page(waw_text($lang, 'expired_title'), '<p>' . waw_text($lang, 'expired_body') . '</p>', 410, $lang);
}

$domains = implode(', ', $request['d']);

if ($method === 'GET') {
    waw_page(waw_text($lang, 'confirm_title'),
        '<p>' . waw_text($lang, 'confirm_body', ['domains' => waw_html($domains), 'email' => waw_html($request['e'])]) . '</p>'
        . '<p class="muted">' . waw_text($lang, 'confirm_dpa', ['dpa_url' => waw_html($config['dpa_url']), 'dpa' => waw_html($config['dpa_version'])]) . '</p>'
        . '<form method="post"><input type="hidden" name="t" value="' . waw_html($token) . '">'
        . '<button type="submit">' . waw_text($lang, 'confirm_button') . '</button></form>',
        200, $lang);
}

if (!waw_once('verify|' . $token, 2 * 86400)) {
    waw_page(waw_text($lang, 'used_title'), '<p>' . waw_text($lang, 'used_body') . '</p>', 409, $lang);
}

$keyId = bin2hex(random_bytes(8));
$siteKey = waw_seal('key', [
    'i' => $keyId,
    'e' => $request['e'],
    'd' => $request['d'],
    'l' => $lang,
    'a' => time(),               // time of confirmation
    'p' => $config['dpa_version'], // accepted version of the data processing agreement
]);
$revokeLink = $config['base_url'] . '/api/revoke.php?t=' . waw_seal('revoke', ['i' => $keyId, 'd' => $request['d'], 'l' => $lang]);

waw_mail($request['e'], waw_text($lang, 'key_subject'), waw_text($lang, 'key_body', [
    'domains' => $domains,
    'snippet' => waw_snippet($request['o'], $siteKey),
    'revoke' => $revokeLink,
]));

$setup = waw_b64u_encode(json_encode(['k' => $siteKey, 'o' => (object) $request['o']], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
header('Location: ' . $config['base_url'] . '/?lang=' . $lang . '#setup=' . $setup, true, 303);
exit;
