import {
  SystemSettings,
  WorkingHoursSchedule,
  Obligation,
  ObligationType,
  ObligationStatus,
  MeanMedianMetric,
  TurnaroundMetricsGroup,
  TurnaroundTimeReport,
  AgentComplianceSummary,
  TagGroupCompliance,
  ContactThreadObligationSummary,
} from './src/types/compliance';

// Nairobi timezone offset in ms (UTC + 3 hours)
export const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface RawEvent {
  id: number;
  agent_id: number | null;
  agent_name?: string;
  type: string; // 'CALL' | 'SMS'
  target_phone: string;
  status: string | null; // 'INCOMING' | 'OUTGOING' | 'CONNECTED' | 'MISSED' | 'FAILED' | 'BUSY' | 'NO_ANSWER' | 'SENT'
  duration?: number;
  reg_no?: string;
  timestamp: string | Date;
  local_timestamp?: string;
}

export interface RawAgent {
  id: number;
  name: string;
  phone_number?: string;
  tag?: string;
  installed_at?: string;
  last_active_at?: string;
}

// Convert a UTC Date to Nairobi Local Date Components
export function getNairobiDate(date: Date): {
  year: number;
  month: number;
  date: number;
  day: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  hours: number;
  minutes: number;
  seconds: number;
  totalMinutes: number;
  dayName: keyof WorkingHoursSchedule;
} {
  const nairobiTime = new Date(date.getTime() + NAIROBI_OFFSET_MS);
  const dayIndex = nairobiTime.getUTCDay();
  const dayNames: (keyof WorkingHoursSchedule)[] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];

  return {
    year: nairobiTime.getUTCFullYear(),
    month: nairobiTime.getUTCMonth(),
    date: nairobiTime.getUTCDate(),
    day: dayIndex,
    hours: nairobiTime.getUTCHours(),
    minutes: nairobiTime.getUTCMinutes(),
    seconds: nairobiTime.getUTCSeconds(),
    totalMinutes: nairobiTime.getUTCHours() * 60 + nairobiTime.getUTCMinutes(),
    dayName: dayNames[dayIndex],
  };
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = (timeStr || '00:00').split(':').map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

// Check if a specific time is within working hours
export function isWithinWorkingHours(date: Date, schedule: WorkingHoursSchedule): boolean {
  const info = getNairobiDate(date);
  const dayConfig = schedule[info.dayName];
  if (!dayConfig || !dayConfig.enabled) return false;

  const openMins = parseTimeToMinutes(dayConfig.open);
  const closeMins = parseTimeToMinutes(dayConfig.close);

  return info.totalMinutes >= openMins && info.totalMinutes < closeMins;
}

// Get the next valid opening time if currently outside working hours
export function getNextOpeningTime(date: Date, schedule: WorkingHoursSchedule): Date {
  if (isWithinWorkingHours(date, schedule)) return new Date(date.getTime());

  let curr = new Date(date.getTime());
  // Step forward day by day or hour by hour to find the next opening slot
  for (let i = 0; i < 14; i++) {
    const info = getNairobiDate(curr);
    const dayConfig = schedule[info.dayName];

    if (dayConfig && dayConfig.enabled) {
      const openMins = parseTimeToMinutes(dayConfig.open);
      const closeMins = parseTimeToMinutes(dayConfig.close);

      if (info.totalMinutes < openMins) {
        // Earlier today: advance to today's open time
        const diffMinutes = openMins - info.totalMinutes;
        return new Date(curr.getTime() + diffMinutes * 60 * 1000 - info.seconds * 1000);
      }
    }

    // Advance to midnight of next day
    const minsUntilMidnight = (24 * 60 - info.totalMinutes);
    curr = new Date(curr.getTime() + minsUntilMidnight * 60 * 1000 - info.seconds * 1000);
  }

  return date;
}

