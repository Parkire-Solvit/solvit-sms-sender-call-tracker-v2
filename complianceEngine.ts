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
  HeadlineComplianceStats,
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

// Calculate deadline as end of current or next working day
export function calculateEndOfWorkingDayDeadline(
  triggerDate: Date,
  schedule: WorkingHoursSchedule
): Date {
  const cursor = isWithinWorkingHours(triggerDate, schedule)
    ? new Date(triggerDate.getTime())
    : getNextOpeningTime(triggerDate, schedule);

  const info = getNairobiDate(cursor);
  const dayConfig = schedule[info.dayName];
  if (dayConfig && dayConfig.enabled) {
    const closeMins = parseTimeToMinutes(dayConfig.close);
    const diffMinutes = closeMins - info.totalMinutes;
    return new Date(cursor.getTime() + diffMinutes * 60 * 1000 - info.seconds * 1000);
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

  let status: 'OPTIMAL' | 'WARNING' | 'CARRIED_OVER' | 'NO_DATA' = 'OPTIMAL';
  if (median > threshold) {
    status = 'CARRIED_OVER';
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

// Calculate average tries per unconnected number across all outgoing call events
export function calculateAverageTriesPerUnconnectedNumber(
  events: RawEvent[],
  minConnectionDuration: number = 0
): number {
  const attemptsByPhone = new Map<string, { total: number; everConnected: boolean }>();
  for (const ev of events) {
    if (ev.type !== 'CALL' || ev.status === 'INCOMING' || ev.status === 'MISSED') continue;
    const entry = attemptsByPhone.get(ev.target_phone) || { total: 0, everConnected: false };
    entry.total += 1;
    if (isCallConnected(ev, minConnectionDuration)) entry.everConnected = true;
    attemptsByPhone.set(ev.target_phone, entry);
  }
  const neverConnected = [...attemptsByPhone.values()].filter((e) => !e.everConnected);
  if (neverConnected.length === 0) return 0;
  const totalAttempts = neverConnected.reduce((sum, e) => sum + e.total, 0);
  return Math.round((totalAttempts / neverConnected.length) * 10) / 10;
}

/**
 * CORE COMPLIANCE ENGINE
 * Evaluates all contact threads against obligations using dynamic system settings.
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
  const complianceLabels = new Map<number, { effect: 'CREATED_OBLIGATION' | 'CLEARED_OBLIGATION' | 'CARRIED_OVER_OBLIGATION'; note?: string }>();

  // Turnaround collection arrays
  const ttMissedToFirstAttempt: { mins: number; tag: string; agent_id: number }[] = [];
  const ttMissedToConnection: { mins: number; tag: string; agent_id: number }[] = [];
  const ttFailedOutToNextAttempt: { mins: number; tag: string; agent_id: number }[] = [];
  const ttFailedOutToConnection: { mins: number; tag: string; agent_id: number }[] = [];
  const ttFailedOutToSms: { mins: number; tag: string; agent_id: number }[] = [];

  // Evaluate each phone thread
  threadsByPhone.forEach((threadEvents, phone) => {
    let openIncomingObligation: Obligation | null = null;
    let firstFailedOutgoingAttempt: { trigger_timestamp: string; agent_id: number | null; tag: string } | null = null;
    let openSmsObligations: Obligation[] = [];

    for (let i = 0; i < threadEvents.length; i++) {
      const ev = threadEvents[i];
      const evTime = new Date(ev.timestamp);
      const agent = ev.agent_id ? agentsMap.get(ev.agent_id) : null;
      const agentName = agent?.name || ev.agent_name || 'Unknown Agent';
      const agentTag = agent?.tag || 'Uncategorised';

      const isConnected = isCallConnected(ev, settings.min_connection_duration);

      // --- 1. RESOLUTION CHECKS FOR ANY OPEN OBLIGATIONS ---
      // A connected call (any agent) satisfies Obligation A and records outgoing reconnection TAT!
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

          openIncomingObligation.status = isMet ? 'MET' : 'CARRIED_OVER';
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
            // Carried over because it connected after deadline
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

        if (firstFailedOutgoingAttempt) {
          const turnaround = calculateElapsedMinutes(
            new Date(firstFailedOutgoingAttempt.trigger_timestamp),
            evTime,
            settings.working_hours_schedule,
            settings.clock_mode
          );
          ttFailedOutToConnection.push({
            mins: turnaround,
            tag: firstFailedOutgoingAttempt.tag,
            agent_id: firstFailedOutgoingAttempt.agent_id || 0,
          });
          firstFailedOutgoingAttempt = null;
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
        if (firstFailedOutgoingAttempt) {
          const attemptTurnaround = calculateElapsedMinutes(
            new Date(firstFailedOutgoingAttempt.trigger_timestamp),
            evTime,
            settings.working_hours_schedule,
            settings.clock_mode
          );
          ttFailedOutToNextAttempt.push({
            mins: attemptTurnaround,
            tag: firstFailedOutgoingAttempt.tag,
            agent_id: firstFailedOutgoingAttempt.agent_id || 0,
          });
        }
      }

      // Check SMS Follow-up Obligation
      if (ev.type === 'SMS' && openSmsObligations.length > 0) {
        for (const smsObl of openSmsObligations) {
          const turnaround = calculateElapsedMinutes(
            new Date(smsObl.trigger_timestamp),
            evTime,
            settings.working_hours_schedule,
            settings.clock_mode
          );
          const deadline = new Date(smsObl.deadline_timestamp);
          const isMet = evTime <= deadline;

          smsObl.status = isMet ? 'MET' : 'CARRIED_OVER';
          smsObl.resolution_timestamp = evTime.toISOString();
          smsObl.resolution_local_timestamp = toNairobiTimeString(evTime);
          smsObl.resolving_agent_id = ev.agent_id;
          smsObl.resolving_agent_name = agentName;
          smsObl.turnaround_minutes = turnaround;
          smsObl.sms_sent = true;
          smsObl.sms_sent_timestamp = evTime.toISOString();

          if (isMet) {
            smsObl.attributed_agent_id = null;
            complianceLabels.set(ev.id, { effect: 'CLEARED_OBLIGATION', note: 'Sent Follow-up SMS' });
          } else {
            smsObl.attributed_agent_id = smsObl.originating_agent_id;
            smsObl.attributed_agent_name = smsObl.originating_agent_name;
          }

          ttFailedOutToSms.push({
            mins: turnaround,
            tag: smsObl.originating_agent_tag,
            agent_id: smsObl.originating_agent_id || 0,
          });

          allObligations.push(smsObl);
        }
        openSmsObligations = [];
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

      // Unconnected Outgoing Call
      // (An outgoing call that is NOT immediately followed by a connection within 120 seconds or is explicitly failed)
      const isFailedOutgoing =
        ev.type === 'CALL' &&
        (ev.status === 'FAILED' ||
          ev.status === 'BUSY' ||
          ev.status === 'NO_ANSWER' ||
          (ev.status === 'OUTGOING' && !isConnected));

      if (isFailedOutgoing) {
        if (!firstFailedOutgoingAttempt) {
          firstFailedOutgoingAttempt = {
            trigger_timestamp: evTime.toISOString(),
            agent_id: ev.agent_id,
            tag: agentTag,
          };
        }

        // Obligation C: SMS Follow-up, one opened per unconnected outgoing call,
        // no matter how many are already pending for this number.
        const deadlineC = calculateEndOfWorkingDayDeadline(
          evTime,
          settings.working_hours_schedule
        );

        openSmsObligations.push({
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
        });
      }
    }

    // --- 3. EVALUATE LEFTOVER OPEN OBLIGATIONS AGAINST CURRENT CLOCK ---
    [openIncomingObligation, ...openSmsObligations].forEach((obl) => {
      if (!obl) return;
      const deadline = new Date(obl.deadline_timestamp);
      if (evalNow > deadline) {
        // Window expired without connection / SMS
        obl.status = 'CARRIED_OVER';
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
      carried_over_incoming_count: 0,
      incoming_returned_within_sla_count: 0,
      incoming_returned_outside_sla_count: 0,
      incoming_not_returned_count: 0,
      incoming_returned_total_count: 0,

      sms_followup_met: 0,
      sms_followup_total: 0,
      carried_over_sms_count: 0,

      open_obligations_count: 0,
      open_incoming_count: 0,
      open_sms_count: 0,

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
        if (obl.obligation_type === 'MISSED_INCOMING_CALLBACK') summary.open_incoming_count = (summary.open_incoming_count || 0) + 1;
        if (obl.obligation_type === 'SMS_FOLLOWUP') summary.open_sms_count = (summary.open_sms_count || 0) + 1;
      }

      if (obl.obligation_type === 'MISSED_INCOMING_CALLBACK') {
        if (obl.status !== 'OPEN') {
          summary.incoming_callback_total += 1;
          if (obl.status === 'MET') {
            summary.incoming_callback_met += 1;
            summary.incoming_returned_within_sla_count += 1;
          } else if (obl.status === 'CARRIED_OVER') {
            summary.carried_over_incoming_count = (summary.carried_over_incoming_count || 0) + 1;
            if (obl.resolution_timestamp) {
              summary.incoming_returned_outside_sla_count += 1;
            } else {
              summary.incoming_not_returned_count += 1;
            }
          }
          summary.incoming_returned_total_count =
            summary.incoming_returned_within_sla_count + summary.incoming_returned_outside_sla_count;
        }
      } else if (obl.obligation_type === 'SMS_FOLLOWUP') {
        if (obl.status !== 'OPEN') {
          summary.sms_followup_total += 1;
          if (obl.status === 'MET') summary.sms_followup_met += 1;
          if (obl.status === 'CARRIED_OVER') summary.carried_over_sms_count = (summary.carried_over_sms_count || 0) + 1;
        }
      }
    }
  });

  // Calculate total carried over count per agent
  Object.values(agentSummaries).forEach((summary) => {
    summary.carried_over_count = (summary.carried_over_incoming_count || 0) + (summary.carried_over_sms_count || 0);
  });

  // Tag group summaries
  const tagSummaries: Record<string, TagGroupCompliance> = {};
  tags.forEach((tag) => {
    const agentsInTag = Object.values(agentSummaries).filter((a) => a.tag === tag);
    let openCount = 0;
    let carriedOverCount = 0;

    agentsInTag.forEach((a) => {
      openCount += a.open_obligations_count;
      carriedOverCount += a.carried_over_count || 0;
    });

    tagSummaries[tag] = {
      tag,
      agent_count: agentsInTag.length,
      open_obligations_count: openCount,
      carried_over_count: carriedOverCount,
    };
  });

  // Overall Company Headline Totals
  let totalIncomingMet = 0;
  let totalIncomingFinal = 0;
  let totalIncomingReturnedWithinSla = 0;
  let totalIncomingReturnedOutsideSla = 0;
  let totalIncomingNotReturned = 0;

  let totalSmsMet = 0;
  let totalSmsFinal = 0;
  let totalOpenObligations = 0;
  let totalOpenIncoming = 0;
  let totalOpenSms = 0;
  let totalCarriedOverIncoming = 0;
  let totalCarriedOverSms = 0;

  allObligations.forEach((obl) => {
    if (obl.status === 'OPEN') {
      totalOpenObligations += 1;
      if (obl.obligation_type === 'MISSED_INCOMING_CALLBACK') totalOpenIncoming += 1;
      if (obl.obligation_type === 'SMS_FOLLOWUP') totalOpenSms += 1;
    } else {
      if (obl.obligation_type === 'MISSED_INCOMING_CALLBACK') {
        totalIncomingFinal += 1;
        if (obl.status === 'MET') {
          totalIncomingMet += 1;
          totalIncomingReturnedWithinSla += 1;
        } else if (obl.status === 'CARRIED_OVER') {
          totalCarriedOverIncoming += 1;
          if (obl.resolution_timestamp) {
            totalIncomingReturnedOutsideSla += 1;
          } else {
            totalIncomingNotReturned += 1;
          }
        }
      } else if (obl.obligation_type === 'SMS_FOLLOWUP') {
        totalSmsFinal += 1;
        if (obl.status === 'MET') totalSmsMet += 1;
        if (obl.status === 'CARRIED_OVER') totalCarriedOverSms += 1;
      }
    }
  });

  const avgTriesPerUnconnected = calculateAverageTriesPerUnconnectedNumber(
    events,
    settings.min_connection_duration
  );

  const headlineStats: HeadlineComplianceStats = {
    incoming_callback_met: totalIncomingMet,
    incoming_callback_total: totalIncomingFinal,
    open_incoming_count: totalOpenIncoming,
    carried_over_incoming_count: totalCarriedOverIncoming,

    incoming_returned_within_sla_count: totalIncomingReturnedWithinSla,
    incoming_returned_outside_sla_count: totalIncomingReturnedOutsideSla,
    incoming_not_returned_count: totalIncomingNotReturned,
    incoming_returned_total_count: totalIncomingReturnedWithinSla + totalIncomingReturnedOutsideSla,

    sms_followup_met: totalSmsMet,
    sms_followup_total: totalSmsFinal,
    open_sms_count: totalOpenSms,
    carried_over_sms_count: totalCarriedOverSms,

    open_obligations_count: totalOpenObligations,
    avg_tries_per_unconnected_number: avgTriesPerUnconnected,
  };

  // Actionable Callback List (All OPEN and CARRIED_OVER obligations sorted by urgency)
  const actionableCallbackList = allObligations
    .filter((obl) => obl.status === 'OPEN' || obl.status === 'CARRIED_OVER')
    .sort((a, b) => {
      // Prioritize CARRIED_OVER or lowest remaining minutes first
      if (a.status === 'CARRIED_OVER' && b.status !== 'CARRIED_OVER') return -1;
      if (a.status !== 'CARRIED_OVER' && b.status === 'CARRIED_OVER') return 1;
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
