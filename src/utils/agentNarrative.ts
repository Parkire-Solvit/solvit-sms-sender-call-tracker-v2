import { AgentComplianceSummary, TurnaroundMetricsGroup } from '../types/compliance';

export type ComplianceBand = 'STRONG' | 'NEEDS_WORK' | 'CRITICAL' | 'NO_DATA';

export function bandFor(pct: number | null | undefined): ComplianceBand {
  if (pct === null || pct === undefined || isNaN(pct)) return 'NO_DATA';
  if (pct >= 90) return 'STRONG';
  if (pct >= 75) return 'NEEDS_WORK';
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
  const combinedBand = bandFor(agent.combined_compliance_pct);
  const pct = agent.combined_compliance_pct;

  if (combinedBand === 'NO_DATA') {
    return `${agent.agent_name} had no response obligations recorded in this period.`;
  }

  if (combinedBand === 'STRONG') {
    sentences.push(`${agent.agent_name} is performing well this period, meeting ${pct!.toFixed(1)}% of response obligations overall.`);
  } else if (combinedBand === 'NEEDS_WORK') {
    sentences.push(`${agent.agent_name}'s overall response compliance is ${pct!.toFixed(1)}% this period, below the 90% target but not yet critical.`);
  } else {
    sentences.push(`${agent.agent_name}'s overall response compliance is ${pct!.toFixed(1)}% this period, well below the 90% target and needs immediate attention.`);
  }

  type ObligationType = {
    key: 'incoming' | 'outgoing' | 'sms';
    label: string;
    met: number;
    total: number;
    pct: number | null;
    tatKey: keyof TurnaroundMetricsGroup;
    window: string;
  };

  const types: ObligationType[] = [
    { key: 'incoming', label: 'incoming missed-call callbacks', met: agent.incoming_callback_met, total: agent.incoming_callback_total, pct: agent.incoming_callback_compliance_pct, tatKey: 'missed_to_first_attempt', window: '30 minutes' },
    { key: 'outgoing', label: 'outgoing reconnections', met: agent.outgoing_reconnect_met, total: agent.outgoing_reconnect_total, pct: agent.outgoing_reconnect_compliance_pct, tatKey: 'failed_outgoing_to_connection', window: '24 hours' },
    { key: 'sms', label: 'SMS follow-ups', met: agent.sms_followup_met, total: agent.sms_followup_total, pct: agent.sms_followup_compliance_pct, tatKey: 'failed_outgoing_to_sms', window: '30 minutes' },
  ];

  for (const t of types) {
    if (t.total === 0) {
      sentences.push(`No ${t.label} obligations were recorded for ${agent.agent_name} in this period.`);
    } else {
      sentences.push(`Of ${t.total} ${t.label} obligations, ${t.met} were met on time (${t.pct!.toFixed(1)}%).`);
    }
  }

  const scored = types.filter(t => t.total > 0 && t.pct !== null);
  if (scored.length > 0) {
    const weakest = scored.reduce((a, b) => (a.pct! < b.pct! ? a : b));
    const weakBand = bandFor(weakest.pct);
    const median = tat ? tat[weakest.tatKey]?.median : null;
    const medianText = formatMinutes(median);

    const improvementLines: Record<'incoming' | 'outgoing' | 'sms', Record<'CRITICAL' | 'NEEDS_WORK', string>> = {
      incoming: {
        CRITICAL: `The biggest gap is incoming callbacks: only ${weakest.pct!.toFixed(1)}% were returned within the ${weakest.window} window, and the median time to a first attempt is ${medianText}. Prioritizing missed calls the moment they come in, ahead of outbound work, would have the largest single impact on this score.`,
        NEEDS_WORK: `Incoming callbacks have the most room to improve, at ${weakest.pct!.toFixed(1)}% met. The median time to a first attempt is ${medianText}; tightening this toward the ${weakest.window} target would lift compliance meaningfully.`,
      },
      outgoing: {
        CRITICAL: `Reconnection attempts are the weakest area, at ${weakest.pct!.toFixed(1)}% met within ${weakest.window}. The median time to reconnect is ${medianText}. Building a same-day second-attempt habit for unconnected calls would close most of this gap.`,
        NEEDS_WORK: `Reconnections have the most room to improve, at ${weakest.pct!.toFixed(1)}% met. The median reconnect time is ${medianText}; a faster second attempt after an unconnected call would help close this.`,
      },
      sms: {
        CRITICAL: `SMS follow-up is the weakest area, at ${weakest.pct!.toFixed(1)}% sent within ${weakest.window} of an unconnected call. The median time to send is ${medianText}. Sending the follow-up SMS immediately after an unanswered call, rather than batching them later, is the fastest fix here.`,
        NEEDS_WORK: `SMS follow-up has the most room to improve, at ${weakest.pct!.toFixed(1)}% met. The median time to send is ${medianText}; sending it right after the call, rather than later, would help.`,
      },
    };

    if (weakBand === 'CRITICAL' || weakBand === 'NEEDS_WORK') {
      sentences.push(improvementLines[weakest.key][weakBand]);
    } else {
      sentences.push(`All three response types are within target this period, keep this up.`);
    }
  }

  sentences.push(
    `${agent.agent_name} currently has ${agent.open_obligations_count} open obligation${agent.open_obligations_count === 1 ? '' : 's'} and ${agent.breaches_attributed_count} breach${agent.breaches_attributed_count === 1 ? '' : 'es'} attributed to them in the selected period.`
  );

  return sentences.join(' ');
}
