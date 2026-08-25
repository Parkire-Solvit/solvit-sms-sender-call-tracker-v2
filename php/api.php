<?php
/**
 * Solvit Communications SLA & Compliance - REST API Router
 * 
 * Handles all JSON requests from the Admin Portal frontend and external ingestion hooks.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/SettingsManager.php';
require_once __DIR__ . '/ComplianceEngine.php';

setCorsHeaders();

$pdo = getDbConnection();

// Resolve action from GET parameter or PATH_INFO
$action = $_GET['action'] ?? '';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Handle URL rewrites (e.g. /api/compliance-stats -> action=compliance-stats)
if (empty($action) && preg_match('#/api/([a-zA-Z0-9_\-]+)#', $path, $matches)) {
    $action = $matches[1];
}

// -------------------------------------------------------------
// 1. Health & Database Status
// -------------------------------------------------------------
if ($action === 'health' || $action === 'db-status') {
    jsonResponse([
        'status' => 'ok',
        'engine' => 'PHP ' . PHP_VERSION,
        'db_type' => DB_TYPE,
        'timezone' => date_default_timezone_get(),
        'server_time' => date('Y-m-d H:i:s'),
        'database' => 'PostgreSQL',
    ]);
}

// -------------------------------------------------------------
// 2. Admin Authentication
// -------------------------------------------------------------
if ($action === 'login' && $method === 'POST') {
    $input = getJsonInput();
    $username = strtolower(trim($input['username'] ?? ''));
    $password = trim($input['password'] ?? '');

    if ($username === strtolower(ADMIN_USER) && $password === ADMIN_PASS) {
        jsonResponse([
            'success' => true,
            'token' => 'solvit-admin-session-' . bin2hex(random_bytes(16)),
            'user' => $username,
        ]);
    } else {
        jsonResponse(['error' => 'Invalid admin credentials'], 401);
    }
}

// -------------------------------------------------------------
// 3. Agent Heartbeat / Ingestion
// -------------------------------------------------------------
if (($action === 'log-agent' || $action === 'agents') && $method === 'POST') {
    $input = getJsonInput();
    $name = trim($input['name'] ?? $input['agentName'] ?? $input['agent_name'] ?? '');
    $phone = trim($input['phone_number'] ?? $input['phone'] ?? '');
    $tag = trim($input['tag'] ?? 'Uncategorised');

    if (!$name) {
        jsonResponse(['error' => 'Agent name is required'], 400);
    }

    $stmt = $pdo->prepare("
            INSERT INTO agents (name, phone_number, tag, last_active_at)
            VALUES (?, ?, ?, NOW())
            ON CONFLICT(name) DO UPDATE SET
              phone_number = COALESCE(EXCLUDED.phone_number, agents.phone_number),
              tag = COALESCE(EXCLUDED.tag, agents.tag),
              last_active_at = NOW()
        ");
    $stmt->execute([$name, $phone ?: null, $tag]);

    $stmt = $pdo->prepare("SELECT * FROM agents WHERE name = ? LIMIT 1");
    $stmt->execute([$name]);
    $agent = $stmt->fetch();

    jsonResponse([
        'status' => 'success',
        'agent' => $agent,
        'tag' => $agent['tag'] ?? 'Uncategorised',
    ]);
}

// -------------------------------------------------------------
// 4. Log Communication Event (Call / SMS)
// -------------------------------------------------------------
if ($action === 'log-event' && $method === 'POST') {
    $input = getJsonInput();
    $agentName = trim($input['agent_name'] ?? $input['agentName'] ?? '');
    $type = strtoupper(trim($input['type'] ?? 'CALL'));
    $targetPhone = trim($input['target_phone'] ?? $input['targetPhone'] ?? '');
    $status = strtoupper(trim($input['status'] ?? ''));
    $duration = (int)($input['duration'] ?? 0);
    $regNo = trim($input['reg_no'] ?? $input['regNo'] ?? '');
    $ts = !empty($input['timestamp']) ? date('Y-m-d H:i:s', strtotime($input['timestamp'])) : date('Y-m-d H:i:s');

    if (!$targetPhone) {
        jsonResponse(['error' => 'target_phone is required'], 400);
    }

    // Resolve or auto-register agent
    $agentId = null;
    if ($agentName) {
        $stmt = $pdo->prepare("SELECT id FROM agents WHERE name = ? LIMIT 1");
        $stmt->execute([$agentName]);
        $row = $stmt->fetch();
        if ($row) {
            $agentId = (int)$row['id'];
        } else {
            $ins = $pdo->prepare("INSERT INTO agents (name, last_active_at) VALUES (?, NOW())");
            $ins->execute([$agentName]);
            $agentId = (int)$pdo->lastInsertId();
        }
    }

    $stmt = $pdo->prepare("
        INSERT INTO events (agent_id, type, target_phone, status, duration, reg_no, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([$agentId, $type, $targetPhone, $status, $duration, $regNo ?: null, $ts]);

    jsonResponse([
        'status' => 'success',
        'event_id' => $pdo->lastInsertId(),
    ]);
}

// -------------------------------------------------------------
// 5. Global Activity Summary Stats
// -------------------------------------------------------------
if ($action === 'stats' && $method === 'GET') {
    $startDate = $_GET['startDate'] ?? date('Y-m-d');
    $endDate = $_GET['endDate'] ?? $startDate;
    $agentId = !empty($_GET['agent_id']) ? (int)$_GET['agent_id'] : null;

    $where = "WHERE DATE(timestamp) BETWEEN ? AND ?";
    $params = [$startDate, $endDate];

    if ($agentId) {
        $where .= " AND agent_id = ?";
        $params[] = $agentId;
    }

    // Exclude internal contacts if configured
    $internalRows = $pdo->query("SELECT phone_number FROM internal_contacts")->fetchAll(PDO::FETCH_COLUMN);
    if (!empty($internalRows)) {
        $placeholders = implode(',', array_fill(0, count($internalRows), '?'));
        $where .= " AND target_phone NOT IN ($placeholders)";
        $params = array_merge($params, $internalRows);
    }

    $stmt = $pdo->prepare("
        SELECT 
          COUNT(CASE WHEN type = 'CALL' AND status = 'OUTGOING' THEN 1 END) as calls_made,
          COUNT(CASE WHEN type = 'CALL' AND (status = 'INCOMING' OR status = 'MISSED') THEN 1 END) as calls_incoming,
          COUNT(CASE WHEN type = 'CALL' AND status = 'CONNECTED' THEN 1 END) as calls_connected,
          COUNT(CASE WHEN type = 'CALL' AND status = 'CONNECTED' AND status = 'OUTGOING' THEN 1 END) as calls_outgoing_connected,
          COUNT(CASE WHEN type = 'CALL' AND status = 'CONNECTED' AND (status = 'INCOMING' OR status = 'ANSWERED') THEN 1 END) as calls_incoming_connected,
          COUNT(CASE WHEN type = 'CALL' AND status = 'MISSED' THEN 1 END) as calls_missed,
          COUNT(CASE WHEN type = 'CALL' AND status IN ('FAILED', 'BUSY', 'NO_ANSWER', 'NOT_PICKED') THEN 1 END) as calls_not_picked,
          COUNT(CASE WHEN type = 'SMS' THEN 1 END) as sms_count
        FROM events
        $where
    ");
    $stmt->execute($params);
    $stats = $stmt->fetch();

    jsonResponse($stats ?: [
        'calls_made' => 0,
        'calls_incoming' => 0,
        'calls_connected' => 0,
        'calls_outgoing_connected' => 0,
        'calls_incoming_connected' => 0,
        'calls_missed' => 0,
        'calls_not_picked' => 0,
        'sms_count' => 0,
    ]);
}

// -------------------------------------------------------------
// 6. Comprehensive Compliance & SLA Stats (Main Portal Data)
// -------------------------------------------------------------
if ($action === 'compliance-stats' && $method === 'GET') {
    $startDate = $_GET['startDate'] ?? date('Y-m-d');
    $endDate = $_GET['endDate'] ?? $startDate;
    $agentId = !empty($_GET['agent_id']) ? (int)$_GET['agent_id'] : null;
    $tagFilter = !empty($_GET['tag']) ? trim($_GET['tag']) : null;

    $settings = SettingsManager::getSettings();
    $allAgents = $pdo->query("SELECT * FROM agents ORDER BY name ASC")->fetchAll();

    // Query events in range
    $query = "
        SELECT e.*, COALESCE(a.name, 'Unknown Agent') as agent_name, COALESCE(a.tag, 'Uncategorised') as agent_tag
        FROM events e
        LEFT JOIN agents a ON e.agent_id = a.id
        WHERE DATE(e.timestamp) BETWEEN ? AND ?
    ";
    $params = [$startDate, $endDate];

    // Filter out internal contacts
    $internalPhones = $pdo->query("SELECT phone_number FROM internal_contacts")->fetchAll(PDO::FETCH_COLUMN);
    if (!empty($internalPhones)) {
        $phList = implode(',', array_fill(0, count($internalPhones), '?'));
        $query .= " AND e.target_phone NOT IN ($phList)";
        $params = array_merge($params, $internalPhones);
    }

    $query .= " ORDER BY e.timestamp ASC";
    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $events = $stmt->fetchAll();

    // Run Engine
    $evaluation = ComplianceEngine::evaluateCompliance($events, $allAgents, $settings);

    // Agent compliance summaries
    $agentSummaries = [];
    foreach ($allAgents as $ag) {
        $agId = (int)$ag['id'];
        $agentSummaries[$agId] = [
            'agent_id' => $agId,
            'agent_name' => $ag['name'],
            'tag' => $ag['tag'] ?: 'Uncategorised',
            'phone_number' => $ag['phone_number'],
            'installed_at' => $ag['installed_at'],
            'last_active_at' => $ag['last_active_at'],
            'incoming_callback_met' => 0,
            'incoming_callback_total' => 0,
            'incoming_callback_compliance_pct' => null,
            'outgoing_reconnect_met' => 0,
            'outgoing_reconnect_total' => 0,
            'outgoing_reconnect_compliance_pct' => null,
            'sms_followup_met' => 0,
            'sms_followup_total' => 0,
            'sms_followup_compliance_pct' => null,
            'combined_compliance_pct' => null,
            'open_obligations_count' => 0,
            'breaches_attributed_count' => 0,
            'calls_made' => 0,
            'calls_incoming' => 0,
            'calls_connected' => 0,
            'calls_outgoing_connected' => 0,
            'calls_incoming_connected' => 0,
            'calls_not_picked' => 0,
            'calls_missed' => 0,
            'sms_count' => 0,
        ];
    }

    // Populate event volume counts for agents
    foreach ($events as $ev) {
        $aid = (int)($ev['agent_id'] ?? 0);
        if ($aid && isset($agentSummaries[$aid])) {
            if ($ev['type'] === 'CALL') {
                if ($ev['status'] === 'OUTGOING') $agentSummaries[$aid]['calls_made']++;
                if ($ev['status'] === 'INCOMING') $agentSummaries[$aid]['calls_incoming']++;
                if ($ev['status'] === 'MISSED') $agentSummaries[$aid]['calls_missed']++;
                if ($ev['status'] === 'CONNECTED') {
                    $agentSummaries[$aid]['calls_connected']++;
                    $agentSummaries[$aid]['calls_outgoing_connected']++;
                }
                if (in_array($ev['status'], ['FAILED', 'BUSY', 'NO_ANSWER', 'NOT_PICKED'])) {
                    $agentSummaries[$aid]['calls_not_picked']++;
                }
            } elseif ($ev['type'] === 'SMS') {
                $agentSummaries[$aid]['sms_count']++;
            }
        }
    }

    // Process obligations
    $openObligations = [];
    $allObls = $evaluation['allObligations'];

    $headline = [
        'incoming_callback_met' => 0,
        'incoming_callback_total' => 0,
        'incoming_callback_compliance_pct' => null,
        'outgoing_reconnect_met' => 0,
        'outgoing_reconnect_total' => 0,
        'outgoing_reconnect_compliance_pct' => null,
        'sms_followup_met' => 0,
        'sms_followup_total' => 0,
        'sms_followup_compliance_pct' => null,
        'open_incoming_count' => 0,
        'open_outgoing_count' => 0,
        'open_sms_count' => 0,
        'total_open_obligations' => 0,
    ];

    foreach ($allObls as $obl) {
        $origId = (int)($obl['originating_agent_id'] ?? 0);
        $type = $obl['obligation_type'];
        $status = $obl['status'];

        if ($status === 'OPEN') {
            $headline['total_open_obligations']++;
            if ($type === 'MISSED_INCOMING_CALLBACK') $headline['open_incoming_count']++;
            if ($type === 'OUTGOING_RECONNECTION') $headline['open_outgoing_count']++;
            if ($type === 'SMS_FOLLOWUP') $headline['open_sms_count']++;
            $openObligations[] = $obl;
        } else {
            if ($type === 'MISSED_INCOMING_CALLBACK') {
                $headline['incoming_callback_total']++;
                if ($status === 'MET') $headline['incoming_callback_met']++;
            } elseif ($type === 'OUTGOING_RECONNECTION') {
                $headline['outgoing_reconnect_total']++;
                if ($status === 'MET') $headline['outgoing_reconnect_met']++;
            } elseif ($type === 'SMS_FOLLOWUP') {
                $headline['sms_followup_total']++;
                if ($status === 'MET') $headline['sms_followup_met']++;
            }
        }

        if ($origId && isset($agentSummaries[$origId])) {
            if ($status === 'OPEN') {
                $agentSummaries[$origId]['open_obligations_count']++;
            } elseif ($status === 'BREACHED') {
                $agentSummaries[$origId]['breaches_attributed_count']++;
            }

            if ($type === 'MISSED_INCOMING_CALLBACK' && $status !== 'OPEN') {
                $agentSummaries[$origId]['incoming_callback_total']++;
                if ($status === 'MET') $agentSummaries[$origId]['incoming_callback_met']++;
            } elseif ($type === 'OUTGOING_RECONNECTION' && $status !== 'OPEN') {
                $agentSummaries[$origId]['outgoing_reconnect_total']++;
                if ($status === 'MET') $agentSummaries[$origId]['outgoing_reconnect_met']++;
            } elseif ($type === 'SMS_FOLLOWUP' && $status !== 'OPEN') {
                $agentSummaries[$origId]['sms_followup_total']++;
                if ($status === 'MET') $agentSummaries[$origId]['sms_followup_met']++;
            }
        }
    }

    // Compute Headline Percentages
    if ($headline['incoming_callback_total'] > 0) {
        $headline['incoming_callback_compliance_pct'] = round(($headline['incoming_callback_met'] / $headline['incoming_callback_total']) * 100, 1);
    }
    if ($headline['outgoing_reconnect_total'] > 0) {
        $headline['outgoing_reconnect_compliance_pct'] = round(($headline['outgoing_reconnect_met'] / $headline['outgoing_reconnect_total']) * 100, 1);
    }
    if ($headline['sms_followup_total'] > 0) {
        $headline['sms_followup_compliance_pct'] = round(($headline['sms_followup_met'] / $headline['sms_followup_total']) * 100, 1);
    }

    // Compute Agent Percentages
    foreach ($agentSummaries as &$s) {
        if ($s['incoming_callback_total'] > 0) {
            $s['incoming_callback_compliance_pct'] = round(($s['incoming_callback_met'] / $s['incoming_callback_total']) * 100, 1);
        }
        if ($s['outgoing_reconnect_total'] > 0) {
            $s['outgoing_reconnect_compliance_pct'] = round(($s['outgoing_reconnect_met'] / $s['outgoing_reconnect_total']) * 100, 1);
        }
        if ($s['sms_followup_total'] > 0) {
            $s['sms_followup_compliance_pct'] = round(($s['sms_followup_met'] / $s['sms_followup_total']) * 100, 1);
        }
        $totMet = $s['incoming_callback_met'] + $s['outgoing_reconnect_met'] + $s['sms_followup_met'];
        $totAll = $s['incoming_callback_total'] + $s['outgoing_reconnect_total'] + $s['sms_followup_total'];
        if ($totAll > 0) {
            $s['combined_compliance_pct'] = round(($totMet / $totAll) * 100, 1);
        }
    }

    // Tag Summaries
    $tagGroups = [];
    foreach ($agentSummaries as $s) {
        $t = $s['tag'] ?: 'Uncategorised';
        if (!isset($tagGroups[$t])) {
            $tagGroups[$t] = [
                'tag' => $t,
                'agent_count' => 0,
                'incoming_met' => 0,
                'incoming_total' => 0,
                'outgoing_met' => 0,
                'outgoing_total' => 0,
                'sms_met' => 0,
                'sms_total' => 0,
            ];
        }
        $tagGroups[$t]['agent_count']++;
        $tagGroups[$t]['incoming_met'] += $s['incoming_callback_met'];
        $tagGroups[$t]['incoming_total'] += $s['incoming_callback_total'];
        $tagGroups[$t]['outgoing_met'] += $s['outgoing_reconnect_met'];
        $tagGroups[$t]['outgoing_total'] += $s['outgoing_reconnect_total'];
        $tagGroups[$t]['sms_met'] += $s['sms_followup_met'];
        $tagGroups[$t]['sms_total'] += $s['sms_followup_total'];
    }

    $finalTagSummaries = [];
    foreach ($tagGroups as $tg) {
        $inPct = $tg['incoming_total'] > 0 ? round(($tg['incoming_met'] / $tg['incoming_total']) * 100, 1) : null;
        $outPct = $tg['outgoing_total'] > 0 ? round(($tg['outgoing_met'] / $tg['outgoing_total']) * 100, 1) : null;
        $smsPct = $tg['sms_total'] > 0 ? round(($tg['sms_met'] / $tg['sms_total']) * 100, 1) : null;
        $totMet = $tg['incoming_met'] + $tg['outgoing_met'] + $tg['sms_met'];
        $totAll = $tg['incoming_total'] + $tg['outgoing_total'] + $tg['sms_total'];
        $combPct = $totAll > 0 ? round(($totMet / $totAll) * 100, 1) : null;

        $finalTagSummaries[] = [
            'tag' => $tg['tag'],
            'agent_count' => $tg['agent_count'],
            'incoming_compliance_pct' => $inPct,
            'outgoing_compliance_pct' => $outPct,
            'sms_compliance_pct' => $smsPct,
            'combined_compliance_pct' => $combPct,
        ];
    }

    jsonResponse([
        'settings' => $settings,
        'headline_stats' => $headline,
        'agent_summaries' => array_values($agentSummaries),
        'tag_summaries' => $finalTagSummaries,
        'open_obligations' => $openObligations,
        'all_obligations' => $allObls,
        'all_events' => array_slice(array_reverse($events), 0, 300),
        'turnaround_report' => $evaluation['turnaroundReport'],
        'total_evaluated_events' => count($events),
        'startDate' => $startDate,
        'endDate' => $endDate,
    ]);
}

// -------------------------------------------------------------
// 7. Contact Thread / History Inspector
// -------------------------------------------------------------
if ($action === 'contact-history' && $method === 'GET') {
    $phone = trim($_GET['phone'] ?? '');
    if (!$phone) {
        jsonResponse(['error' => 'Phone number is required'], 400);
    }

    $stmt = $pdo->prepare("
        SELECT e.*, COALESCE(a.name, 'Unknown Agent') as agent_name, COALESCE(a.tag, 'Uncategorised') as agent_tag
        FROM events e
        LEFT JOIN agents a ON e.agent_id = a.id
        WHERE e.target_phone = ?
        ORDER BY e.timestamp ASC
    ");
    $stmt->execute([$phone]);
    $events = $stmt->fetchAll();

    $settings = SettingsManager::getSettings();
    $allAgents = $pdo->query("SELECT * FROM agents")->fetchAll();
    $evaluation = ComplianceEngine::evaluateCompliance($events, $allAgents, $settings);

    jsonResponse([
        'phone' => $phone,
        'events' => $events,
        'obligations' => $evaluation['allObligations'],
        'labels' => $evaluation['complianceLabels'],
    ]);
}

// -------------------------------------------------------------
// 8. Master Settings Endpoints
// -------------------------------------------------------------
if ($action === 'settings' && $method === 'GET') {
    jsonResponse(SettingsManager::getSettings());
}

if ($action === 'settings' && $method === 'POST') {
    $input = getJsonInput();
    $updated = SettingsManager::saveSettings($input, $input['changed_by'] ?? 'admin');
    jsonResponse([
        'status' => 'success',
        'settings' => $updated,
    ]);
}

if ($action === 'settings-logs' && $method === 'GET') {
    jsonResponse(SettingsManager::getChangeLogs());
}

// -------------------------------------------------------------
// 9. Internal Contacts Exclusions
// -------------------------------------------------------------
if ($action === 'internal-contacts' && $method === 'GET') {
    $contacts = $pdo->query("SELECT * FROM internal_contacts ORDER BY created_at DESC")->fetchAll();
    jsonResponse($contacts);
}

if ($action === 'internal-contacts' && $method === 'POST') {
    $input = getJsonInput();
    $phone = trim($input['phone_number'] ?? '');
    $label = trim($input['label'] ?? 'Internal Staff');

    if (!$phone) {
        jsonResponse(['error' => 'Phone number is required'], 400);
    }

    $stmt = $pdo->prepare("INSERT INTO internal_contacts (phone_number, label) VALUES (?, ?)");
    $stmt->execute([$phone, $label]);

    jsonResponse(['status' => 'success', 'id' => $pdo->lastInsertId()]);
}

if ($action === 'delete-internal-contact' && $method === 'POST') {
    $input = getJsonInput();
    $id = (int)($input['id'] ?? 0);
    if ($id) {
        $stmt = $pdo->prepare("DELETE FROM internal_contacts WHERE id = ?");
        $stmt->execute([$id]);
    }
    jsonResponse(['status' => 'success', 'deleted_id' => $id]);
}

// -------------------------------------------------------------
// 10. Agent Management Endpoints
// -------------------------------------------------------------
if ($action === 'agents' && $method === 'GET') {
    $agents = $pdo->query("SELECT * FROM agents ORDER BY name ASC")->fetchAll();
    jsonResponse($agents);
}

if ($action === 'update-agent-tag' && $method === 'POST') {
    $input = getJsonInput();
    $agentId = (int)($input['agent_id'] ?? 0);
    $tag = trim($input['tag'] ?? 'Uncategorised');

    if ($agentId) {
        $stmt = $pdo->prepare("UPDATE agents SET tag = ? WHERE id = ?");
        $stmt->execute([$tag, $agentId]);
        jsonResponse(['status' => 'success']);
    }
    jsonResponse(['error' => 'Agent ID required'], 400);
}

// -------------------------------------------------------------
// 11. Mock Data Seeder
// -------------------------------------------------------------
if ($action === 'seed-data' && $method === 'POST') {
    require_once __DIR__ . '/seed.php';
    $result = runSolvitSeed($pdo);
    jsonResponse($result);
}

// Fallback 404
jsonResponse(['error' => 'API action not found: ' . $action], 404);
