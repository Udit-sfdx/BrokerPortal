<?php
// Copy to config.php on the server (never commit config.php: it is in .gitignore).
return [
    'anthropic_api_key' => 'sk-ant-...',
    'model' => 'claude-haiku-5-5',
    // The site's own origin(s); requests from anywhere else are refused.
    'allowed_origins' => ['https://brokers.vibeestate.space'],
    'per_minute' => 20,
    'salt' => 'change-me',
];