// Calculate elapsed working minutes between two dates
export function calculateElapsedMinutes(
  startDate: Date,
  endDate: Date,
  schedule: WorkingHoursSchedule,
  clockMode: 'working_hours' | 'continuous_24_7'
): number {
  if (startDate >= endDate) return 0;

  if (clockMode === 'continuous_24_7') {
    return Math.max(0, (endDate.getTime() - startDate.getTime()) / (60 * 1000));
  }

  // Working hours mode: accumulate open working minutes
  let workingMinutes = 0;
  let cursor = new Date(startDate.getTime());

  // Fast forward cursor if starting outside working hours
  if (!isWithinWorkingHours(cursor, schedule)) {
    cursor = getNextOpeningTime(cursor, schedule);
    if (cursor >= endDate) return 0;
  }

  // Iterate minute by minute or in daily blocks for performance
  while (cursor < endDate) {
    const info = getNairobiDate(cursor);
    const dayConfig = schedule[info.dayName];

    if (!dayConfig || !dayConfig.enabled) {
      cursor = getNextOpeningTime(cursor, schedule);
      continue;
    }

    const openMins = parseTimeToMinutes(dayConfig.open);
    const closeMins = parseTimeToMinutes(dayConfig.close);

    if (info.totalMinutes < openMins) {
      cursor = new Date(cursor.getTime() + (openMins - info.totalMinutes) * 60 * 1000);
      continue;
    }

    if (info.totalMinutes >= closeMins) {
      cursor = getNextOpeningTime(cursor, schedule);
      continue;
    }

    // We are inside working hours today
    const minsUntilCloseToday = closeMins - info.totalMinutes;
    const minsUntilEndDate = (endDate.getTime() - cursor.getTime()) / (60 * 1000);

    const chunk = Math.min(minsUntilCloseToday, minsUntilEndDate);
    workingMinutes += chunk;
    cursor = new Date(cursor.getTime() + chunk * 60 * 1000);
  }

  return Math.round(workingMinutes * 10) / 10;
}

// Calculate target deadline timestamp given a start date and window in minutes
export function calculateDeadlineTimestamp(
  startDate: Date,
  windowMinutes: number,
  schedule: WorkingHoursSchedule,
  clockMode: 'working_hours' | 'continuous_24_7'
): Date {
  if (clockMode === 'continuous_24_7') {
    return new Date(startDate.getTime() + windowMinutes * 60 * 1000);
  }

  // In working hours mode, advance start to next opening if outside
  let cursor = new Date(startDate.getTime());
  if (!isWithinWorkingHours(cursor, schedule)) {
    cursor = getNextOpeningTime(cursor, schedule);
  }

  let remainingWindow = windowMinutes;
  while (remainingWindow > 0) {
    const info = getNairobiDate(cursor);
    const dayConfig = schedule[info.dayName];

    if (!dayConfig || !dayConfig.enabled) {
      cursor = getNextOpeningTime(cursor, schedule);
      continue;
    }

    const openMins = parseTimeToMinutes(dayConfig.open);
    const closeMins = parseTimeToMinutes(dayConfig.close);

    if (info.totalMinutes < openMins) {
      cursor = new Date(cursor.getTime() + (openMins - info.totalMinutes) * 60 * 1000);
      continue;
    }

    if (info.totalMinutes >= closeMins) {
      cursor = getNextOpeningTime(cursor, schedule);
      continue;
    }

    const availableToday = closeMins - info.totalMinutes;
    if (remainingWindow <= availableToday) {
      cursor = new Date(cursor.getTime() + remainingWindow * 60 * 1000);
      remainingWindow = 0;
    } else {
      remainingWindow -= availableToday;
      cursor = new Date(cursor.getTime() + availableToday * 60 * 1000);
      cursor = getNextOpeningTime(cursor, schedule);
    }
  }

  return cursor;
}

