<?php
// Broker Portal demo: Copilot proxy for Hostinger (PHP 8+).
// Keeps the API key on the server. Accepts same-origin POSTs only, rate-limits per visitor,
// and forwards only the question plus the asking user's own trimmed context (built in the browser
// from records that user can see). Health check: GET ?health=1 → {"ok": true} when configured.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

function reply(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

$configFile = __DIR__ . '/config.php';
$config = is_file($configFile) ? require $configFile : null;
$configured = is_array($config) && !empty($config['anthropic_api_key']);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    reply(200, ['ok' => $configured]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(405, ['error' => 'POST only']);
if (!$configured) reply(503, ['error' => 'Copilot model not configured']);

// Same-origin only.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $config['allowed_origins'] ?? [];
if ($origin !== '' && !in_array($origin, $allowed, true)) reply(403, ['error' => 'Origin not allowed']);

// Simple rate limit: N requests per minute per IP (file-based, fine for a demo).
$limit = (int)($config['per_minute'] ?? 20);
$ip = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'x') . ($config['salt'] ?? ''));
$bucket = sys_get_temp_dir() . '/bp-copilot-' . substr($ip, 0, 24);
$now = time();
$hits = array_filter(is_file($bucket) ? (array)json_decode((string)file_get_contents($bucket), true) : [], fn($t) => $t > $now - 60);
if (count($hits) >= $limit) reply(429, ['error' => 'Too many questions, try again in a minute']);
$hits[] = $now;
file_put_contents($bucket, json_encode(array_values($hits)), LOCK_EX);

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 40000) reply(413, ['error' => 'Request too large']);
$in = json_decode($raw, true);
$question = is_array($in) ? trim((string)($in['question'] ?? '')) : '';
$context = is_array($in) && is_array($in['context'] ?? null) ? $in['context'] : null;
if ($question === '' || mb_strlen($question) > 500 || $context === null) reply(400, ['error' => 'Question and context are required']);

$firm = (string)($context['firm'] ?? 'the firm');
$system = "You are the Firm Copilot in Broker Portal, a demo CRM for UAE real estate brokerages. "
    . "You work for one firm only: {$firm}. Answer ONLY from the JSON context, which holds the records the asking user is allowed to see. "
    . "If the question is about another firm, competitors, or data not in the context, say you can only use {$firm} records the user can see. "
    . "Never invent clients, numbers or records. Keep answers under 120 words, plain English, no markdown tables. "
    . "You cannot change data: if asked to do something, say which page or button in the portal does it.";

$payload = [
    'model' => $config['model'] ?? 'claude-haiku-5-5',
    'max_tokens' => 400,
    'system' => $system,
    'messages' => [[
        'role' => 'user',
        'content' => "Context (JSON):\n" . json_encode($context, JSON_UNESCAPED_UNICODE) . "\n\nQuestion: " . $question,
    ]],
];

$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_HTTPHEADER => [
        'content-type: application/json',
        'x-api-key: ' . $config['anthropic_api_key'],
        'anthropic-version: 2023-06-01',
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
]);
$res = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
if ($res === false || $status >= 400) reply(502, ['error' => 'Model service unavailable']);

$data = json_decode((string)$res, true);
$text = '';
foreach (($data['content'] ?? []) as $block) {
    if (($block['type'] ?? '') === 'text') $text .= $block['text'];
}
reply(200, ['text' => trim($text) !== '' ? trim($text) : 'No answer.']);
