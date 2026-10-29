<?php
// Place the edited file at /home/YOUR_ACCOUNT/rhythm-private/config.php,
// OUTSIDE www / the domain's document root. Never upload credentials to GitHub.
return [
    'db_host' => 'mysqlXXX.db.sakura.ne.jp',
    'db_name' => 'YOUR_DATABASE',
    'db_user' => 'YOUR_DATABASE_USER',
    'db_password' => 'YOUR_DATABASE_PASSWORD',
    // Optional: global cache-miss generation budget and PNG cache size (bytes).
    // 'share_generations_per_minute' => 30,
    // 'share_cache_max_bytes' => 134217728,
    'allowed_origin' => 'https://hey.jpn.org',
];
