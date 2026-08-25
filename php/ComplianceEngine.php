<?php
/**
 * Solvit Compliance & SLA Turnaround Engine (PHP 8.x)
 * 
 * Accurately calculates working hours elapsed time, SLA compliance status (MET / BREACHED / OPEN),
 * deduplicated obligations, and mean/median turnaround metrics across all agents and tags.
 */

class ComplianceEngine {
    const NAIROBI_OFFSET_SECONDS = 3 * 3600; // UTC+3

    /**
     * Check if a timestamp is within the active working hours schedule
     */
    public static function isWithinWorkingHours($timestamp, $schedule) {
        $dayName = strtolower(date('l', $timestamp));
        if (!isset($schedule[$dayName]) || empty($schedule[$dayName]['enabled'])) {
            return false;
        }

        $openParts = explode(':', $schedule[$dayName]['open'] ?? '09:00');
        $closeParts = explode(':', $schedule[$dayName]['close'] ?? '17:00');

        $openMins = ((int)$openParts[0] * 60) + (int)($openParts[1] ?? 0);
        $closeMins = ((int)$closeParts[0] * 60) + (int)($closeParts[1] ?? 0);

        $currMins = ((int)date('G', $timestamp) * 60) + (int)date('i', $timestamp);

        return $currMins >= $openMins && $currMins < $closeMins;
    }

    /**
     * Advance to the next opening working hour slot if outside working hours
     */
    public static function getNextOpeningTime($timestamp, $schedule) {
        if (self::isWithinWorkingHours($timestamp, $schedule)) {
            return $timestamp;
        }

        $curr = $timestamp;
        for ($i = 0; $i < 14; $i++) {
            $dayName = strtolower(date('l', $curr));
            $currMins = ((int)date('G', $curr) * 60) + (int)date('i', $curr);
            $currSecs = (int)date('s', $curr);

            if (isset($schedule[$dayName]) && !empty($schedule[$dayName]['enabled'])) {
                $openParts = explode(':', $schedule[$dayName]['open'] ?? '09:00');
                $openMins = ((int)$openParts[0] * 60) + (int)($openParts[1] ?? 0);

                if ($currMins < $openMins) {
                    $diffMins = $openMins - $currMins;
                    return $curr + ($diffMins * 60) - $currSecs;
                }
            }

            // Advance to midnight of next day
            $minsUntilMidnight = (24 * 60) - $currMins;
            $curr = $curr + ($minsUntilMidnight * 60) - $currSecs;
        }

        return $timestamp;
    }

    /**
     * Calculate elapsed working minutes between two Unix timestamps
     */
    public static function calculateElapsedMinutes($startTimestamp, $endTimestamp, $schedule, $clockMode = 'working_hours') {
        if ($startTimestamp >= $endTimestamp) return 0.0;

        if ($clockMode === 'continuous_24_7') {
            return round(($endTimestamp - $startTimestamp) / 60, 1);
        }

        $workingMinutes = 0;
        $cursor = $startTimestamp;

        if (!self::isWithinWorkingHours($cursor, $schedule)) {
            $cursor = self::getNextOpeningTime($cursor, $schedule);
            if ($cursor >= $endTimestamp) return 0.0;
        }

        while ($cursor < $endTimestamp) {
            $dayName = strtolower(date('l', $cursor));
            if (!isset($schedule[$dayName]) || empty($schedule[$dayName]['enabled'])) {
                $cursor = self::getNextOpeningTime($cursor, $schedule);
                continue;
            }

            $openParts = explode(':', $schedule[$dayName]['open'] ?? '09:00');
            $closeParts = explode(':', $schedule[$dayName]['close'] ?? '17:00');
            $openMins = ((int)$openParts[0] * 60) + (int)($openParts[1] ?? 0);
            $closeMins = ((int)$closeParts[0] * 60) + (int)($closeParts[1] ?? 0);
            $currMins = ((int)date('G', $cursor) * 60) + (int)date('i', $cursor);

            if ($currMins < $openMins) {
                $cursor = self::getNextOpeningTime($cursor, $schedule);
                continue;
            }

            if ($currMins >= $closeMins) {
                $cursor = self::getNextOpeningTime($cursor, $schedule);
                continue;
            }

            $availableMinsToday = $closeMins - $currMins;
            $minsUntilEnd = ($endTimestamp - $cursor) / 60;

            $chunk = min($availableMinsToday, $minsUntilEnd);
            $workingMinutes += $chunk;
            $cursor += (int)($chunk * 60);
        }

        return round($workingMinutes, 1);
    }

