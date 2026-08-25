import React, { useState, useMemo } from 'react';
import { 
  X, 
  PhoneIncoming, 
  PhoneCall, 
  MessageSquare, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  AlertOctagon, 
  Search, 
  Filter, 
  User, 
  Phone, 
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Calendar,
  Layers,
  FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  Obligation, 
  AgentComplianceSummary, 
  TurnaroundTimeReport, 
  SystemSettings, 
  HeadlineComplianceStats,
  TagGroupCompliance 
} from '../types/compliance';

export type DrilldownCardType = 'MISSED_INCOMING_CALLBACK' | 'OUTGOING_RECONNECTION' | 'SMS_FOLLOWUP';

interface CardDrilldownModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardType: DrilldownCardType | null;
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
  agents: AgentComplianceSummary[];
  turnaroundReport?: TurnaroundTimeReport;
  settings?: SystemSettings;
  allObligations?: Obligation[];
  allEvents?: any[];
  startDate: string;
  endDate: string;
  onInspectContact: (phone: string) => void;
  onSelectAgent?: (agentId: number) => void;
}

export const CardDrilldownModal: React.FC<CardDrilldownModalProps> = ({
  isOpen,
  onClose,
  cardType,
  headlineStats,
  summary,
  agents = [],
  turnaroundReport,
  settings,
  allObligations = [],
  allEvents = [],
  startDate,
  endDate,
  onInspectContact,
  onSelectAgent,
}) => {
  const [activeTab, setActiveTab] = useState<'agents' | 'obligations' | 'events'>('agents');
  const [agentSearch, setAgentSearch] = useState<string>('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('ALL');
  const [obligationStatusFilter, setObligationStatusFilter] = useState<string>('ALL');
  const [recordSearch, setRecordSearch] = useState<string>('');

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

  const getComplianceBadge = (pct: number | null | undefined, countTotal: number) => {
    if (countTotal === 0 || pct === null || pct === undefined) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          No obligations
        </span>
      );
    }
    let color = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (pct < 75) color = 'bg-rose-50 text-rose-700 border-rose-200';
    else if (pct < 90) color = 'bg-amber-50 text-amber-700 border-amber-200';

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs border ${color}`}>
        {pct.toFixed(1)}%
      </span>
    );
  };

  // Card Meta Configurations
  const meta = cardType ? {
    MISSED_INCOMING_CALLBACK: {
      title: 'Incoming Calls & Callback Compliance Drilldown',
      subtitle: 'Raw agent activity and individual obligation audit for missed incoming calls',
      icon: PhoneIncoming,
      iconColor: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      slaMinutes: settings?.callback_window_minutes ?? 30,
      slaLabel: `${settings?.callback_window_minutes ?? 30} Minutes SLA`,
      compliancePct: headlineStats?.incoming_callback_compliance_pct,
      metCount: headlineStats?.incoming_callback_met || 0,
      totalCount: headlineStats?.incoming_callback_total || 0,
      openCount: headlineStats?.open_incoming_count || 0,
      tatMetric: turnaroundReport?.company_wide?.overall_callback_turnaround || turnaroundReport?.company_wide?.missed_to_connection,
      vol1Label: 'Total Received',
      vol1Val: summary.total_calls_incoming || 0,
      vol2Label: 'Answered (Connected)',
      vol2Val: summary.total_calls_incoming_connected || 0,
      vol3Label: 'Missed Calls (Triggers)',
      vol3Val: summary.total_calls_missed || 0,
    },
    OUTGOING_RECONNECTION: {
      title: 'Outgoing Calls & Reconnection Drilldown',
      subtitle: 'Raw agent dialling activity and reconnection obligation audit for unconnected calls',
      icon: PhoneCall,
      iconColor: 'text-blue-600 bg-blue-50 border-blue-200',
      slaMinutes: settings?.reconnection_window_minutes ?? 1440,
      slaLabel: `${(settings?.reconnection_window_minutes ?? 1440) >= 60 ? `${Math.round((settings?.reconnection_window_minutes ?? 1440) / 60)} Hours` : `${settings?.reconnection_window_minutes} Minutes`} SLA`,
      compliancePct: headlineStats?.outgoing_reconnect_compliance_pct,
      metCount: headlineStats?.outgoing_reconnect_met || 0,
      totalCount: headlineStats?.outgoing_reconnect_total || 0,
      openCount: headlineStats?.open_outgoing_count || 0,
      tatMetric: turnaroundReport?.company_wide?.failed_outgoing_to_connection || turnaroundReport?.company_wide?.overall_connection_turnaround,
      vol1Label: 'Total Dialled',
      vol1Val: summary.total_calls_made || 0,
      vol2Label: 'Connected Out',
      vol2Val: summary.total_calls_outgoing_connected || 0,
      vol3Label: 'Unconnected / Missed',
      vol3Val: summary.total_calls_not_picked || 0,
    },
    SMS_FOLLOWUP: {
      title: 'SMS Follow-Up Compliance & Dispatch Drilldown',
      subtitle: 'Audit of outgoing missed calls vs total follow-up SMS messages dispatched per agent',
      icon: MessageSquare,
      iconColor: 'text-purple-600 bg-purple-50 border-purple-200',
      slaMinutes: settings?.sms_deadline_minutes ?? 30,
      slaLabel: `${settings?.sms_deadline_minutes ?? 30} Minutes SLA`,
      compliancePct: headlineStats?.sms_followup_compliance_pct,
      metCount: headlineStats?.sms_followup_met || 0,
      totalCount: headlineStats?.sms_followup_total || 0,
      openCount: headlineStats?.open_sms_count || 0,
      tatMetric: turnaroundReport?.company_wide?.failed_outgoing_to_sms,
      vol1Label: 'Outgoing Missed Calls (Triggers)',
      vol1Val: summary.total_calls_not_picked || 0,
      vol2Label: 'Total SMS Sent',
      vol2Val: summary.total_sms || (headlineStats?.sms_followup_met || 0),
      vol3Label: 'Open Follow-ups',
      vol3Val: headlineStats?.open_sms_count || 0,
    }
  }[cardType] : null;

  // Available unique tags for filtering
  const allTags = Array.from(new Set(agents.map(a => a.tag).filter(Boolean)));

  // Filtered Agent Rows
  const filteredAgents = useMemo(() => {
    return agents.filter(agent => {
      if (selectedTagFilter !== 'ALL' && agent.tag !== selectedTagFilter) return false;
      if (agentSearch.trim()) {
        const query = agentSearch.toLowerCase();
        const matchesName = agent.agent_name.toLowerCase().includes(query);
        const matchesPhone = (agent.phone_number || '').includes(query);
        const matchesTag = (agent.tag || '').toLowerCase().includes(query);
        if (!matchesName && !matchesPhone && !matchesTag) return false;
      }
      return true;
    });
  }, [agents, selectedTagFilter, agentSearch]);

  // Filtered Obligations for this Card Type
  const relevantObligations = useMemo(() => {
    if (!cardType) return [];
    return allObligations.filter(obl => obl.obligation_type === cardType);
  }, [allObligations, cardType]);

  const filteredObligations = useMemo(() => {
    return relevantObligations.filter(obl => {
      if (obligationStatusFilter !== 'ALL' && obl.status !== obligationStatusFilter) return false;
      if (recordSearch.trim()) {
        const q = recordSearch.toLowerCase();
        const matchesPhone = obl.target_phone.toLowerCase().includes(q);
        const matchesAgent = obl.originating_agent_name.toLowerCase().includes(q) || (obl.resolving_agent_name || '').toLowerCase().includes(q);
        if (!matchesPhone && !matchesAgent) return false;
      }
      return true;
    });
  }, [relevantObligations, obligationStatusFilter, recordSearch]);

  // Filtered Raw Events
  const relevantEvents = useMemo(() => {
    if (!cardType) return [];
    if (cardType === 'MISSED_INCOMING_CALLBACK') {
      return allEvents.filter(e => e.type === 'CALL' && (e.status === 'MISSED' || e.status === 'INCOMING' || e.status === 'INCOMING_NOT_PICKED'));
    }
    if (cardType === 'OUTGOING_RECONNECTION') {
      return allEvents.filter(e => e.type === 'CALL' && (e.status === 'OUTGOING' || e.status === 'CONNECTED' || e.status === 'FAILED' || e.status === 'BUSY' || e.status === 'NO_ANSWER' || e.status === 'NOT_PICKED'));
    }
    return allEvents.filter(e => e.type === 'SMS' || (e.type === 'CALL' && (e.status === 'FAILED' || e.status === 'BUSY' || e.status === 'NO_ANSWER' || e.status === 'NOT_PICKED')));
  }, [allEvents, cardType]);

  const filteredEvents = useMemo(() => {
    if (!recordSearch.trim()) return relevantEvents;
    const q = recordSearch.toLowerCase();
    return relevantEvents.filter(e => 
      (e.target_phone || '').toLowerCase().includes(q) ||
      (e.agent_name || '').toLowerCase().includes(q) ||
      (e.status || '').toLowerCase().includes(q)
    );
  }, [relevantEvents, recordSearch]);

  // Export current drilldown view to Excel
  const handleExportDrilldown = () => {
    const wb = XLSX.utils.book_new();

    // Agent Sheet
    const agentData = filteredAgents.map(a => {
      const agentTat = turnaroundReport?.by_agent?.[a.agent_id];
      if (cardType === 'MISSED_INCOMING_CALLBACK') {
        return {
          'Agent Name': a.agent_name,
          'Department Tag': a.tag,
          'Phone': a.phone_number || '',
          'Calls Received': a.calls_incoming,
          'Calls Answered': a.calls_incoming_connected,
          'Missed Calls': a.calls_missed,
          'Callback Met in SLA': a.incoming_callback_met,
          'Total Evaluated': a.incoming_callback_total,
          'Callback Compliance %': a.incoming_callback_compliance_pct !== null ? `${a.incoming_callback_compliance_pct}%` : 'N/A',
          'Avg Callback TAT (min)': agentTat?.overall_callback_turnaround?.mean ?? 'N/A',
          'Median TAT (min)': agentTat?.overall_callback_turnaround?.median ?? 'N/A',
        };
      }
      if (cardType === 'OUTGOING_RECONNECTION') {
        return {
          'Agent Name': a.agent_name,
          'Department Tag': a.tag,
          'Phone': a.phone_number || '',
          'Calls Dialled': a.calls_made,
          'Connected Out': a.calls_outgoing_connected,
          'Unconnected / Missed': a.calls_not_picked,
          'Reconnected in SLA': a.outgoing_reconnect_met,
          'Total Evaluated': a.outgoing_reconnect_total,
          'Reconnection Compliance %': a.outgoing_reconnect_compliance_pct !== null ? `${a.outgoing_reconnect_compliance_pct}%` : 'N/A',
          'Avg Reconnect TAT (min)': agentTat?.failed_outgoing_to_connection?.mean ?? 'N/A',
          'Median TAT (min)': agentTat?.failed_outgoing_to_connection?.median ?? 'N/A',
        };
      }
      return {
        'Agent Name': a.agent_name,
        'Department Tag': a.tag,
        'Phone': a.phone_number || '',
        'Outgoing Missed Calls': a.calls_not_picked,
        'Total SMS Sent': a.sms_count,
        'SMS Met in SLA': a.sms_followup_met,
        'Total Evaluated': a.sms_followup_total,
        'SMS Compliance %': a.sms_followup_compliance_pct !== null ? `${a.sms_followup_compliance_pct}%` : 'N/A',
        'Avg Time to SMS (min)': agentTat?.failed_outgoing_to_sms?.mean ?? 'N/A',
        'Median TAT (min)': agentTat?.failed_outgoing_to_sms?.median ?? 'N/A',
      };
    });
    const wsAgents = XLSX.utils.json_to_sheet(agentData);
    XLSX.utils.book_append_sheet(wb, wsAgents, 'Agent Breakdown');

    // Obligations Sheet
    const oblData = filteredObligations.map(obl => ({
      'Obligation ID': obl.id,
      'Target Phone': obl.target_phone,
      'Originating Agent': obl.originating_agent_name,
      'Department Tag': obl.originating_agent_tag,
      'Trigger Time (Nairobi)': obl.trigger_local_timestamp,
      'SLA Deadline (Nairobi)': obl.deadline_local_timestamp,
      'Status': obl.status,
      'Turnaround Minutes': obl.turnaround_minutes ?? 'N/A',
      'Resolving Agent': obl.resolving_agent_name || 'N/A',
      'Resolution Time': obl.resolution_local_timestamp || 'N/A',
    }));
    const wsObl = XLSX.utils.json_to_sheet(oblData);
    XLSX.utils.book_append_sheet(wb, wsObl, 'Obligations Audit');

    XLSX.writeFile(wb, `Solvit_${cardType}_Drilldown_${startDate}_to_${endDate}.xlsx`);
  };

  if (!isOpen || !cardType || !meta) return null;

  const IconComponent = meta.icon;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div 
        id="card-drilldown-modal-container"
        className="bg-white rounded-2xl max-w-6xl w-full max-h-[92vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border shadow-xs ${meta.iconColor}`}>
              <IconComponent className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900 leading-tight">
                  {meta.title}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  {startDate === endDate ? startDate : `${startDate} to ${endDate}`}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  {meta.slaLabel}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {meta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-export-drilldown-excel"
              onClick={handleExportDrilldown}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 shadow-xs transition-colors"
              title="Export this drilldown to Excel"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Export Excel</span>
            </button>
            <button
              id="btn-close-card-drilldown-modal"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              aria-label="Close drilldown modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Top Summary Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 p-4 sm:p-5 bg-slate-50/70 border-b border-slate-100">
          {/* Primary Compliance KPI */}
          <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs col-span-2 sm:col-span-2">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1 font-medium">
              <span>Overall Compliance Rate</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900">
                {meta.compliancePct !== null && meta.compliancePct !== undefined ? `${meta.compliancePct}%` : 'N/A'}
              </span>
              <span className="text-xs text-slate-500 font-semibold">
                ({meta.metCount} of {meta.totalCount} in SLA)
              </span>
            </div>
          </div>

          {/* Volume 1 */}
          <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
            <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">
              {meta.vol1Label}
            </div>
            <div className="text-xl font-bold font-mono text-slate-900">
              {meta.vol1Val}
            </div>
          </div>

          {/* Volume 2 */}
          <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
            <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">
              {meta.vol2Label}
            </div>
            <div className="text-xl font-bold font-mono text-emerald-600">
              {meta.vol2Val}
            </div>
          </div>

          {/* Volume 3 / Triggers */}
          <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
            <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">
              {meta.vol3Label}
            </div>
            <div className="text-xl font-bold font-mono text-amber-600">
              {meta.vol3Val}
            </div>
          </div>

          {/* Speed / Turnaround */}
          <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
              <span>Avg Speed (TAT)</span>
              <Clock className="w-3 h-3 text-slate-400" />
            </div>
            <div className="text-lg font-bold font-mono text-slate-900">
              {formatMinutes(meta.tatMetric?.mean)}
            </div>
            <div className="text-[10px] text-slate-400">
              Med: {formatMinutes(meta.tatMetric?.median)}
            </div>
          </div>
        </div>

        {/* View Selection & Search Bar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
          {/* Tabs */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              id="tab-drilldown-agents"
              onClick={() => setActiveTab('agents')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'agents'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Agent Breakdown ({filteredAgents.length})</span>
            </button>
            <button
              id="tab-drilldown-obligations"
              onClick={() => setActiveTab('obligations')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'obligations'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Obligations Log ({relevantObligations.length})</span>
            </button>
            <button
              id="tab-drilldown-events"
              onClick={() => setActiveTab('events')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'events'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Raw Events ({relevantEvents.length})</span>
            </button>
          </div>

          {/* Contextual Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {activeTab === 'agents' ? (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="input-drilldown-search-agents"
                    type="text"
                    placeholder="Search agent name / phone..."
                    value={agentSearch}
                    onChange={(e) => setAgentSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none w-48 sm:w-56"
                  />
                </div>

                <select
                  id="select-drilldown-tag-filter"
                  value={selectedTagFilter}
                  onChange={(e) => setSelectedTagFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
                >
                  <option value="ALL">All Departments</option>
                  {allTags.map(tag => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              </>
            ) : activeTab === 'obligations' ? (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="input-drilldown-search-obligations"
                    type="text"
                    placeholder="Search phone or agent..."
                    value={recordSearch}
                    onChange={(e) => setRecordSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none w-48 sm:w-56"
                  />
                </div>

                <select
                  id="select-drilldown-status-filter"
                  value={obligationStatusFilter}
                  onChange={(e) => setObligationStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="MET">MET (In SLA)</option>
                  <option value="BREACHED">BREACHED</option>
                  <option value="OPEN">OPEN</option>
                </select>
              </>
            ) : (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="input-drilldown-search-events"
                  type="text"
                  placeholder="Filter events..."
                  value={recordSearch}
                  onChange={(e) => setRecordSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none w-48 sm:w-56"
                />
              </div>
            )}
          </div>
        </div>

        {/* Modal Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/40">
          {/* TAB 1: AGENT BREAKDOWN */}
          {activeTab === 'agents' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 text-slate-600 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Agent Name &amp; Role</th>
                      {cardType === 'MISSED_INCOMING_CALLBACK' && (
                        <>
                          <th className="py-3 px-3 text-center">Received</th>
                          <th className="py-3 px-3 text-center">Answered</th>
                          <th className="py-3 px-3 text-center">Missed</th>
                          <th className="py-3 px-3 text-center">In SLA</th>
                          <th className="py-3 px-3 text-center">Evaluated</th>
                          <th className="py-3 px-3 text-center">Compliance</th>
                          <th className="py-3 px-3 text-center">Avg TAT</th>
                        </>
                      )}
                      {cardType === 'OUTGOING_RECONNECTION' && (
                        <>
                          <th className="py-3 px-3 text-center">Dialled</th>
                          <th className="py-3 px-3 text-center">Connected</th>
                          <th className="py-3 px-3 text-center">Unconnected</th>
                          <th className="py-3 px-3 text-center">In SLA</th>
                          <th className="py-3 px-3 text-center">Evaluated</th>
                          <th className="py-3 px-3 text-center">Compliance</th>
                          <th className="py-3 px-3 text-center">Avg TAT</th>
                        </>
                      )}
                      {cardType === 'SMS_FOLLOWUP' && (
                        <>
                          <th className="py-3 px-3 text-center bg-purple-50/40">Outgoing Missed</th>
                          <th className="py-3 px-3 text-center">Total SMS Sent</th>
                          <th className="py-3 px-3 text-center">In SLA Dispatched</th>
                          <th className="py-3 px-3 text-center">Evaluated</th>
                          <th className="py-3 px-3 text-center">SMS Compliance</th>
                          <th className="py-3 px-3 text-center">Time to SMS</th>
                        </>
                      )}
                      <th className="py-3 px-3 text-center">Open</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAgents.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-400">
                          No matching agents found for this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredAgents.map(agent => {
                        const agentTat = turnaroundReport?.by_agent?.[agent.agent_id];

                        let compliancePct: number | null = null;
                        let metCount = 0;
                        let totalCount = 0;
                        let tatMean: number | null = null;
                        let tatMedian: number | null = null;

                        if (cardType === 'MISSED_INCOMING_CALLBACK') {
                          compliancePct = agent.incoming_callback_compliance_pct;
                          metCount = agent.incoming_callback_met;
                          totalCount = agent.incoming_callback_total;
                          tatMean = agentTat?.overall_callback_turnaround?.mean ?? agentTat?.missed_to_connection?.mean ?? null;
                          tatMedian = agentTat?.overall_callback_turnaround?.median ?? agentTat?.missed_to_connection?.median ?? null;
                        } else if (cardType === 'OUTGOING_RECONNECTION') {
                          compliancePct = agent.outgoing_reconnect_compliance_pct;
                          metCount = agent.outgoing_reconnect_met;
                          totalCount = agent.outgoing_reconnect_total;
                          tatMean = agentTat?.failed_outgoing_to_connection?.mean ?? agentTat?.overall_connection_turnaround?.mean ?? null;
                          tatMedian = agentTat?.failed_outgoing_to_connection?.median ?? agentTat?.overall_connection_turnaround?.median ?? null;
                        } else {
                          compliancePct = agent.sms_followup_compliance_pct;
                          metCount = agent.sms_followup_met;
                          totalCount = agent.sms_followup_total;
                          tatMean = agentTat?.failed_outgoing_to_sms?.mean ?? null;
                          tatMedian = agentTat?.failed_outgoing_to_sms?.median ?? null;
                        }

                        // Agent's open count for this specific card
                        const agentOpenCount = relevantObligations.filter(
                          obl => obl.originating_agent_id === agent.agent_id && obl.status === 'OPEN'
                        ).length;

                        return (
                          <tr key={agent.agent_id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900">{agent.agent_name}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                  {agent.tag || 'Uncategorised'}
                                </span>
                                {agent.phone_number && (
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {agent.phone_number}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* INCOMING CARD METRICS */}
                            {cardType === 'MISSED_INCOMING_CALLBACK' && (
                              <>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-slate-800">
                                  {agent.calls_incoming}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-emerald-600">
                                  {agent.calls_incoming_connected}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-rose-600">
                                  {agent.calls_missed}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-emerald-700">
                                  {metCount}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-600">
                                  {totalCount}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  {getComplianceBadge(compliancePct, totalCount)}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-700">
                                  {formatMinutes(tatMean)}
                                  {tatMedian !== null && (
                                    <span className="text-[10px] text-slate-400 block">
                                      Med: {formatMinutes(tatMedian)}
                                    </span>
                                  )}
                                </td>
                              </>
                            )}

                            {/* OUTGOING CARD METRICS */}
                            {cardType === 'OUTGOING_RECONNECTION' && (
                              <>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-slate-800">
                                  {agent.calls_made}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-emerald-600">
                                  {agent.calls_outgoing_connected}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-amber-600">
                                  {agent.calls_not_picked}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-emerald-700">
                                  {metCount}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-600">
                                  {totalCount}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  {getComplianceBadge(compliancePct, totalCount)}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-700">
                                  {formatMinutes(tatMean)}
                                  {tatMedian !== null && (
                                    <span className="text-[10px] text-slate-400 block">
                                      Med: {formatMinutes(tatMedian)}
                                    </span>
                                  )}
                                </td>
                              </>
                            )}

                            {/* SMS FOLLOW-UP METRICS */}
                            {cardType === 'SMS_FOLLOWUP' && (
                              <>
                                <td className="py-3 px-3 text-center font-mono font-bold text-amber-700 bg-purple-50/20">
                                  {agent.calls_not_picked}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-purple-700">
                                  {agent.sms_count}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-emerald-700">
                                  {metCount}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-600">
                                  {totalCount}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  {getComplianceBadge(compliancePct, totalCount)}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-700">
                                  {formatMinutes(tatMean)}
                                  {tatMedian !== null && (
                                    <span className="text-[10px] text-slate-400 block">
                                      Med: {formatMinutes(tatMedian)}
                                    </span>
                                  )}
                                </td>
                              </>
                            )}

                            <td className="py-3 px-3 text-center">
                              {agentOpenCount > 0 ? (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                  <AlertCircle className="w-3 h-3 text-amber-600" />
                                  {agentOpenCount}
                                </span>
                              ) : (
                                <span className="text-slate-400 font-mono text-xs">0</span>
                              )}
                            </td>

                            <td className="py-3 px-4 text-right">
                              {onSelectAgent && (
                                <button
                                  id={`btn-drilldown-agent-${agent.agent_id}`}
                                  onClick={() => {
                                    onSelectAgent(agent.agent_id);
                                    onClose();
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-200 transition-colors"
                                >
                                  <span>Filter Agent</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: OBLIGATIONS LOG */}
          {activeTab === 'obligations' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 text-slate-600 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Target Phone</th>
                      <th className="py-3 px-3">Agent</th>
                      <th className="py-3 px-3">Trigger Time</th>
                      <th className="py-3 px-3">SLA Deadline</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-3 text-center">Turnaround</th>
                      <th className="py-3 px-3">Resolved By</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredObligations.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          No obligations found for this view.
                        </td>
                      </tr>
                    ) : (
                      filteredObligations.map(obl => {
                        let statusBadge = (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertCircle className="w-3 h-3" />
                            OPEN
                          </span>
                        );
                        if (obl.status === 'MET') {
                          statusBadge = (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" />
                              MET
                            </span>
                          );
                        } else if (obl.status === 'BREACHED') {
                          statusBadge = (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] bg-rose-50 text-rose-700 border border-rose-200">
                              <AlertOctagon className="w-3 h-3" />
                              BREACHED
                            </span>
                          );
                        }

                        return (
                          <tr key={obl.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4 font-mono font-bold text-slate-900">
                              {obl.target_phone}
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-800">{obl.originating_agent_name}</div>
                              <span className="text-[10px] text-slate-400">{obl.originating_agent_tag}</span>
                            </td>
                            <td className="py-3 px-3 text-slate-600 font-mono text-[11px]">
                              {obl.trigger_local_timestamp || obl.trigger_timestamp}
                            </td>
                            <td className="py-3 px-3 text-slate-600 font-mono text-[11px]">
                              {obl.deadline_local_timestamp || obl.deadline_timestamp}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {statusBadge}
                            </td>
                            <td className="py-3 px-3 text-center font-mono font-semibold text-slate-800">
                              {obl.status === 'OPEN' 
                                ? (obl.remaining_minutes !== undefined ? `${Math.round(obl.remaining_minutes)}m left` : 'Pending')
                                : formatMinutes(obl.turnaround_minutes)
                              }
                            </td>
                            <td className="py-3 px-3 text-slate-600 text-[11px]">
                              {obl.resolving_agent_name ? (
                                <div>
                                  <span className="font-medium text-slate-800">{obl.resolving_agent_name}</span>
                                  <span className="text-[10px] text-slate-400 block font-mono">
                                    {obl.resolution_local_timestamp}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">None</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                id={`btn-inspect-obl-contact-${obl.id}`}
                                onClick={() => onInspectContact(obl.target_phone)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg border border-indigo-200 transition-colors"
                              >
                                <span>History</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: RAW EVENTS */}
          {activeTab === 'events' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 text-slate-600 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Local Timestamp</th>
                      <th className="py-3 px-3">Agent</th>
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3">Target Phone</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-center">Duration</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEvents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          No raw communication events found.
                        </td>
                      </tr>
                    ) : (
                      filteredEvents.slice(0, 100).map((ev, idx) => (
                        <tr key={ev.id || idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-4 font-mono text-slate-600 text-[11px]">
                            {ev.local_timestamp || ev.timestamp}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800">
                            {ev.agent_name || 'Unknown'}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-700">
                            {ev.type}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                            {ev.target_phone}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              {ev.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                            {ev.duration ? `${ev.duration}s` : '-'}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              id={`btn-inspect-ev-phone-${ev.id || idx}`}
                              onClick={() => onInspectContact(ev.target_phone)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition-colors"
                            >
                              <span>Inspect</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between">
          <div className="text-xs text-slate-500 font-medium">
            Showing raw records for <strong className="text-slate-800">{meta.title}</strong>
          </div>
          <button
            id="btn-footer-close-drilldown"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors"
          >
            Close Drilldown
          </button>
        </div>
      </div>
    </div>
  );
};
