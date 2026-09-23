import React, { useState, useRef, useEffect } from 'react';
import { 
  PhoneIncoming, 
  PhoneCall, 
  MessageSquare, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight,
  Info
} from 'lucide-react';
import { 
  HeadlineComplianceStats, 
  TurnaroundMetricsGroup, 
  SystemSettings 
} from '../types/compliance';

interface CardInfoTooltipProps {
  id: string;
  title: string;
  text: string;
}

const CardInfoTooltip: React.FC<CardInfoTooltipProps> = ({ id, title, text }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      <button
        id={id}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className="p-0.5 text-slate-400 hover:text-slate-600 rounded-full transition-colors cursor-pointer focus:outline-hidden"
        aria-label={`Information for ${title}`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          role="tooltip"
          className="absolute left-0 top-full mt-1.5 z-50 w-72 sm:w-80 rounded-xl bg-slate-900 text-slate-100 text-[11px] leading-relaxed p-3.5 shadow-xl border border-slate-700/80 pointer-events-auto"
        >
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 mb-1">
            {title}
          </div>
          <p className="text-slate-200 font-normal">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};

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

  const getCardTheme = (carriedOverCount: number, openCount: number) => {
    if (carriedOverCount > 0) {
      return {
        cardBorder: 'border-rose-200/90 hover:border-rose-400',
        cardBg: 'bg-gradient-to-b from-rose-50/20 via-white to-white',
        primaryText: 'text-rose-700',
      };
    }
    if (openCount > 0) {
      return {
        cardBorder: 'border-amber-200/90 hover:border-amber-400',
        cardBg: 'bg-gradient-to-b from-amber-50/20 via-white to-white',
        primaryText: 'text-amber-700',
      };
    }
    return {
      cardBorder: 'border-slate-200 hover:border-slate-300',
      cardBg: 'bg-white',
      primaryText: 'text-slate-800',
    };
  };

  // --- 1. CARD 1: INCOMING DATA ---
  const incomingMet = headlineStats?.incoming_callback_met || 0;
  const incomingOpen = headlineStats?.open_incoming_count || 0;
  const incomingCarriedOver = headlineStats?.carried_over_incoming_count || 0;
  const incomingNotReturned = headlineStats?.incoming_not_returned_count ?? incomingCarriedOver;
  const incomingReturnedTotal = headlineStats?.incoming_returned_total_count ?? incomingMet;
  const incomingReturnedWithinSla = headlineStats?.incoming_returned_within_sla_count ?? incomingMet;
  const incomingReturnedOutsideSla = headlineStats?.incoming_returned_outside_sla_count ?? 0;
  const incomingTheme = getCardTheme(incomingNotReturned, incomingOpen);
  const incomingTAT = turnaroundGroup?.overall_callback_turnaround || turnaroundGroup?.missed_to_connection;

  // --- 2. CARD 2: OUTGOING DATA (Activity only, no compliance) ---
  const outgoingDialled = summary?.total_calls_made || 0;
  const outgoingConnected = summary?.total_calls_outgoing_connected || 0;
  const outgoingNotConnected = Math.max(0, outgoingDialled - outgoingConnected);
  const avgTriesPerUnconnected = headlineStats?.avg_tries_per_unconnected_number ?? 0;
  const outgoingTheme = getCardTheme(0, 0);
  const outgoingTAT = turnaroundGroup?.failed_outgoing_to_connection || turnaroundGroup?.overall_connection_turnaround;

  // --- 3. CARD 3: SMS FOLLOW-UP DATA ---
  const smsMet = headlineStats?.sms_followup_met || 0;
  const smsOpen = headlineStats?.open_sms_count || 0;
  const smsCarriedOver = headlineStats?.carried_over_sms_count || 0;
  const smsTheme = getCardTheme(smsCarriedOver, smsOpen);
  const smsTAT = turnaroundGroup?.failed_outgoing_to_sms;
  const smsEligible = headlineStats?.sms_followup_total ?? (summary?.total_calls_not_picked || 0);
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
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-900 leading-tight">
                    Incoming Calls
                  </h3>
                  <CardInfoTooltip
                    id="info-tooltip-incoming"
                    title="Incoming Calls"
                    text="Received is every incoming call today. Answered is the ones picked up directly. Missed is the rest, calls that rang without being picked up. Each missed call becomes a callback case. Total Returned is how many of those cases have been called back and reached. Within SLA means the callback happened inside the 30-minute target set in Master Settings. Outside SLA means it still happened, just later than that. Not Returned means no callback has reached this person yet."
                  />
                </div>
                <span className="text-[11px] text-slate-500">Daily Callback Tracking</span>
              </div>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span 
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                  incomingOpen > 0 
                    ? 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse' 
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {incomingOpen > 0 ? (
                  <AlertCircle className="w-3 h-3 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                )}
                {incomingOpen} Open
                <span className="text-[10px] font-normal text-amber-900/70 border-l border-amber-300/60 pl-1 ml-0.5">Still within window</span>
              </span>

              <span 
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                  incomingNotReturned > 0 
                    ? 'bg-rose-100 text-rose-800 border-rose-200 animate-pulse' 
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {incomingNotReturned > 0 ? (
                  <AlertCircle className="w-3 h-3 text-rose-600" />
                ) : (
                  <CheckCircle2 className="w-3 h-3 text-slate-400" />
                )}
                {incomingNotReturned} Not Returned
                <span className="text-[10px] font-normal text-rose-900/70 border-l border-rose-300/60 pl-1 ml-0.5">Not reached yet</span>
              </span>
            </div>
          </div>

          {/* Top Line: Raw Activity */}
          <div className="my-2.5 grid grid-cols-3 gap-2">
            <div className="bg-slate-50/90 rounded-xl p-2 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Received
              </div>
              <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">{summary?.total_calls_incoming || 0}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Answered or missed</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Answered
              </div>
              <div className="text-lg font-bold font-mono text-emerald-600 mt-0.5">{summary?.total_calls_incoming_connected || 0}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Picked up directly</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Missed
              </div>
              <div className="text-lg font-bold font-mono text-amber-600 mt-0.5">{summary?.total_calls_missed || 0}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Rang, unanswered</div>
            </div>
          </div>

          {/* Breakdown Block */}
          <div className="my-2.5 grid grid-cols-2 gap-2">
            <div className="bg-slate-50/90 rounded-xl p-2 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Total Returned
              </div>
              <div className="text-lg font-bold font-mono text-indigo-700 mt-0.5">{incomingReturnedTotal}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Missed calls reached since</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Within SLA
              </div>
              <div className="text-lg font-bold font-mono text-emerald-700 mt-0.5">{incomingReturnedWithinSla}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Back within 30 min</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Outside SLA
              </div>
              <div className="text-lg font-bold font-mono text-amber-700 mt-0.5">{incomingReturnedOutsideSla}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Back, but later</div>
            </div>
            <div className={`rounded-xl p-2 border flex flex-col justify-between ${incomingNotReturned > 0 ? 'bg-rose-50/80 border-rose-200' : 'bg-slate-50/90 border-slate-100'}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider ${incomingNotReturned > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                Not Returned
              </div>
              <div className={`text-lg font-bold font-mono mt-0.5 ${incomingNotReturned > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{incomingNotReturned}</div>
              <div className={`text-[10.5px] mt-0.5 leading-tight truncate ${incomingNotReturned > 0 ? 'text-rose-500' : 'text-slate-400'}`}>Not reached yet</div>
            </div>
          </div>
        </div>

        {/* Turnaround Speed & Window */}
        <div className="mt-2 pt-3 border-t border-slate-100/90 space-y-3">
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
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200 flex items-center gap-1">
                <span>{settings?.callback_window_minutes || 30}m SLA</span>
                <span className="text-[9px] font-normal text-indigo-500/80 border-l border-indigo-200 pl-1">Target for this card</span>
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
        aria-label="Filter outgoing dialling activity and turnaround"
      >
        <div>
          {/* Card Header */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-700 font-bold">
                <PhoneCall className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-900 leading-tight">
                    Outgoing Calls
                  </h3>
                  <CardInfoTooltip
                    id="info-tooltip-outgoing"
                    title="Outgoing Calls"
                    text="Dialled is every outgoing call attempt today. Connected is the ones that reached someone. Not Connected is the rest. Avg Tries / Unconnected is, on average, how many times a number was dialled before the day's attempts on it stopped, whether because it finally connected or because the team moved on."
                  />
                </div>
                <span className="text-[11px] text-slate-500">Daily Dialling Activity</span>
              </div>
            </div>
          </div>

          {/* 4 PLAIN ACTIVITY COUNTS */}
          <div className="my-3.5 grid grid-cols-2 gap-2.5">
            <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Dialled
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-0.5">{outgoingDialled}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Every attempt today</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Connected
              </div>
              <div className="text-xl font-bold font-mono text-emerald-600 mt-0.5">{outgoingConnected}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Reached someone</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Not Connected
              </div>
              <div className="text-xl font-bold font-mono text-amber-700 mt-0.5">{outgoingNotConnected}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Didn't connect</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Avg Tries / Unconnected
              </div>
              <div className="text-xl font-bold font-mono text-blue-700 mt-0.5">{avgTriesPerUnconnected}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Dials before stopping</div>
            </div>
          </div>
        </div>

        {/* Turnaround Speed & Window */}
        <div className="mt-2 pt-3 border-t border-slate-100/90 space-y-3">
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
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-900 leading-tight">
                    SMS Follow-Up
                  </h3>
                  <CardInfoTooltip
                    id="info-tooltip-sms"
                    title="SMS Follow-Up"
                    text="Every outgoing call that doesn't connect opens its own case here, even if the same number was tried more than once. Eligible is the total of those cases today. Sending one SMS to a number clears every case open for it at once, it doesn't take a separate message per attempt. Sent is how many cases have had that message go out. Returned within period means the SMS went out before the working day ended. Carried Over means the day ended before it did."
                  />
                </div>
                <span className="text-[11px] text-slate-500">Daily Follow-up SMS Tracking</span>
              </div>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span 
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                  smsOpen > 0 
                    ? 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse' 
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {smsOpen > 0 ? (
                  <AlertCircle className="w-3 h-3 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                )}
                {smsOpen} Open
                <span className="text-[10px] font-normal text-amber-900/70 border-l border-amber-300/60 pl-1 ml-0.5">Still within today</span>
              </span>

              <span 
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                  smsCarriedOver > 0 
                    ? 'bg-rose-100 text-rose-800 border-rose-200 animate-pulse' 
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {smsCarriedOver > 0 ? (
                  <AlertCircle className="w-3 h-3 text-rose-600" />
                ) : (
                  <CheckCircle2 className="w-3 h-3 text-slate-400" />
                )}
                {smsCarriedOver} Carried Over
                <span className="text-[10px] font-normal text-rose-900/70 border-l border-rose-300/60 pl-1 ml-0.5">Not sent same day</span>
              </span>
            </div>
          </div>

          {/* PLAIN COUNT GRID */}
          <div className="my-3.5 grid grid-cols-2 gap-2.5">
            <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Eligible
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-0.5">{smsEligible}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">One per unconnected call</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Sent
              </div>
              <div className="text-xl font-bold font-mono text-purple-600 mt-0.5">{smsSent}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">SMS sent, clears all</div>
            </div>
            <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Returned within period
              </div>
              <div className="text-xl font-bold font-mono text-purple-700 mt-0.5">{smsMet}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 leading-tight truncate">Sent same day</div>
            </div>
            <div className={`rounded-xl p-2.5 border flex flex-col justify-between ${smsCarriedOver > 0 ? 'bg-rose-50/80 border-rose-200' : 'bg-slate-50/90 border-slate-100'}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider ${smsCarriedOver > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                Carried over to next period
              </div>
              <div className={`text-xl font-bold font-mono mt-0.5 ${smsCarriedOver > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{smsCarriedOver}</div>
              <div className={`text-[10.5px] mt-0.5 leading-tight truncate ${smsCarriedOver > 0 ? 'text-rose-500' : 'text-slate-400'}`}>Not sent same day</div>
            </div>
          </div>
        </div>

        {/* Turnaround Speed & Window */}
        <div className="mt-2 pt-3 border-t border-slate-100/90 space-y-3">
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
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold border bg-purple-50 text-purple-700 border-purple-200 flex items-center gap-1">
                <span>Within the Day</span>
                <span className="text-[9px] font-normal text-purple-500/80 border-l border-purple-200 pl-1">Target for this card</span>
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