    /**
     * Calculate deadline timestamp
     */
    public static function calculateDeadlineTimestamp($startTimestamp, $windowMinutes, $schedule, $clockMode = 'working_hours') {
        if ($clockMode === 'continuous_24_7') {
            return $startTimestamp + ($windowMinutes * 60);
        }

        $cursor = $startTimestamp;
        if (!self::isWithinWorkingHours($cursor, $schedule)) {
            $cursor = self::getNextOpeningTime($cursor, $schedule);
        }

        $remainingWindow = $windowMinutes;
        while ($remainingWindow > 0) {
            $dayName = strtolower(date('l', $cursor));
            if (!isset($schedule[$dayName]) || empty($schedule[$dayName]['enabled'])) {
                $cursor = self::getNextOpeningTime($cursor, $schedule);
                continue;
            }

            $openParts = explode(':', $schedule[$dayName]['open'] ?? '09:00');
            $closeParts = explode(':', $schedule[$dayName]['close'] ?? '17:00');
            $openMins = ((int)$openParts[0] * 60) + (int)($openParts[1] ?? 0);
            $closeMins = ((int)$closeParts[0] * 60) + (int)($closeParts[1] ?? 0);
            $currMins = ((int)date('G', $cursor) * 60) + (int)date('i', $cursor);

            if ($currMins < $openMins) {
                $cursor = self::getNextOpeningTime($cursor, $schedule);
                continue;
            }

            if ($currMins >= $closeMins) {
                $cursor = self::getNextOpeningTime($cursor, $schedule);
                continue;
            }

            $availableToday = $closeMins - $currMins;
            if ($remainingWindow <= $availableToday) {
                $cursor += ($remainingWindow * 60);
                $remainingWindow = 0;
            } else {
                $remainingWindow -= $availableToday;
                $cursor += ($availableToday * 60);
                $cursor = self::getNextOpeningTime($cursor, $schedule);
            }
        }

        return $cursor;
    }

    /**
     * Calculate Mean and Median metric helper
     */
    public static function calculateMeanMedian(array $values, $threshold) {
        if (empty($values)) {
            return [
                'mean' => null,
                'median' => null,
                'count' => 0,
                'threshold' => $threshold,
                'status' => 'NO_DATA'
            ];
        }

        sort($values);
        $count = count($values);
        $sum = array_sum($values);
        $mean = round($sum / $count, 1);

        $mid = (int)floor($count / 2);
        if ($count % 2 !== 0) {
            $median = round($values[$mid], 1);
        } else {
            $median = round(($values[$mid - 1] + $values[$mid]) / 2, 1);
        }

        $status = 'OPTIMAL';
        if ($median > $threshold) {
            $status = 'BREACHED';
        } elseif ($median > ($threshold * 0.75)) {
            $status = 'WARNING';
        }

        return [
            'mean' => $mean,
            'median' => $median,
            'count' => $count,
            'threshold' => $threshold,
            'status' => $status,
        ];
    }

