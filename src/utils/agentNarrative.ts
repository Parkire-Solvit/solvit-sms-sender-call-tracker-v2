import { AgentComplianceSummary, TurnaroundMetricsGroup } from '../types/compliance';

export type PerformanceBand = 'STRONG' | 'NEEDS_WORK' | 'CRITICAL' | 'NO_DATA';

export function bandFor(agent: AgentComplianceSummary | { carried_over_count?: number; open_obligations_count?: number; incoming_callback_met?: number; incoming_callback_total?: number; outgoing_reconnect_met?: number; outgoing_reconnect_total?: number; sms_followup_met?: number; sms_followup_total?: number } | number | null | undefined): PerformanceBand {
  if (typeof agent === 'number') {
    if (isNaN(agent)) return 'NO_DATA';
    if (agent >= 90) return 'STRONG';
    if (agent >= 75) return 'NEEDS_WORK';
    return 'CRITICAL';
  }
  if (!agent) return 'NO_DATA';

  const totalMet = (agent.incoming_callback_met || 0) + (agent.sms_followup_met || 0);
  const total = (agent.incoming_callback_total || 0) + (agent.sms_followup_total || 0);
  const carriedOver = agent.carried_over_count ?? Math.max(0, total - totalMet);

  if (total === 0) return 'NO_DATA';
  if (carriedOver === 0) return 'STRONG';
  if (carriedOver <= Math.ceil(total * 0.15)) return 'NEEDS_WORK';
  return 'CRITICAL';
}

