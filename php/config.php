<?php
/**
 * Solvit Communications & Compliance SLA System
 * Configuration and Database Layer (PDO)
 * 
 * PostgreSQL-only production database layer.
 */

// Force Nairobi Timezone (UTC+3)
date_default_timezone_set('Africa/Nairobi');

// Database Configuration
define('DB_TYPE', 'postgresql');
define('DATABASE_URL', getenv('DATABASE_URL') ?: '');

// Admin Auth Credentials
define('ADMIN_USER', getenv('ADMIN_USERNAME') ?: 'admin');
define('ADMIN_PASS', getenv('ADMIN_PASSWORD') ?: 'admin123');

// CORS Headers for API access
function setCorsHeaders() {
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
    header("Content-Type: application/json; charset=UTF-8");

    // Handle preflight OPTIONS request
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit();
    }
}

// Database Connection Factory
function getDbConnection() {
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    try {
        if (!DATABASE_URL) throw new RuntimeException('DATABASE_URL is required');
        $parts = parse_url(DATABASE_URL);
        if (!$parts || ($parts['scheme'] ?? '') === '') throw new RuntimeException('DATABASE_URL is invalid');
        $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;sslmode=require', $parts['host'], $parts['port'] ?? 5432, ltrim($parts['path'], '/'));
        $pdo = new PDO($dsn, urldecode($parts['user'] ?? ''), urldecode($parts['pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode([
            'error' => 'Database connection failed',
            'details' => $e->getMessage()
        ]);
        exit();
    }
}

// Read JSON Input Body
function getJsonInput() {
    $raw = file_get_contents('php://input');
    if (empty($raw)) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// Standard JSON Response Helper
function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit();
}
