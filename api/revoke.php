<?php
/**
 * Stops the notifications of a site key. The link is in every notification.
 * GET only shows a button, so link scanners can't revoke by accident.
 */

declare(strict_types=1);

const WAW_SERVICE = true;
require __DIR__ . '/lib.php';

waw_config();
$method = waw_method('GET', 'POST');
$token = waw_input('t', 1000);
$revoke = waw_unseal('revoke', $token);

$lang = waw_request_lang($revoke);

if ($revoke === null) {
    waw_page(waw_text($lang, 'invalid_title'), '<p>' . waw_text($lang, 'invalid_body') . '</p>', 400, $lang);
}

$domains = waw_html(implode(', ', $revoke['d']));

if ($method === 'GET') {
    waw_page(waw_text($lang, 'revoke_title'),
        '<p>' . waw_text($lang, 'revoke_body', ['domains' => $domains]) . '</p>'
        . '<form method="post"><input type="hidden" name="t" value="' . waw_html($token) . '">'
        . '<button type="submit">' . waw_text($lang, 'revoke_button') . '</button></form>',
        200, $lang);
}

waw_revoke($revoke['i']);
waw_page(waw_text($lang, 'revoked_title'), '<p>' . waw_text($lang, 'revoked_body', ['domains' => $domains]) . '</p>', 200, $lang);
