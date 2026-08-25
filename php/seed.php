<?php
/**
 * Solvit Communications & Compliance - Realistic Database Seeder
 */

require_once __DIR__ . '/config.php';

function runSolvitSeed($pdo) {
    // Clear existing events (optional: preserve agents)
    $pdo->exec("DELETE FROM events");
    
    // Default Agents
    $defaultAgents = [
        ['name' => 'Mercy Wanjiku', 'tag' => 'Sales', 'phone' => '+254711000001'],
        ['name' => 'Brian Omondi', 'tag' => 'Sales', 'phone' => '+254711000002'],
        ['name' => 'Kevin Kiprop', 'tag' => 'Customer Care', 'phone' => '+254711000003'],
        ['name' => 'Faith Muthoni', 'tag' => 'Customer Care', 'phone' => '+254711000004'],
        ['name' => 'David Kimani', 'tag' => 'Field Operations', 'phone' => '+254711000005'],
        ['name' => 'Sylvia Achieng', 'tag' => 'Dispatch', 'phone' => '+254711000006'],
    ];

    $agentIds = [];
    foreach ($defaultAgents as $ag) {
        $stmt = $pdo->prepare("
                INSERT INTO agents (name, tag, phone_number, last_active_at)
                VALUES (?, ?, ?, NOW())
                ON CONFLICT(name) DO UPDATE SET tag = EXCLUDED.tag, phone_number = EXCLUDED.phone_number, last_active_at = NOW()
            ");
        $stmt->execute([$ag['name'], $ag['tag'], $ag['phone']]);

        $row = $pdo->query("SELECT id FROM agents WHERE name = " . $pdo->quote($ag['name']))->fetch();
        $agentIds[$ag['name']] = (int)$row['id'];
    }

    // Generate realistic clients and events over the past 3 days
    $clientPhones = [
        '+254722101010', '+254733202020', '+254744303030', '+254755404040',
        '+254766505050', '+254777606060', '+254788707070', '+254799808080',
        '+254712345678', '+254723456789', '+254734567890', '+254745678901'
    ];

    $eventsInserted = 0;
    $now = time();

    // Event 1: Inbound Missed -> Callback MET (within 12 mins)
    $t1 = $now - (3600 * 5);
    $agentMercy = $agentIds['Mercy Wanjiku'];
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'MISSED', 0, ?)")
        ->execute([$agentMercy, '+254722101010', date('Y-m-d H:i:s', $t1)]);
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'OUTGOING', 0, ?)")
        ->execute([$agentMercy, '+254722101010', date('Y-m-d H:i:s', $t1 + 600)]);
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'CONNECTED', 145, ?)")
        ->execute([$agentMercy, '+254722101010', date('Y-m-d H:i:s', $t1 + 720)]);
    $eventsInserted += 3;

    // Event 2: Inbound Missed -> Callback BREACHED (after 45 mins)
    $t2 = $now - (3600 * 8);
    $agentBrian = $agentIds['Brian Omondi'];
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'MISSED', 0, ?)")
        ->execute([$agentBrian, '+254733202020', date('Y-m-d H:i:s', $t2)]);
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'CONNECTED', 210, ?)")
        ->execute([$agentBrian, '+254733202020', date('Y-m-d H:i:s', $t2 + 2700)]);
    $eventsInserted += 2;

    // Event 3: Inbound Missed -> Still OPEN (10 mins ago)
    $t3 = $now - 600;
    $agentKevin = $agentIds['Kevin Kiprop'];
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'MISSED', 0, ?)")
        ->execute([$agentKevin, '+254744303030', date('Y-m-d H:i:s', $t3)]);
    $eventsInserted += 1;

    // Event 4: Outgoing Failed -> SMS Sent MET (within 8 mins)
    $t4 = $now - (3600 * 3);
    $agentFaith = $agentIds['Faith Muthoni'];
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'NO_ANSWER', 0, ?)")
        ->execute([$agentFaith, '+254755404040', date('Y-m-d H:i:s', $t4)]);
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'SMS', ?, 'SENT', 0, ?)")
        ->execute([$agentFaith, '+254755404040', date('Y-m-d H:i:s', $t4 + 480)]);
    // Reconnection MET within 4 hours
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'CONNECTED', 95, ?)")
        ->execute([$agentFaith, '+254755404040', date('Y-m-d H:i:s', $t4 + 14400)]);
    $eventsInserted += 3;

    // Event 5: Outgoing Failed -> SMS Sent BREACHED (after 50 mins)
    $t5 = $now - (3600 * 6);
    $agentDavid = $agentIds['David Kimani'];
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, 'BUSY', 0, ?)")
        ->execute([$agentDavid, '+254766505050', date('Y-m-d H:i:s', $t5)]);
    $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'SMS', ?, 'SENT', 0, ?)")
        ->execute([$agentDavid, '+254766505050', date('Y-m-d H:i:s', $t5 + 3000)]);
    $eventsInserted += 2;

    // Event 6: Direct Connected Inbound & Outbound calls
    for ($i = 0; $i < 15; $i++) {
        $agName = array_rand($agentIds);
        $aid = $agentIds[$agName];
        $clPhone = $clientPhones[array_rand($clientPhones)];
        $randTime = $now - rand(1800, 86400 * 2);
        $status = rand(0, 1) ? 'CONNECTED' : 'OUTGOING';
        $dur = rand(45, 600);
        $pdo->prepare("INSERT INTO events (agent_id, type, target_phone, status, duration, timestamp) VALUES (?, 'CALL', ?, ?, ?, ?)")
            ->execute([$aid, $clPhone, $status, $dur, date('Y-m-d H:i:s', $randTime)]);
        $eventsInserted++;
    }

    return [
        'status' => 'success',
        'message' => "Successfully seeded {$eventsInserted} events across " . count($defaultAgents) . " agents.",
        'agents_count' => count($defaultAgents),
        'events_count' => $eventsInserted
    ];
}

// Standalone execution check
if (php_sapi_name() === 'cli' || (isset($_GET['run']) && $_GET['run'] === '1')) {
    $pdo = getDbConnection();
    $res = runSolvitSeed($pdo);
    header('Content-Type: application/json');
    echo json_encode($res, JSON_PRETTY_PRINT);
}
