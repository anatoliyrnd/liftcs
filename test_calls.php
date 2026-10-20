<?php
/**
 * test_calls.php — Локальный прокси для перенаправления запросов
 * на удаленный шлюз sh.e-rcs.ru.
 */

// 1. Отключаем вывод ошибок
error_reporting(0);
ini_set('display_errors', 0);

// 2. Настройки CORS
header('Access-Control-Allow-Origin: http://lift.local');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'code' => 'method_not_allowed', 'message' => 'Только POST']);
    exit;
}

// 3. Получаем сырое тело запроса
$rawBody = file_get_contents('php://input');
$input = json_decode($rawBody, true);

// ============================================================
// ЗАГЛУШКА: Перехватываем запрос адресов и отдаем локальный JSON
// ============================================================
if (isset($input['data']) && $input['data'] === 'loadAddress') {
    $jsonFile = __DIR__ . '/address.json';
    if (file_exists($jsonFile)) {
        header('Content-Type: application/json; charset=utf-8');
        echo file_get_contents($jsonFile);
        exit; // Прерываем выполнение, никуда дальше не шлем
    } else {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Локальный address.json не найден!']);
        exit;
    }
}
// ============================================================

// 4. Целевой URL (для всего остального)
$targetUrl = 'https://sh.e-rcs.ru/test_calls.php';

// 5. Собираем заголовки для перенаправления
$forwardHeaders = [
    'Content-Type: application/json',
];

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!empty($authHeader)) {
    $forwardHeaders[] = 'Authorization: ' . $authHeader;
}

// 6. Инициализируем cURL
$ch = curl_init($targetUrl);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
curl_setopt($ch, CURLOPT_HTTPHEADER, $forwardHeaders);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

// 7. Выполняем запрос
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);

curl_close($ch);

// 8. Возвращаем ответ клиенту
if ($curlError) {
    http_response_code(502);
    echo json_encode([
        'status' => 'error',
        'code' => 'proxy_network_error',
        'message' => 'Ошибка прокси: ' . $curlError
    ]);
} else {
    http_response_code($httpCode);
    header('Content-Type: application/json; charset=utf-8');
    echo $response;
}