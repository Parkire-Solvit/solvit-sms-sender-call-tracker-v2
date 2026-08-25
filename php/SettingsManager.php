<?php
/**
 * Solvit Master Settings Manager
 * Handles system thresholds, working hours schedule, clock mode, and change audit logging.
 */

require_once __DIR__ . '/config.php';

class SettingsManager {
    public static function getDefaultSettings() {
        return [
            'callback_window_minutes' => 30,
            'reconnection_window_minutes' => 1440,
            'sms_followup_enabled' => true,
            'sms_deadline_minutes' => 30,
            'working_hours_schedule' => [
                'monday' => ['enabled' => true, 'open' => '09:00', 'close' => '17:00'],
                'tuesday' => ['enabled' => true, 'open' => '09:00', 'close' => '17:00'],
                'wednesday' => ['enabled' => true, 'open' => '09:00', 'close' => '17:00'],
                'thursday' => ['enabled' => true, 'open' => '09:00', 'close' => '17:00'],
                'friday' => ['enabled' => true, 'open' => '09:00', 'close' => '17:00'],
                'saturday' => ['enabled' => true, 'open' => '09:00', 'close' => '12:00'],
                'sunday' => ['enabled' => false, 'open' => '09:00', 'close' => '17:00'],
            ],
            'clock_mode' => 'working_hours',
            'min_connection_duration' => 0,
        ];
    }

    public static function getSettings() {
        $pdo = getDbConnection();
        $stmt = $pdo->query("SELECT * FROM system_settings WHERE id = 1 LIMIT 1");
        $row = $stmt->fetch();

        if (!$row) {
            $default = self::getDefaultSettings();
            self::saveSettings($default, 'system_init');
            return $default;
        }

        $schedule = json_decode($row['working_hours_schedule'], true);
        if (!$schedule || !is_array($schedule)) {
            $schedule = self::getDefaultSettings()['working_hours_schedule'];
        }

        return [
            'callback_window_minutes' => (int)$row['callback_window_minutes'],
            'reconnection_window_minutes' => (int)$row['reconnection_window_minutes'],
            'sms_followup_enabled' => (bool)$row['sms_followup_enabled'],
            'sms_deadline_minutes' => (int)$row['sms_deadline_minutes'],
            'working_hours_schedule' => $schedule,
            'clock_mode' => $row['clock_mode'] ?: 'working_hours',
            'min_connection_duration' => (int)($row['min_connection_duration'] ?? 0),
        ];
    }

    public static function saveSettings($newSettings, $changedBy = 'admin') {
        $pdo = getDbConnection();
        $current = self::getSettings();

        // Detect and log changes
        $trackKeys = [
            'callback_window_minutes',
            'reconnection_window_minutes',
            'sms_followup_enabled',
            'sms_deadline_minutes',
            'clock_mode',
            'min_connection_duration'
        ];

        foreach ($trackKeys as $key) {
            if (isset($newSettings[$key]) && $newSettings[$key] != $current[$key]) {
                $stmt = $pdo->prepare("INSERT INTO settings_change_log (setting_key, old_value, new_value, changed_by, created_at) VALUES (?, ?, ?, ?, NOW())");
                $stmt->execute([
                    $key,
                    json_encode($current[$key]),
                    json_encode($newSettings[$key]),
                    $changedBy
                ]);
            }
        }

        if (isset($newSettings['working_hours_schedule']) && json_encode($newSettings['working_hours_schedule']) !== json_encode($current['working_hours_schedule'])) {
            $stmt = $pdo->prepare("INSERT INTO settings_change_log (setting_key, old_value, new_value, changed_by, created_at) VALUES (?, ?, ?, ?, NOW())");
            $stmt->execute([
                'working_hours_schedule',
                json_encode($current['working_hours_schedule']),
                json_encode($newSettings['working_hours_schedule']),
                $changedBy
            ]);
        }

        $merged = array_merge($current, $newSettings);
        $scheduleJson = json_encode($merged['working_hours_schedule']);

        $sql = "INSERT INTO system_settings (id, callback_window_minutes, reconnection_window_minutes, sms_followup_enabled, sms_deadline_minutes, working_hours_schedule, clock_mode, min_connection_duration)
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (id) DO UPDATE SET
                      callback_window_minutes = EXCLUDED.callback_window_minutes,
                      reconnection_window_minutes = EXCLUDED.reconnection_window_minutes,
                      sms_followup_enabled = EXCLUDED.sms_followup_enabled,
                      sms_deadline_minutes = EXCLUDED.sms_deadline_minutes,
                      working_hours_schedule = EXCLUDED.working_hours_schedule,
                      clock_mode = EXCLUDED.clock_mode,
                      min_connection_duration = EXCLUDED.min_connection_duration,
                      updated_at = CURRENT_TIMESTAMP";

        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            $merged['callback_window_minutes'],
            $merged['reconnection_window_minutes'],
            $merged['sms_followup_enabled'] ? 1 : 0,
            $merged['sms_deadline_minutes'],
            $scheduleJson,
            $merged['clock_mode'],
            $merged['min_connection_duration']
        ]);

        return $merged;
    }

    public static function getChangeLogs() {
        $pdo = getDbConnection();
        $stmt = $pdo->query("SELECT * FROM settings_change_log ORDER BY created_at DESC LIMIT 50");
        return $stmt->fetchAll();
    }
}
