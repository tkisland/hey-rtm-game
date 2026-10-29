<?php
// Place the edited file at /home/YOUR_ACCOUNT/rhythm-private/config.php,
// OUTSIDE www / the domain's document root. Never upload credentials to GitHub.
return [
    'db_host' => 'mysqlXXX.db.sakura.ne.jp',
    'db_name' => 'YOUR_DATABASE',
    'db_user' => 'YOUR_DATABASE_USER',
    'db_password' => 'YOUR_DATABASE_PASSWORD',
    // Optional: starts per IP/minute (default 180; independent from image generation).
    // 'start_limit_per_minute' => 180,
    // 'admin_limit_per_minute' => 60,
    // Optional: normally an independent private rate-limit.key is generated automatically.
    // 'rate_limit_key' => '64_HEX_CHARACTERS_GENERATED_LOCALLY',
    // Only list proxies you operate/trust; forwarded headers are ignored by default.
    // 'trusted_proxies' => ['203.0.113.10/32', '2001:db8::/32'],
    // Optional: global cache-miss generation budget and PNG cache size (bytes).
    // 'share_generations_per_minute' => 30,
    // 'share_cache_max_bytes' => 134217728,
    'allowed_origin' => 'https://hey.jpn.org',
];
