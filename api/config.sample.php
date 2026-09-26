<?php
/**
 * Configuration of the hosted notification service.
 *
 * Copy this file to "whatsapp-widget-config.php" in the directory ABOVE the web
 * root (recommended) or to "api/config.php", and adjust the values.
 * Never commit the real file: it contains the secret.
 */

return [
    // 32 random bytes, base64. Create with: php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"
    // Changing it makes all site keys and links invalid.
    'secret' => '',

    // Public address of this site, without trailing slash.
    'base_url' => 'https://whatsapp-widget.doebeling.dev',

    // Sender of all mails. Use an address of this domain with SPF, DKIM and DMARC.
    'sender' => 'notify@whatsapp-widget.doebeling.dev',
    'sender_name' => 'WhatsApp Widget',

    // Writable directory OUTSIDE the web root for rate limits and revoked keys.
    'storage_dir' => __DIR__ . '/whatsapp-widget-storage',

    // Data processing agreement (Art. 28 GDPR) that site owners accept when they confirm.
    'dpa_url' => 'https://whatsapp-widget.doebeling.dev/dpa.html',
    'dpa_version' => '2026-09',

    // Proof of work the widget has to deliver (leading zero bits of a SHA-256 hash).
    // The widget computes 18 bits. 0 switches the check off.
    'pow_bits' => 18,

    'max_message_length' => 2000,

    // Used to turn national numbers ("0176 …") into a WhatsApp link ("49176 …").
    'default_country_code' => '49',

    'limits' => [
        'notify_per_key_hour' => 20,
        'notify_per_key_day' => 100,
        'notify_per_ip_hour' => 10,
        'notify_global_hour' => 1000,
        'register_per_ip_hour' => 5,
        'register_per_email_day' => 3,
        'register_global_hour' => 100,
    ],
];