    /**
     * Comprehensive Compliance & TAT Evaluation
     */
    public static function evaluateCompliance(array $events, array $agents, array $settings, $evalNow = null) {
        if ($evalNow === null) {
            $evalNow = time();
        }

        $agentsMap = [];
        foreach ($agents as $a) {
            $agentsMap[$a['id']] = $a;
        }

        // Sort events chronologically (oldest first)
        usort($events, function($a, $b) {
            return strtotime($a['timestamp']) <=> strtotime($b['timestamp']);
        });

        // Group events by target_phone
        $threadsByPhone = [];
        foreach ($events as $ev) {
            $phone = trim($ev['target_phone'] ?? '');
            if (!$phone) continue;
            $threadsByPhone[$phone][] = $ev;
        }

        $allObligations = [];
        $complianceLabels = [];

        // Turnaround collector arrays
        $ttMissedToFirstAttempt = [];
        $ttMissedToConnection = [];
        $ttFailedOutToNextAttempt = [];
        $ttFailedOutToConnection = [];
        $ttFailedOutToSms = [];

        $minDuration = (int)($settings['min_connection_duration'] ?? 0);
        $schedule = $settings['working_hours_schedule'];
        $clockMode = $settings['clock_mode'] ?? 'working_hours';

        foreach ($threadsByPhone as $phone => $threadEvents) {
            $openIncomingObligation = null;
            $openOutgoingObligation = null;
            $openSmsObligation = null;

            foreach ($threadEvents as $ev) {
                $evTime = strtotime($ev['timestamp']);
                $agent = isset($ev['agent_id']) && isset($agentsMap[$ev['agent_id']]) ? $agentsMap[$ev['agent_id']] : null;
                $agentName = $agent['name'] ?? $ev['agent_name'] ?? 'Unknown Agent';
                $agentTag = $agent['tag'] ?? 'Uncategorised';

                $dur = (int)($ev['duration'] ?? 0);
                $isConnected = ($ev['type'] === 'CALL' && $ev['status'] === 'CONNECTED' && $dur >= $minDuration);

                // 1. RESOLUTION CHECKS
                if ($isConnected) {
                    if ($openIncomingObligation) {
                        $trigTime = strtotime($openIncomingObligation['trigger_timestamp']);
                        $deadTime = strtotime($openIncomingObligation['deadline_timestamp']);
                        $turnaround = self::calculateElapsedMinutes($trigTime, $evTime, $schedule, $clockMode);
                        $isMet = ($evTime <= $deadTime);

                        $openIncomingObligation['status'] = $isMet ? 'MET' : 'BREACHED';
                        $openIncomingObligation['resolution_timestamp'] = date('Y-m-d H:i:s', $evTime);
                        $openIncomingObligation['resolving_agent_id'] = $ev['agent_id'] ?? null;
                        $openIncomingObligation['resolving_agent_name'] = $agentName;
                        $openIncomingObligation['turnaround_minutes'] = $turnaround;

                        if ($isMet) {
                            $openIncomingObligation['attributed_agent_id'] = null;
                            $complianceLabels[$ev['id']] = ['effect' => 'CLEARED_OBLIGATION', 'note' => 'Connected Missed Callback'];
                        } else {
                            $openIncomingObligation['attributed_agent_id'] = $openIncomingObligation['originating_agent_id'];
                            $openIncomingObligation['attributed_agent_name'] = $openIncomingObligation['originating_agent_name'];
                        }

                        $ttMissedToConnection[] = [
                            'mins' => $turnaround,
                            'tag' => $openIncomingObligation['originating_agent_tag'],
                            'agent_id' => $openIncomingObligation['originating_agent_id'] ?? 0,
                        ];

                        $allObligations[] = $openIncomingObligation;
                        $openIncomingObligation = null;
                    }

                    if ($openOutgoingObligation) {
                        $trigTime = strtotime($openOutgoingObligation['trigger_timestamp']);
                        $deadTime = strtotime($openOutgoingObligation['deadline_timestamp']);
                        $turnaround = self::calculateElapsedMinutes($trigTime, $evTime, $schedule, $clockMode);
                        $isMet = ($evTime <= $deadTime);

                        $openOutgoingObligation['status'] = $isMet ? 'MET' : 'BREACHED';
                        $openOutgoingObligation['resolution_timestamp'] = date('Y-m-d H:i:s', $evTime);
                        $openOutgoingObligation['resolving_agent_id'] = $ev['agent_id'] ?? null;
                        $openOutgoingObligation['resolving_agent_name'] = $agentName;
                        $openOutgoingObligation['turnaround_minutes'] = $turnaround;

                        if ($isMet) {
                            $openOutgoingObligation['attributed_agent_id'] = null;
                            if (!isset($complianceLabels[$ev['id']])) {
                                $complianceLabels[$ev['id']] = ['effect' => 'CLEARED_OBLIGATION', 'note' => 'Connected Reconnection'];
                            }
                        } else {
                            $openOutgoingObligation['attributed_agent_id'] = $openOutgoingObligation['originating_agent_id'];
                            $openOutgoingObligation['attributed_agent_name'] = $openOutgoingObligation['originating_agent_name'];
                        }

                        $ttFailedOutToConnection[] = [
                            'mins' => $turnaround,
                            'tag' => $openOutgoingObligation['originating_agent_tag'],
                            'agent_id' => $openOutgoingObligation['originating_agent_id'] ?? 0,
                        ];

                        $allObligations[] = $openOutgoingObligation;
                        $openOutgoingObligation = null;
                    }
                }

                // Callback Attempts
                if ($ev['type'] === 'CALL' && $ev['status'] === 'OUTGOING') {
                    if ($openIncomingObligation && empty($openIncomingObligation['resolution_timestamp'])) {
                        $trigTime = strtotime($openIncomingObligation['trigger_timestamp']);
                        $turnaround = self::calculateElapsedMinutes($trigTime, $evTime, $schedule, $clockMode);
                        $ttMissedToFirstAttempt[] = [
                            'mins' => $turnaround,
                            'tag' => $openIncomingObligation['originating_agent_tag'],
                            'agent_id' => $openIncomingObligation['originating_agent_id'] ?? 0,
                        ];
                    }
                    if ($openOutgoingObligation && empty($openOutgoingObligation['resolution_timestamp'])) {
                        $trigTime = strtotime($openOutgoingObligation['trigger_timestamp']);
                        $turnaround = self::calculateElapsedMinutes($trigTime, $evTime, $schedule, $clockMode);
                        $ttFailedOutToNextAttempt[] = [
                            'mins' => $turnaround,
                            'tag' => $openOutgoingObligation['originating_agent_tag'],
                            'agent_id' => $openOutgoingObligation['originating_agent_id'] ?? 0,
                        ];
                    }
                }

                // SMS Follow-up Resolution
                if ($ev['type'] === 'SMS' && $openSmsObligation) {
                    $trigTime = strtotime($openSmsObligation['trigger_timestamp']);
                    $deadTime = strtotime($openSmsObligation['deadline_timestamp']);
                    $turnaround = self::calculateElapsedMinutes($trigTime, $evTime, $schedule, $clockMode);
                    $isMet = ($evTime <= $deadTime);

                    $openSmsObligation['status'] = $isMet ? 'MET' : 'BREACHED';
                    $openSmsObligation['resolution_timestamp'] = date('Y-m-d H:i:s', $evTime);
                    $openSmsObligation['resolving_agent_id'] = $ev['agent_id'] ?? null;
                    $openSmsObligation['resolving_agent_name'] = $agentName;
                    $openSmsObligation['turnaround_minutes'] = $turnaround;
                    $openSmsObligation['sms_sent'] = true;
                    $openSmsObligation['sms_sent_timestamp'] = date('Y-m-d H:i:s', $evTime);

                    if ($isMet) {
                        $openSmsObligation['attributed_agent_id'] = null;
                        $complianceLabels[$ev['id']] = ['effect' => 'CLEARED_OBLIGATION', 'note' => 'Sent Follow-up SMS'];
                    } else {
                        $openSmsObligation['attributed_agent_id'] = $openSmsObligation['originating_agent_id'];
                        $openSmsObligation['attributed_agent_name'] = $openSmsObligation['originating_agent_name'];
                    }

                    $ttFailedOutToSms[] = [
                        'mins' => $turnaround,
                        'tag' => $openSmsObligation['originating_agent_tag'],
                        'agent_id' => $openSmsObligation['originating_agent_id'] ?? 0,
                    ];

                    $allObligations[] = $openSmsObligation;
                    $openSmsObligation = null;
                }

                // 2. TRIGGER NEW OBLIGATIONS (WITH DEDUPLICATION)
                // Obligation A: Missed Incoming Call
                if ($ev['type'] === 'CALL' && ($ev['status'] === 'MISSED' || $ev['status'] === 'INCOMING_NOT_PICKED')) {
                    $complianceLabels[$ev['id']] = ['effect' => 'CREATED_OBLIGATION', 'note' => 'Missed Incoming Call'];
                    if (!$openIncomingObligation) {
                        $deadline = self::calculateDeadlineTimestamp($evTime, (int)$settings['callback_window_minutes'], $schedule, $clockMode);
                        $openIncomingObligation = [
                            'id' => 'OBL-A-' . $ev['id'],
                            'target_phone' => $phone,
                            'obligation_type' => 'MISSED_INCOMING_CALLBACK',
                            'trigger_event_id' => $ev['id'],
                            'trigger_timestamp' => date('Y-m-d H:i:s', $evTime),
                            'originating_agent_id' => $ev['agent_id'] ?? null,
                            'originating_agent_name' => $agentName,
                            'originating_agent_tag' => $agentTag,
                            'deadline_timestamp' => date('Y-m-d H:i:s', $deadline),
                            'status' => 'OPEN',
                            'threshold_minutes' => (int)$settings['callback_window_minutes'],
                            'owed_action' => 'CALLBACK',
                            'sms_sent' => false,
                        ];
                    }
                }

                // Obligation B & C: Unconnected Outgoing Call
                $isFailedOutgoing = ($ev['type'] === 'CALL' && in_array($ev['status'], ['FAILED', 'BUSY', 'NO_ANSWER', 'OUTGOING']) && !$isConnected);
                if ($isFailedOutgoing) {
                    $complianceLabels[$ev['id']] = ['effect' => 'CREATED_OBLIGATION', 'note' => 'Unconnected Outgoing Call'];

                    if (!$openOutgoingObligation) {
                        $deadlineB = self::calculateDeadlineTimestamp($evTime, (int)$settings['reconnection_window_minutes'], $schedule, $clockMode);
                        $openOutgoingObligation = [
                            'id' => 'OBL-B-' . $ev['id'],
                            'target_phone' => $phone,
                            'obligation_type' => 'OUTGOING_RECONNECTION',
                            'trigger_event_id' => $ev['id'],
                            'trigger_timestamp' => date('Y-m-d H:i:s', $evTime),
                            'originating_agent_id' => $ev['agent_id'] ?? null,
                            'originating_agent_name' => $agentName,
                            'originating_agent_tag' => $agentTag,
                            'deadline_timestamp' => date('Y-m-d H:i:s', $deadlineB),
                            'status' => 'OPEN',
                            'threshold_minutes' => (int)$settings['reconnection_window_minutes'],
                            'owed_action' => !empty($settings['sms_followup_enabled']) ? 'CALLBACK_AND_SMS' : 'CALLBACK',
                            'sms_sent' => false,
                        ];
                    }

                    if (!empty($settings['sms_followup_enabled']) && !$openSmsObligation) {
                        $deadlineC = self::calculateDeadlineTimestamp($evTime, (int)$settings['sms_deadline_minutes'], $schedule, $clockMode);
                        $openSmsObligation = [
                            'id' => 'OBL-C-' . $ev['id'],
                            'target_phone' => $phone,
                            'obligation_type' => 'SMS_FOLLOWUP',
                            'trigger_event_id' => $ev['id'],
                            'trigger_timestamp' => date('Y-m-d H:i:s', $evTime),
                            'originating_agent_id' => $ev['agent_id'] ?? null,
                            'originating_agent_name' => $agentName,
                            'originating_agent_tag' => $agentTag,
                            'deadline_timestamp' => date('Y-m-d H:i:s', $deadlineC),
                            'status' => 'OPEN',
                            'threshold_minutes' => (int)$settings['sms_deadline_minutes'],
                            'owed_action' => 'SMS',
                            'sms_sent' => false,
                        ];
                    }
                }
            }

            // 3. LEFTOVER OPEN OBLIGATIONS
            foreach ([$openIncomingObligation, $openOutgoingObligation, $openSmsObligation] as $obl) {
                if (!$obl) continue;
                $deadTime = strtotime($obl['deadline_timestamp']);
                if ($evalNow > $deadTime) {
                    $obl['status'] = 'BREACHED';
                    $obl['attributed_agent_id'] = $obl['originating_agent_id'];
                    $obl['attributed_agent_name'] = $obl['originating_agent_name'];
                    $obl['remaining_minutes'] = 0;
                    $obl['is_urgent'] = true;
                } else {
                    $obl['status'] = 'OPEN';
                    $rem = self::calculateElapsedMinutes($evalNow, $deadTime, $schedule, $clockMode);
                    $obl['remaining_minutes'] = $rem;
                    $obl['is_urgent'] = ($rem <= min(30, (int)$obl['threshold_minutes'] * 0.25));
                }
                $allObligations[] = $obl;
            }
        }

        // 4. TURNAROUND REPORT COMPUTATION
        $extractFn = function($arr, $filter = null) {
            $res = [];
            foreach ($arr as $item) {
                if ($filter === null || $filter($item)) {
                    $res[] = $item['mins'];
                }
            }
            return $res;
        };

        $buildGroup = function($filter = null) use ($extractFn, $ttMissedToFirstAttempt, $ttMissedToConnection, $ttFailedOutToNextAttempt, $ttFailedOutToConnection, $ttFailedOutToSms, $settings) {
            $missedAttempts = $extractFn($ttMissedToFirstAttempt, $filter);
            $failedOutAttempts = $extractFn($ttFailedOutToNextAttempt, $filter);
            $allCallbacks = array_merge($missedAttempts, $failedOutAttempts);

            $missedConnections = $extractFn($ttMissedToConnection, $filter);
            $failedOutConnections = $extractFn($ttFailedOutToConnection, $filter);
            $allConnections = array_merge($missedConnections, $failedOutConnections);

            return [
                'overall_callback_turnaround' => self::calculateMeanMedian($allCallbacks, (int)$settings['callback_window_minutes']),
                'overall_connection_turnaround' => self::calculateMeanMedian($allConnections, (int)$settings['callback_window_minutes']),
                'missed_to_first_attempt' => self::calculateMeanMedian($missedAttempts, (int)$settings['callback_window_minutes']),
                'missed_to_connection' => self::calculateMeanMedian($missedConnections, (int)$settings['callback_window_minutes']),
                'failed_outgoing_to_next_attempt' => self::calculateMeanMedian($failedOutAttempts, (int)$settings['reconnection_window_minutes']),
                'failed_outgoing_to_connection' => self::calculateMeanMedian($failedOutConnections, (int)$settings['reconnection_window_minutes']),
                'failed_outgoing_to_sms' => self::calculateMeanMedian($extractFn($ttFailedOutToSms, $filter), (int)$settings['sms_deadline_minutes']),
            ];
        };

        $turnaroundReport = [
            'company_wide' => $buildGroup(),
            'by_tag' => [],
            'by_agent' => [],
        ];

        // By Tag
        $tags = [];
        foreach ($agents as $a) {
            $t = $a['tag'] ?: 'Uncategorised';
            $tags[$t] = true;
        }
        foreach (array_keys($tags) as $tag) {
            $agentsInTag = array_filter($agents, fn($a) => ($a['tag'] ?: 'Uncategorised') === $tag);
            $group = $buildGroup(fn($x) => $x['tag'] === $tag);
            $group['agent_count'] = count($agentsInTag);
            $turnaroundReport['by_tag'][$tag] = $group;
        }

        // By Agent
        foreach ($agents as $agent) {
            $agId = (int)$agent['id'];
            $group = $buildGroup(fn($x) => $x['agent_id'] === $agId);
            $group['agent_name'] = $agent['name'];
            $group['tag'] = $agent['tag'] ?: 'Uncategorised';
            $turnaroundReport['by_agent'][$agId] = $group;
        }

        return [
            'allObligations' => $allObligations,
            'complianceLabels' => $complianceLabels,
            'turnaroundReport' => $turnaroundReport,
        ];
    }
}