// Format UTC Date to readable Nairobi string
export function toNairobiTimeString(date: Date): string {
  const d = new Date(date.getTime() + NAIROBI_OFFSET_MS);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

// Check if a call record qualifies as a connected call based on settings
export function isCallConnected(event: RawEvent, minDuration: number): boolean {
  if (event.type !== 'CALL') return false;
  if (event.status !== 'CONNECTED') return false;
  const dur = typeof event.duration === 'number' ? event.duration : 0;
  return dur >= minDuration;
}

// Helper: Calculate Mean and Median
export function calculateMeanMedian(
  values: number[],
  threshold: number
): MeanMedianMetric {
  if (!values || values.length === 0) {
    return { mean: null, median: null, count: 0, threshold, status: 'NO_DATA' };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = Math.round((sum / sorted.length) * 10) / 10;

  let median: number;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    median = Math.round(sorted[mid] * 10) / 10;
  } else {
    median = Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  }

  let status: 'OPTIMAL' | 'WARNING' | 'BREACHED' | 'NO_DATA' = 'OPTIMAL';
  if (median > threshold) {
    status = 'BREACHED';
  } else if (median > threshold * 0.75) {
    status = 'WARNING';
  }

  return {
    mean,
    median,
    count: sorted.length,
    threshold,
    status,
  };
}

/**
 * CORE COMPLIANCE ENGINE
 * Evaluates all contact threads against the 3 obligations using dynamic system settings.
 */
export function evaluateCompliance(
  events: RawEvent[],
  agents: RawAgent[],
  settings: SystemSettings,
  evalNow: Date = new Date()
) {
  const agentsMap = new Map<number, RawAgent>();
  agents.forEach((a) => agentsMap.set(a.id, a));

  // Sort events chronologically (oldest first)
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Group events by target_phone
  const threadsByPhone = new Map<string, RawEvent[]>();
  for (const ev of sortedEvents) {
    const phone = (ev.target_phone || '').trim();
    if (!phone) continue;
    if (!threadsByPhone.has(phone)) {
      threadsByPhone.set(phone, []);
    }
    threadsByPhone.get(phone)!.push(ev);
  }

  const allObligations: Obligation[] = [];
  const complianceLabels = new Map<number, { effect: 'CREATED_OBLIGATION' | 'CLEARED_OBLIGATION' | 'BREACHED_OBLIGATION'; note?: string }>();

  // Turnaround collection arrays
  const ttMissedToFirstAttempt: { mins: number; tag: string; agent_id: number }[] = [];
  const ttMissedToConnection: { mins: number; tag: string; agent_id: number }[] = [];
  const ttFailedOutToNextAttempt: { mins: number; tag: string; agent_id: number }[] = [];
  const ttFailedOutToConnection: { mins: number; tag: string; agent_id: number }[] = [];
  const ttFailedOutToSms: { mins: number; tag: string; agent_id: number }[] = [];

  // Evaluate each phone thread
  threadsByPhone.forEach((threadEvents, phone) => {
    let openIncomingObligation: Obligation | null = null;
    let openOutgoingObligation: Obligation | null = null;
    let openSmsObligation: Obligation | null = null;

    for (let i = 0; i < threadEvents.length; i++) {
      const ev = threadEvents[i];
      const evTime = new Date(ev.timestamp);
      const agent = ev.agent_id ? agentsMap.get(ev.agent_id) : null;
      const agentName = agent?.name || ev.agent_name || 'Unknown Agent';
      const agentTag = agent?.tag || 'Uncategorised';

      const isConnected = isCallConnected(ev, settings.min_connection_duration);

      // --- 1. RESOLUTION CHECKS FOR ANY OPEN OBLIGATIONS ---
      // A connected call (any agent) satisfies both Obligation A and Obligation B!
      if (isConnected) {
        if (openIncomingObligation) {
          const turnaround = calculateElapsedMinutes(
            new Date(openIncomingObligation.trigger_timestamp),
            evTime,
            settings.working_hours_schedule,
            settings.clock_mode
          );
          const deadline = new Date(openIncomingObligation.deadline_timestamp);
          const isMet = evTime <= deadline;

          openIncomingObligation.status = isMet ? 'MET' : 'BREACHED';
          openIncomingObligation.resolution_timestamp = evTime.toISOString();
          openIncomingObligation.resolution_local_timestamp = toNairobiTimeString(evTime);
          openIncomingObligation.resolving_agent_id = ev.agent_id;
          openIncomingObligation.resolving_agent_name = agentName;
          openIncomingObligation.turnaround_minutes = turnaround;

          if (isMet) {
            openIncomingObligation.attributed_agent_id = null;
            openIncomingObligation.attributed_agent_name = undefined;
            complianceLabels.set(ev.id, { effect: 'CLEARED_OBLIGATION', note: 'Connected Missed Callback' });
          } else {
            // Breached because it connected after window
            openIncomingObligation.attributed_agent_id = openIncomingObligation.originating_agent_id;
            openIncomingObligation.attributed_agent_name = openIncomingObligation.originating_agent_name;
          }

          ttMissedToConnection.push({
            mins: turnaround,
            tag: openIncomingObligation.originating_agent_tag,
            agent_id: openIncomingObligation.originating_agent_id || 0,
          });

          allObligations.push(openIncomingObligation);
          openIncomingObligation = null;
        }

        if (openOutgoingObligation) {
          const turnaround = calculateElapsedMinutes(
            new Date(openOutgoingObligation.trigger_timestamp),
            evTime,
            settings.working_hours_schedule,
            settings.clock_mode
          );
          const deadline = new Date(openOutgoingObligation.deadline_timestamp);
          const isMet = evTime <= deadline;

          openOutgoingObligation.status = isMet ? 'MET' : 'BREACHED';
          openOutgoingObligation.resolution_timestamp = evTime.toISOString();
          openOutgoingObligation.resolution_local_timestamp = toNairobiTimeString(evTime);
          openOutgoingObligation.resolving_agent_id = ev.agent_id;
          openOutgoingObligation.resolving_agent_name = agentName;
          openOutgoingObligation.turnaround_minutes = turnaround;

          if (isMet) {
            openOutgoingObligation.attributed_agent_id = null;
            openOutgoingObligation.attributed_agent_name = undefined;
            if (!complianceLabels.has(ev.id)) {
              complianceLabels.set(ev.id, { effect: 'CLEARED_OBLIGATION', note: 'Connected Reconnection' });
            }
          } else {
            openOutgoingObligation.attributed_agent_id = openOutgoingObligation.originating_agent_id;
            openOutgoingObligation.attributed_agent_name = openOutgoingObligation.originating_agent_name;
          }

          ttFailedOutToConnection.push({
            mins: turnaround,
            tag: openOutgoingObligation.originating_agent_tag,
            agent_id: openOutgoingObligation.originating_agent_id || 0,
          });

          allObligations.push(openOutgoingObligation);
          openOutgoingObligation = null;
        }
      }

      // Check callback attempts (even if not connected) for turnaround metrics
      if (ev.type === 'CALL' && ev.status === 'OUTGOING') {
        if (openIncomingObligation && !openIncomingObligation.resolution_timestamp) {
          const attemptTurnaround = calculateElapsedMinutes(
            new Date(openIncomingObligation.trigger_timestamp),
            evTime,
            settings.working_hours_schedule,
            settings.clock_mode
          );
          ttMissedToFirstAttempt.push({
            mins: attemptTurnaround,
            tag: openIncomingObligation.originating_agent_tag,
            agent_id: openIncomingObligation.originating_agent_id || 0,
          });
        }
        if (openOutgoingObligation && !openOutgoingObligation.resolution_timestamp) {
          const attemptTurnaround = calculateElapsedMinutes(
            new Date(openOutgoingObligation.trigger_timestamp),
            evTime,
            settings.working_hours_schedule,
            settings.clock_mode
          );
          ttFailedOutToNextAttempt.push({
            mins: attemptTurnaround,
            tag: openOutgoingObligation.originating_agent_tag,
            agent_id: openOutgoingObligation.originating_agent_id || 0,
          });
        }
      }

      // Check SMS Follow-up Obligation
      if (ev.type === 'SMS' && openSmsObligation) {
        const turnaround = calculateElapsedMinutes(
          new Date(openSmsObligation.trigger_timestamp),
          evTime,
          settings.working_hours_schedule,
          settings.clock_mode
        );
        const deadline = new Date(openSmsObligation.deadline_timestamp);
        const isMet = evTime <= deadline;

        openSmsObligation.status = isMet ? 'MET' : 'BREACHED';
        openSmsObligation.resolution_timestamp = evTime.toISOString();
        openSmsObligation.resolution_local_timestamp = toNairobiTimeString(evTime);
        openSmsObligation.resolving_agent_id = ev.agent_id;
        openSmsObligation.resolving_agent_name = agentName;
        openSmsObligation.turnaround_minutes = turnaround;
        openSmsObligation.sms_sent = true;
        openSmsObligation.sms_sent_timestamp = evTime.toISOString();

        if (isMet) {
          openSmsObligation.attributed_agent_id = null;
          complianceLabels.set(ev.id, { effect: 'CLEARED_OBLIGATION', note: 'Sent Follow-up SMS' });
        } else {
          openSmsObligation.attributed_agent_id = openSmsObligation.originating_agent_id;
          openSmsObligation.attributed_agent_name = openSmsObligation.originating_agent_name;
        }

        ttFailedOutToSms.push({
          mins: turnaround,
          tag: openSmsObligation.originating_agent_tag,
          agent_id: openSmsObligation.originating_agent_id || 0,
        });

        allObligations.push(openSmsObligation);
        openSmsObligation = null;
      }

      // --- 2. TRIGGER NEW OBLIGATIONS (WITH DEDUPLICATION) ---

      // Obligation A: Missed Incoming Call
      if (ev.type === 'CALL' && (ev.status === 'MISSED' || ev.status === 'INCOMING_NOT_PICKED')) {
        complianceLabels.set(ev.id, { effect: 'CREATED_OBLIGATION', note: 'Missed Incoming Call' });
        if (!openIncomingObligation) {
          const deadline = calculateDeadlineTimestamp(
            evTime,
            settings.callback_window_minutes,
            settings.working_hours_schedule,
            settings.clock_mode
          );

          openIncomingObligation = {
            id: `OBL-A-${ev.id}`,
            target_phone: phone,
            obligation_type: 'MISSED_INCOMING_CALLBACK',
            trigger_event_id: ev.id,
            trigger_timestamp: evTime.toISOString(),
            trigger_local_timestamp: toNairobiTimeString(evTime),
            originating_agent_id: ev.agent_id,
            originating_agent_name: agentName,
            originating_agent_tag: agentTag,
            deadline_timestamp: deadline.toISOString(),
            deadline_local_timestamp: toNairobiTimeString(deadline),
            status: 'OPEN',
            threshold_minutes: settings.callback_window_minutes,
            owed_action: 'CALLBACK',
            sms_sent: false,
          };
        }
      }

      // Obligation B & C: Unconnected Outgoing Call
      // (An outgoing call that is NOT immediately followed by a connection within 120 seconds or is explicitly failed)
      const isFailedOutgoing =
        ev.type === 'CALL' &&
        (ev.status === 'FAILED' ||
          ev.status === 'BUSY' ||
          ev.status === 'NO_ANSWER' ||
          (ev.status === 'OUTGOING' && !isConnected));

      if (isFailedOutgoing) {
        complianceLabels.set(ev.id, { effect: 'CREATED_OBLIGATION', note: 'Unconnected Outgoing Call' });

        // Obligation B: Outgoing Reconnection (Deduplicated)
        if (!openOutgoingObligation) {
          const deadlineB = calculateDeadlineTimestamp(
            evTime,
            settings.reconnection_window_minutes,
            settings.working_hours_schedule,
            settings.clock_mode
          );

          openOutgoingObligation = {
            id: `OBL-B-${ev.id}`,
            target_phone: phone,
            obligation_type: 'OUTGOING_RECONNECTION',
            trigger_event_id: ev.id,
            trigger_timestamp: evTime.toISOString(),
            trigger_local_timestamp: toNairobiTimeString(evTime),
            originating_agent_id: ev.agent_id,
            originating_agent_name: agentName,
            originating_agent_tag: agentTag,
            deadline_timestamp: deadlineB.toISOString(),
            deadline_local_timestamp: toNairobiTimeString(deadlineB),
            status: 'OPEN',
            threshold_minutes: settings.reconnection_window_minutes,
            owed_action: settings.sms_followup_enabled ? 'CALLBACK_AND_SMS' : 'CALLBACK',
            sms_sent: false,
          };
        }

        // Obligation C: SMS Follow-up (Applies ONLY to outgoing calls, if enabled)
        if (settings.sms_followup_enabled && !openSmsObligation) {
          const deadlineC = calculateDeadlineTimestamp(
            evTime,
            settings.sms_deadline_minutes,
            settings.working_hours_schedule,
            settings.clock_mode
          );

          openSmsObligation = {
            id: `OBL-C-${ev.id}`,
            target_phone: phone,
            obligation_type: 'SMS_FOLLOWUP',
            trigger_event_id: ev.id,
            trigger_timestamp: evTime.toISOString(),
            trigger_local_timestamp: toNairobiTimeString(evTime),
            originating_agent_id: ev.agent_id,
            originating_agent_name: agentName,
            originating_agent_tag: agentTag,
            deadline_timestamp: deadlineC.toISOString(),
            deadline_local_timestamp: toNairobiTimeString(deadlineC),
            status: 'OPEN',
            threshold_minutes: settings.sms_deadline_minutes,
            owed_action: 'SMS',
            sms_sent: false,
          };
        }
      }
    }

    // --- 3. EVALUATE LEFTOVER OPEN OBLIGATIONS AGAINST CURRENT CLOCK ---
    [openIncomingObligation, openOutgoingObligation, openSmsObligation].forEach((obl) => {
      if (!obl) return;
      const deadline = new Date(obl.deadline_timestamp);
      if (evalNow > deadline) {
        // Window expired without connection / SMS
        obl.status = 'BREACHED';
        obl.attributed_agent_id = obl.originating_agent_id;
        obl.attributed_agent_name = obl.originating_agent_name;
        obl.remaining_minutes = 0;
        obl.is_urgent = true;
      } else {
        obl.status = 'OPEN';
        const remaining = calculateElapsedMinutes(
          evalNow,
          deadline,
          settings.working_hours_schedule,
          settings.clock_mode
        );
        obl.remaining_minutes = remaining;
        obl.is_urgent = remaining <= Math.min(30, obl.threshold_minutes * 0.25);
      }
      allObligations.push(obl);
    });
  });

  // --- 4. COMPUTE TURNAROUND METRICS REPORT ---
  const extractDurations = (arr: { mins: number; tag: string; agent_id: number }[], filterFn?: (item: any) => boolean) =>
    (filterFn ? arr.filter(filterFn) : arr).map((x) => x.mins);

  const buildMetricGroup = (filterFn?: (item: any) => boolean): TurnaroundMetricsGroup => {
    const missedAttempts = extractDurations(ttMissedToFirstAttempt, filterFn);
    const failedOutAttempts = extractDurations(ttFailedOutToNextAttempt, filterFn);
    const allCallbackAttempts = [...missedAttempts, ...failedOutAttempts];

    const missedConnections = extractDurations(ttMissedToConnection, filterFn);
    const failedOutConnections = extractDurations(ttFailedOutToConnection, filterFn);
    const allConnections = [...missedConnections, ...failedOutConnections];

    return {
      overall_callback_turnaround: calculateMeanMedian(allCallbackAttempts, settings.callback_window_minutes),
      overall_connection_turnaround: calculateMeanMedian(allConnections, settings.callback_window_minutes),
      missed_to_first_attempt: calculateMeanMedian(missedAttempts, settings.callback_window_minutes),
      missed_to_connection: calculateMeanMedian(missedConnections, settings.callback_window_minutes),
      failed_outgoing_to_next_attempt: calculateMeanMedian(failedOutAttempts, settings.reconnection_window_minutes),
      failed_outgoing_to_connection: calculateMeanMedian(failedOutConnections, settings.reconnection_window_minutes),
      failed_outgoing_to_sms: calculateMeanMedian(extractDurations(ttFailedOutToSms, filterFn), settings.sms_deadline_minutes),
    };
  };

  const turnaroundReport: TurnaroundTimeReport = {
    company_wide: buildMetricGroup(),
    by_tag: {},
    by_agent: {},
  };

  // Group by Tag
  const tags = new Set<string>();
  agents.forEach((a) => tags.add(a.tag || 'Uncategorised'));
  tags.forEach((tag) => {
    const agentsInTag = agents.filter((a) => (a.tag || 'Uncategorised') === tag);
    turnaroundReport.by_tag[tag] = {
      ...buildMetricGroup((x) => x.tag === tag),
      agent_count: agentsInTag.length,
    };
  });

  // Group by Agent
  agents.forEach((agent) => {
    turnaroundReport.by_agent[agent.id] = {
      ...buildMetricGroup((x) => x.agent_id === agent.id),
      agent_name: agent.name,
      tag: agent.tag || 'Uncategorised',
    };
  });

  // --- 5. COMPUTE PER-AGENT AND PER-TAG COMPLIANCE SUMMARIES ---
  const agentSummaries: Record<number, AgentComplianceSummary> = {};
  agents.forEach((agent) => {
    agentSummaries[agent.id] = {
      agent_id: agent.id,
      agent_name: agent.name,
      tag: agent.tag || 'Uncategorised',
      phone_number: agent.phone_number,
      installed_at: agent.installed_at,
      last_active_at: agent.last_active_at,

      incoming_callback_met: 0,
      incoming_callback_total: 0,
      incoming_callback_compliance_pct: null,

      outgoing_reconnect_met: 0,
      outgoing_reconnect_total: 0,
      outgoing_reconnect_compliance_pct: null,

      sms_followup_met: 0,
      sms_followup_total: 0,
      sms_followup_compliance_pct: null,

      combined_compliance_pct: null,
      open_obligations_count: 0,
      breaches_attributed_count: 0,

      calls_made: 0,
      calls_incoming: 0,
      calls_connected: 0,
      calls_outgoing_connected: 0,
      calls_incoming_connected: 0,
      calls_not_picked: 0,
      calls_missed: 0,
      sms_count: 0,
    };
  });

  // Count obligations for each agent
  allObligations.forEach((obl) => {
    const origId = obl.originating_agent_id;
    if (origId && agentSummaries[origId]) {
      const summary = agentSummaries[origId];

      if (obl.status === 'OPEN') {
        summary.open_obligations_count += 1;
      } else if (obl.status === 'BREACHED') {
        summary.breaches_attributed_count += 1;
      }

      if (obl.obligation_type === 'MISSED_INCOMING_CALLBACK') {
        if (obl.status !== 'OPEN') {
          summary.incoming_callback_total += 1;
          if (obl.status === 'MET') summary.incoming_callback_met += 1;
        }
      } else if (obl.obligation_type === 'OUTGOING_RECONNECTION') {
        if (obl.status !== 'OPEN') {
          summary.outgoing_reconnect_total += 1;
          if (obl.status === 'MET') summary.outgoing_reconnect_met += 1;
        }
      } else if (obl.obligation_type === 'SMS_FOLLOWUP') {
        if (obl.status !== 'OPEN') {
          summary.sms_followup_total += 1;
          if (obl.status === 'MET') summary.sms_followup_met += 1;
        }
      }
    }
  });

  // Calculate percentages
  Object.values(agentSummaries).forEach((summary) => {
    if (summary.incoming_callback_total > 0) {
      summary.incoming_callback_compliance_pct = Math.round(
        (summary.incoming_callback_met / summary.incoming_callback_total) * 100
      );
    }
    if (summary.outgoing_reconnect_total > 0) {
      summary.outgoing_reconnect_compliance_pct = Math.round(
        (summary.outgoing_reconnect_met / summary.outgoing_reconnect_total) * 100
      );
    }
    if (summary.sms_followup_total > 0) {
      summary.sms_followup_compliance_pct = Math.round(
        (summary.sms_followup_met / summary.sms_followup_total) * 100
      );
    }

    const totalMet = summary.incoming_callback_met + summary.outgoing_reconnect_met + summary.sms_followup_met;
    const totalAll = summary.incoming_callback_total + summary.outgoing_reconnect_total + summary.sms_followup_total;
    if (totalAll > 0) {
      summary.combined_compliance_pct = Math.round((totalMet / totalAll) * 100);
    }
  });

  // Tag group summaries
  const tagSummaries: Record<string, TagGroupCompliance> = {};
  tags.forEach((tag) => {
    const agentsInTag = Object.values(agentSummaries).filter((a) => a.tag === tag);
    let totalMet = 0;
    let totalEval = 0;
    let openCount = 0;
    let breachesCount = 0;

    agentsInTag.forEach((a) => {
      totalMet += a.incoming_callback_met + a.outgoing_reconnect_met + a.sms_followup_met;
      totalEval += a.incoming_callback_total + a.outgoing_reconnect_total + a.sms_followup_total;
      openCount += a.open_obligations_count;
      breachesCount += a.breaches_attributed_count;
    });

    tagSummaries[tag] = {
      tag,
      agent_count: agentsInTag.length,
      compliance_pct: totalEval > 0 ? Math.round((totalMet / totalEval) * 100) : null,
      open_obligations_count: openCount,
      breaches_count: breachesCount,
    };
  });

  // Overall Company Headline Totals
  let totalIncomingMet = 0;
  let totalIncomingFinal = 0;
  let totalOutgoingMet = 0;
  let totalOutgoingFinal = 0;
  let totalSmsMet = 0;
  let totalSmsFinal = 0;
  let totalOpenObligations = 0;
  let totalOpenIncoming = 0;
  let totalOpenOutgoing = 0;
  let totalOpenSms = 0;

  allObligations.forEach((obl) => {
    if (obl.status === 'OPEN') {
      totalOpenObligations += 1;
      if (obl.obligation_type === 'MISSED_INCOMING_CALLBACK') totalOpenIncoming += 1;
      if (obl.obligation_type === 'OUTGOING_RECONNECTION') totalOpenOutgoing += 1;
      if (obl.obligation_type === 'SMS_FOLLOWUP') totalOpenSms += 1;
    } else {
      if (obl.obligation_type === 'MISSED_INCOMING_CALLBACK') {
        totalIncomingFinal += 1;
        if (obl.status === 'MET') totalIncomingMet += 1;
      } else if (obl.obligation_type === 'OUTGOING_RECONNECTION') {
        totalOutgoingFinal += 1;
        if (obl.status === 'MET') totalOutgoingMet += 1;
      } else if (obl.obligation_type === 'SMS_FOLLOWUP') {
        totalSmsFinal += 1;
        if (obl.status === 'MET') totalSmsMet += 1;
      }
    }
  });

  const headlineStats = {
    incoming_callback_compliance_pct: totalIncomingFinal > 0 ? Math.round((totalIncomingMet / totalIncomingFinal) * 100) : null,
    incoming_callback_met: totalIncomingMet,
    incoming_callback_total: totalIncomingFinal,
    open_incoming_count: totalOpenIncoming,

    outgoing_reconnect_compliance_pct: totalOutgoingFinal > 0 ? Math.round((totalOutgoingMet / totalOutgoingFinal) * 100) : null,
    outgoing_reconnect_met: totalOutgoingMet,
    outgoing_reconnect_total: totalOutgoingFinal,
    open_outgoing_count: totalOpenOutgoing,

    sms_followup_compliance_pct: totalSmsFinal > 0 ? Math.round((totalSmsMet / totalSmsFinal) * 100) : null,
    sms_followup_met: totalSmsMet,
    sms_followup_total: totalSmsFinal,
    open_sms_count: totalOpenSms,

    open_obligations_count: totalOpenObligations,
  };

  // Actionable Callback List (All OPEN and BREACHED obligations sorted by urgency)
  const actionableCallbackList = allObligations
    .filter((obl) => obl.status === 'OPEN' || obl.status === 'BREACHED')
    .sort((a, b) => {
      // Prioritize BREACHED or lowest remaining minutes first
      if (a.status === 'BREACHED' && b.status !== 'BREACHED') return -1;
      if (a.status !== 'BREACHED' && b.status === 'BREACHED') return 1;
      return (a.remaining_minutes ?? 999999) - (b.remaining_minutes ?? 999999);
    });

  return {
    allObligations,
    actionableCallbackList,
    headlineStats,
    agentSummaries,
    tagSummaries,
    turnaroundReport,
    complianceLabels,
  };
}
