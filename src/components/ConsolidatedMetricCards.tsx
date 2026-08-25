import React from 'react';
import { 
  PhoneIncoming, 
  PhoneCall, 
  MessageSquare, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight,
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';
import { 
  HeadlineComplianceStats, 
  TurnaroundMetricsGroup, 
  SystemSettings 
} from '../types/compliance';

interface ConsolidatedMetricCardsProps {
  headlineStats?: HeadlineComplianceStats;
  summary: {
    total_calls_made?: number;
    total_calls_incoming?: number;
    total_calls_connected?: number;
    total_calls_outgoing_connected?: number;
    total_calls_incoming_connected?: number;
    total_calls_not_picked?: number;
    total_calls_missed?: number;
    total_sms?: number;
  };
  turnaroundGroup?: TurnaroundMetricsGroup;
  settings?: SystemSettings;
  onDrillDown: (type: 'MISSED_INCOMING_CALLBACK' | 'OUTGOING_RECONNECTION' | 'SMS_FOLLOWUP') => void;
}

export const ConsolidatedMetricCards: React.FC<ConsolidatedMetricCardsProps> = ({
  headlineStats,
  summary,
  turnaroundGroup,
  settings,
  onDrillDown,
}) => {
  const formatMinutes = (minutes: number | null | undefined) => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return 'N/A';
    if (minutes < 1) return '< 1m';
    if (minutes >= 60) {
      const hrs = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return `${hrs}h ${mins}m`;
    }
    return `${Math.round(minutes)}m`;
  };

  const getComplianceTheme = (pct: number | null | undefined, hasObligations: boolean) => {
    if (!hasObligations || pct === null || pct === undefined) {
      return {
        cardBorder: 'border-slate-200 hover:border-slate-300',
        cardBg: 'bg-white',
        bannerBg: 'bg-slate-50',
        primaryText: 'text-slate-600',
        badgeBg: 'bg-slate-100 text-slate-700 border-slate-200',
        barFill: 'bg-slate-300',
        accentIcon: 'text-slate-400',
        ringColor: 'focus:ring-slate-400',
      };
    }
    if (pct >= 90) {
      return {
        cardBorder: 'border-emerald-200/90 hover:border-emerald-400',
        cardBg: 'bg-gradient-to-b from-emerald-50/30 via-white to-white',
        bannerBg: 'bg-emerald-50/60',
        primaryText: 'text-emerald-700',
        badgeBg: 'bg-emerald-100/90 text-emerald-800 border-emerald-200',
        barFill: 'bg-emerald-500',
        accentIcon: 'text-emerald-600',
        ringColor: 'focus:ring-emerald-400',
      };
    }
    if (pct >= 75) {
      return {
        cardBorder: 'border-amber-200/90 hover:border-amber-400',
        cardBg: 'bg-gradient-to-b from-amber-50/30 via-white to-white',
        bannerBg: 'bg-amber-50/60',
        primaryText: 'text-amber-700',
        badgeBg: 'bg-amber-100/90 text-amber-800 border-amber-200',
        barFill: 'bg-amber-500',
        accentIcon: 'text-amber-600',
        ringColor: 'focus:ring-amber-400',
      };
    }
    return {
      cardBorder: 'border-rose-200/90 hover:border-rose-400',
      cardBg: 'bg-gradient-to-b from-rose-50/30 via-white to-white',
      bannerBg: 'bg-rose-50/60',
      primaryText: 'text-rose-700',
      badgeBg: 'bg-rose-100/90 text-rose-800 border-rose-200',
      barFill: 'bg-rose-500',
      accentIcon: 'text-rose-600',
      ringColor: 'focus:ring-rose-400',
    };
  };

  const getTatBadgeColor = (median: number | null | undefined, threshold: number) => {
    if (median === null || median === undefined || isNaN(median)) {
      return 'bg-slate-100 text-slate-600 border-slate-200';
    }
    if (median <= threshold * 0.5) {
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    }
    if (median <= threshold) {
      return 'bg-amber-100 text-amber-800 border-amber-200';
    }
    return 'bg-rose-100 text-rose-800 border-rose-200 font-bold';
  };

  // --- 1. CARD 1: INCOMING DATA ---
  const incomingTotal = headlineStats?.incoming_callback_total || 0;
  const incomingMet = headlineStats?.incoming_callback_met || 0;
  const incomingOpen = headlineStats?.open_incoming_count || 0;
  const incomingPct = headlineStats?.incoming_callback_compliance_pct;
  const hasIncomingObligations = incomingTotal > 0 || incomingOpen > 0;
  const incomingTheme = getComplianceTheme(incomingPct, hasIncomingObligations);
  const incomingWindow = settings?.callback_window_minutes ?? 30;
  const incomingTAT = turnaroundGroup?.overall_callback_turnaround || turnaroundGroup?.missed_to_connection;

  // --- 2. CARD 2: OUTGOING DATA ---
  const outgoingTotal = headlineStats?.outgoing_reconnect_total || 0;
  const outgoingMet = headlineStats?.outgoing_reconnect_met || 0;
  const outgoingOpen = headlineStats?.open_outgoing_count || 0;
  const outgoingPct = headlineStats?.outgoing_reconnect_compliance_pct;
  const hasOutgoingObligations = outgoingTotal > 0 || outgoingOpen > 0;
  const outgoingTheme = getComplianceTheme(outgoingPct, hasOutgoingObligations);
  const reconnectionWindow = settings?.reconnection_window_minutes ?? 1440;
  const reconnectionWindowLabel = reconnectionWindow >= 60 
    ? `${Math.round(reconnectionWindow / 60)}h` 
    : `${reconnectionWindow}m`;
  const outgoingTAT = turnaroundGroup?.failed_outgoing_to_connection || turnaroundGroup?.overall_connection_turnaround;

  // --- 3. CARD 3: SMS FOLLOW-UP DATA ---
  const smsTotal = headlineStats?.sms_followup_total || 0;
  const smsMet = headlineStats?.sms_followup_met || 0;
  const smsOpen = headlineStats?.open_sms_count || 0;
  const smsPct = headlineStats?.sms_followup_compliance_pct;
  const hasSmsObligations = smsTotal > 0 || smsOpen > 0;
  const smsTheme = getComplianceTheme(smsPct, hasSmsObligations);
  const smsWindow = settings?.sms_deadline_minutes ?? 30;
  const smsTAT = turnaroundGroup?.failed_outgoing_to_sms;
  const smsCreated = smsTotal + smsOpen;
  const smsSent = summary?.total_sms || smsMet;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* ========================================================= */}
      {/* CARD 1: INCOMING */}
      {/* ========================================================= */}
      <div
        id="card-consolidated-incoming"
        onClick={() => onDrillDown('MISSED_INCOMING_CALLBACK')}
        className={`group relative rounded-2xl border ${incomingTheme.cardBorder} ${incomingTheme.cardBg} p-5 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between`}
        role="button"
        tabIndex={0}
        aria-label="Filter missed incoming callback obligations"
      >
        <div>
          {/* Card Header */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-700 font-bold">
                <PhoneIncoming className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 leading-tight">
                  Incoming Calls
                </h3>
                <span className="text-[11px] text-slate-500">Callback Compliance</span>
              </div>
            </div>

            {/* Open Obligations Badge */}
            <span 
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                incomingOpen > 0 
                  ? 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse' 
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={`${incomingOpen} open incoming callback obligations currently pending`}
            >
              {incomingOpen > 0 ? (
                <AlertCircle className="w-3 h-3 text-amber-600" />
              ) : (
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              )}
              {incomingOpen} Open
            </span>
          </div>

          {/* LAYER 1 (DOMINANT): Compliance Verdict */}
          <div className="my-3.5">
            {hasIncomingObligations && incomingPct !== null && incomingPct !== undefined ? (
              <div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-4xl font-extrabold font-mono tracking-tight ${incomingTheme.primaryText}`}>
                    {incomingPct}%
                  </span>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                    Compliance
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  {incomingMet} of {incomingTotal} missed calls returned in SLA
                </p>
              </div>
            ) : (
              <div>
                <div className="text-lg sm:text-xl font-bold text-slate-600 tracking-tight">
                  No obligations in period
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  0 missed calls requiring callback
                </p>
              </div>
            )}
          </div>
        </div>

        {/* LAYER 2 (SUPPORTING): Activity Volume Breakdown */}
        <div className="mt-2 pt-3 border-t border-slate-100/90 space-y-3">
          <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-100">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Activity Volume
            </div>
            <div className="grid grid-cols-3 gap-1 text-center divide-x divide-slate-200/80">
              <div>
                <div className="text-xs font-bold text-slate-800 font-mono">
                  {summary.total_calls_incoming || 0}
                </div>
                <div className="text-[10px] text-slate-500">Received</div>
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-600 font-mono">
                  {summary.total_calls_incoming_connected || 0}
                </div>
                <div className="text-[10px] text-slate-500">Answered</div>
              </div>
              <div>
                <div className="text-xs font-bold text-rose-600 font-mono">
                  {summary.total_calls_missed || 0}
                </div>
                <div className="text-[10px] text-slate-500">Missed</div>
              </div>
            </div>
          </div>

          {/* Secondary Metric: Turnaround Speed & Window */}
          <div className="flex items-center justify-between text-xs text-slate-600 bg-white p-2 rounded-lg border border-slate-100">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-semibold text-slate-700">Callback TAT:</span>
              <span className="font-mono font-bold text-slate-900">
                {formatMinutes(incomingTAT?.mean)}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                (Med: {formatMinutes(incomingTAT?.median)})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span 
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getTatBadgeColor(incomingTAT?.median, incomingWindow)}`}
                title={`Target callback window configured in Master Settings: ${incomingWindow} minutes`}
              >
                {incomingWindow}m SLA
              </span>
            </div>
          </div>

          {/* Drill-down prompt */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 group-hover:text-indigo-600 transition-colors pt-0.5 font-medium">
            <span>Click for agent breakdown &amp; raw data</span>
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* CARD 2: OUTGOING */}
      {/* ========================================================= */}
      <div
        id="card-consolidated-outgoing"
        onClick={() => onDrillDown('OUTGOING_RECONNECTION')}
        className={`group relative rounded-2xl border ${outgoingTheme.cardBorder} ${outgoingTheme.cardBg} p-5 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between`}
        role="button"
        tabIndex={0}
        aria-label="Filter outgoing reconnection obligations"
      >
        <div>
          {/* Card Header */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-700 font-bold">
                <PhoneCall className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 leading-tight">
                  Outgoing Calls
                </h3>
                <span className="text-[11px] text-slate-500">Reconnection Compliance</span>
              </div>
            </div>

            {/* Open Obligations Badge */}
            <span 
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                outgoingOpen > 0 
                  ? 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse' 
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={`${outgoingOpen} open reconnection obligations currently pending`}
            >
              {outgoingOpen > 0 ? (
                <AlertCircle className="w-3 h-3 text-amber-600" />
              ) : (
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              )}
              {outgoingOpen} Open
            </span>
          </div>

          {/* LAYER 1 (DOMINANT): Compliance Verdict */}
          <div className="my-3.5">
            {hasOutgoingObligations && outgoingPct !== null && outgoingPct !== undefined ? (
              <div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-4xl font-extrabold font-mono tracking-tight ${outgoingTheme.primaryText}`}>
                    {outgoingPct}%
                  </span>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                    Compliance
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  {outgoingMet} of {outgoingTotal} unconnected dials reconnected in SLA
                </p>
              </div>
            ) : (
              <div>
                <div className="text-lg sm:text-xl font-bold text-slate-600 tracking-tight">
                  No obligations in period
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  0 unpicked calls requiring reconnection
                </p>
              </div>
            )}
          </div>
        </div>

        {/* LAYER 2 (SUPPORTING): Activity Volume Breakdown */}
        <div className="mt-2 pt-3 border-t border-slate-100/90 space-y-3">
          <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-100">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Activity Volume
            </div>
            <div className="grid grid-cols-3 gap-1 text-center divide-x divide-slate-200/80">
              <div>
                <div className="text-xs font-bold text-slate-800 font-mono">
                  {summary.total_calls_made || 0}
                </div>
                <div className="text-[10px] text-slate-500">Dialled</div>
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-600 font-mono">
                  {summary.total_calls_outgoing_connected || 0}
                </div>
                <div className="text-[10px] text-slate-500">Connected</div>
              </div>
              <div>
                <div className="text-xs font-bold text-amber-600 font-mono">
                  {summary.total_calls_not_picked || 0}
                </div>
                <div className="text-[10px] text-slate-500">Unconnected</div>
              </div>
            </div>
          </div>

          {/* Secondary Metric: Turnaround Speed & Window */}
          <div className="flex items-center justify-between text-xs text-slate-600 bg-white p-2 rounded-lg border border-slate-100">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-semibold text-slate-700">Reconnect TAT:</span>
              <span className="font-mono font-bold text-slate-900">
                {formatMinutes(outgoingTAT?.mean)}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                (Med: {formatMinutes(outgoingTAT?.median)})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span 
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getTatBadgeColor(outgoingTAT?.median, reconnectionWindow)}`}
                title={`Target reconnection window configured in Master Settings: ${reconnectionWindowLabel}`}
              >
                {reconnectionWindowLabel} SLA
              </span>
            </div>
          </div>

          {/* Drill-down prompt */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 group-hover:text-blue-600 transition-colors pt-0.5 font-medium">
            <span>Click for agent breakdown &amp; raw data</span>
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* CARD 3: SMS FOLLOW-UP */}
      {/* ========================================================= */}
      <div
        id="card-consolidated-sms"
        onClick={() => onDrillDown('SMS_FOLLOWUP')}
        className={`group relative rounded-2xl border ${smsTheme.cardBorder} ${smsTheme.cardBg} p-5 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between`}
        role="button"
        tabIndex={0}
        aria-label="Filter SMS follow-up obligations and view agent drilldown"
      >
        <div>
          {/* Card Header */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-700 font-bold">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 leading-tight">
                  SMS Follow-Up
                </h3>
                <span className="text-[11px] text-slate-500">Outgoing Missed vs SMS Dispatched</span>
              </div>
            </div>

            {/* Open Obligations Badge */}
            <span 
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                smsOpen > 0 
                  ? 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse' 
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={`${smsOpen} open SMS follow-up obligations currently pending`}
            >
              {smsOpen > 0 ? (
                <AlertCircle className="w-3 h-3 text-amber-600" />
              ) : (
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              )}
              {smsOpen} Open
            </span>
          </div>

          {/* LAYER 1 (DOMINANT): Compliance Verdict */}
          <div className="my-3.5">
            {hasSmsObligations && smsPct !== null && smsPct !== undefined ? (
              <div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-4xl font-extrabold font-mono tracking-tight ${smsTheme.primaryText}`}>
                    {smsPct}%
                  </span>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                    Compliance
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  {smsMet} of {smsTotal} SMS dispatched within {smsWindow}m SLA deadline
                </p>
              </div>
            ) : (
              <div>
                <div className="text-lg sm:text-xl font-bold text-slate-600 tracking-tight">
                  No obligations in period
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  0 unpicked dials requiring follow-up SMS
                </p>
              </div>
            )}
          </div>
        </div>

        {/* LAYER 2 (SUPPORTING): Activity Volume Breakdown */}
        <div className="mt-2 pt-3 border-t border-slate-100/90 space-y-3">
          <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-100">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Outgoing Missed vs SMS Sent
            </div>
            <div className="grid grid-cols-3 gap-1 text-center divide-x divide-slate-200/80">
              <div>
                <div className="text-xs font-bold text-amber-700 font-mono">
                  {summary?.total_calls_not_picked ?? smsCreated}
                </div>
                <div className="text-[10px] text-slate-500">Unconnected</div>
              </div>
              <div>
                <div className="text-xs font-bold text-purple-600 font-mono">
                  {smsSent}
                </div>
                <div className="text-[10px] text-slate-500">SMS Sent</div>
              </div>
              <div>
                <div className="text-xs font-bold text-amber-600 font-mono">
                  {smsOpen}
                </div>
                <div className="text-[10px] text-slate-500">Outstanding</div>
              </div>
            </div>
          </div>

          {/* Secondary Metric: Turnaround Speed & Window */}
          <div className="flex items-center justify-between text-xs text-slate-600 bg-white p-2 rounded-lg border border-slate-100">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-semibold text-slate-700">Time to SMS:</span>
              <span className="font-mono font-bold text-slate-900">
                {formatMinutes(smsTAT?.mean)}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                (Med: {formatMinutes(smsTAT?.median)})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span 
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getTatBadgeColor(smsTAT?.median, smsWindow)}`}
                title={`Target SMS deadline configured in Master Settings: ${smsWindow} minutes`}
              >
                {smsWindow}m SLA
              </span>
            </div>
          </div>

          {/* Drill-down prompt */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 group-hover:text-purple-600 transition-colors pt-0.5 font-medium">
            <span>Click for agent breakdown &amp; raw data</span>
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </div>
    </div>
  );
};