function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return 'not enough data to measure';
  if (minutes < 1) return 'under a minute';
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hrs}h ${mins}m`;
  }
  return `${Math.round(minutes)}m`;
}

export function generateAgentNarrative(
  agent: AgentComplianceSummary,
  tat?: TurnaroundMetricsGroup
): string {
  const sentences: string[] = [];

  const totalMet = agent.incoming_callback_met + agent.sms_followup_met;
  const totalObligations = agent.incoming_callback_total + agent.sms_followup_total;
  const carriedOver = agent.carried_over_count ?? Math.max(0, totalObligations - totalMet);

  if (totalObligations === 0 && agent.calls_made === 0 && agent.calls_incoming === 0) {
    return `${agent.agent_name} had no call or response activity recorded in this period.`;
  }

  // 1. Overall assessment sentence
  if (totalObligations === 0) {
    sentences.push(`${agent.agent_name} had no response obligations recorded in this period.`);
  } else if (carriedOver === 0) {
    sentences.push(
      `${agent.agent_name} handled all response obligations within the period, meeting all ${totalMet} on time.`
    );
  } else if (totalMet >= carriedOver * 3) {
    sentences.push(
      `${agent.agent_name} resolved ${totalMet} of ${totalObligations} response obligations, carrying over ${carriedOver} to the next period.`
    );
  } else {
    sentences.push(
      `${agent.agent_name} resolved ${totalMet} of ${totalObligations} response obligations, with ${carriedOver} carried over to the next period.`
    );
  }

  // 2. Incoming Calls & SLA Breakdown
  const withinSla = agent.incoming_returned_within_sla_count ?? agent.incoming_callback_met;
  const outsideSla = agent.incoming_returned_outside_sla_count ?? 0;
  const notReturned = agent.incoming_not_returned_count ?? Math.max(0, agent.incoming_callback_total - agent.incoming_callback_met);

  if (agent.incoming_callback_total === 0) {
    sentences.push(`No incoming missed-call obligations were recorded for ${agent.agent_name} in this period.`);
  } else if (notReturned === 0) {
    if (outsideSla === 0) {
      sentences.push(`All ${agent.incoming_callback_total} incoming missed calls were returned within SLA.`);
    } else {
      sentences.push(
        `All ${agent.incoming_callback_total} incoming missed calls were returned (${withinSla} within SLA, ${outsideSla} outside SLA).`
      );
    }
  } else {
    sentences.push(
      `Of ${agent.incoming_callback_total} incoming missed calls, ${withinSla} were returned within SLA, ${outsideSla} were returned outside SLA, and ${notReturned} were not returned.`
    );
  }

  // 3. Outgoing Calls (Activity & Reconnection Turnaround)
  const dialled = agent.calls_made;
  const connected = agent.calls_outgoing_connected;
  const notConnected = Math.max(0, dialled - connected);
  const reconnectMean = tat?.failed_outgoing_to_connection?.mean ?? tat?.overall_connection_turnaround?.mean;

  if (dialled === 0) {
    sentences.push(`No outgoing calls were made by ${agent.agent_name} in this period.`);
  } else if (notConnected === 0) {
    sentences.push(`All ${dialled} outbound calls made by ${agent.agent_name} connected successfully.`);
  } else {
    const reconnectInfo = reconnectMean !== null && reconnectMean !== undefined
      ? ` with an average reconnection turnaround of ${formatMinutes(reconnectMean)}.`
      : '.';
    sentences.push(
      `Outbound activity: ${dialled} calls dialled, ${connected} connected, and ${notConnected} not connected${reconnectInfo}`
    );
  }

  // 4. SMS Follow-Up
  const smsEligible = agent.sms_followup_total;
  const smsSent = agent.sms_followup_met;
  const unmetSms = Math.max(0, smsEligible - smsSent);

  if (smsEligible === 0) {
    sentences.push(`No SMS follow-up obligations were recorded for ${agent.agent_name} in this period.`);
  } else if (smsSent >= smsEligible) {
    sentences.push(`All ${smsEligible} follow-up text messages were sent.`);
  } else {
    sentences.push(
      `Of ${smsEligible} unconnected outbound calls eligible for SMS follow-up, ${smsSent} text messages were dispatched, leaving ${unmetSms} carried over.`
    );
  }

  // 5. Actionable recommendation based on largest carried-over volume
  const channels = [
    {
      key: 'incoming' as const,
      carried: notReturned,
      tatKey: 'missed_to_connection' as keyof TurnaroundMetricsGroup,
      remedy: (median: string) =>
        `The largest volume carried over was in unreturned incoming calls (${notReturned} carried over). The median time to return calls is ${median}. Prioritizing missed calls the moment they come in, ahead of outbound dialling, would ensure customers are reached within SLA.`,
    },
    {
      key: 'sms' as const,
      carried: unmetSms,
      tatKey: 'failed_outgoing_to_sms' as keyof TurnaroundMetricsGroup,
      remedy: (median: string) =>
        `The largest volume carried over was in SMS follow-ups (${unmetSms} carried over). The median time to send is ${median}. Dispatching text messages immediately after an unanswered call, rather than waiting until the end of the shift, is the fastest fix here.`,
    },
  ];

  const channelsWithCarried = channels.filter(c => c.carried > 0);
  if (channelsWithCarried.length === 0) {
    sentences.push(`All response obligations were completed within the period.`);
  } else {
    channelsWithCarried.sort((a, b) => b.carried - a.carried);
    const worst = channelsWithCarried[0];
    const medianVal = tat ? tat[worst.tatKey]?.median : null;
    const medianText = formatMinutes(medianVal);
    sentences.push(worst.remedy(medianText));
  }

  // 6. Concluding count sentence
  sentences.push(
    `${agent.agent_name} currently has ${agent.open_obligations_count} open obligation${
      agent.open_obligations_count === 1 ? '' : 's'
    } and ${carriedOver} obligation${carriedOver === 1 ? '' : 's'} carried over to the next period.`
  );

  const finalNarrative = sentences.join(' ');

  // Strict negative constraint safeguard
  const sanitizedNarrative = finalNarrative
    .replace(/compliance/gi, 'adherence')
    .replace(/percent/gi, '')
    .replace(/%/g, '');

  return sanitizedNarrative;
}
