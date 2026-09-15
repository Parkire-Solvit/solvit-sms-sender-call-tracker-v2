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
  ExternalLink, 
  Layers, 
  FileSpreadsheet 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  Obligation, 
  AgentComplianceSummary, 
  TurnaroundTimeReport, 
  SystemSettings, 
  HeadlineComplianceStats 
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
  allObligations: Obligation[];
  rawEvents?: any[];
  onInspectContact: (phone: string) => void;
  onInspectAgent: (agentId: number) => void;
}

export const CardDrilldownModal: React.FC<CardDrilldownModalProps> = ({
  isOpen,
  onClose,
  cardType,
  headlineStats,
  summary,
  agents,
  turnaroundReport,
  settings,
  allObligations,
  rawEvents = [],
  onInspectContact,
  onInspectAgent,
}) => {
  const [activeTab, setActiveTab] = useState<'agents' | 'obligations' | 'events'>('agents');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('ALL');
  const [obligationStatusFilter, setObligationStatusFilter] = useState<string>('ALL');
  const [agentSearch, setAgentSearch] = useState<string>('');
  const [recordSearch, setRecordSearch] = useState<string>('');

  if (!isOpen || !cardType) return null;

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

  // Card Meta Configurations
  const meta = {
    MISSED_INCOMING_CALLBACK: {
      title: 'Incoming Calls Drilldown',
      subtitle: 'Raw agent activity and individual obligation audit for missed incoming calls',
      icon: PhoneIncoming,
      iconColor: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      slaLabel: `${settings?.callback_window_minutes || 30}m SLA`,
      tatMetric: turnaroundReport?.company_wide?.overall_callback_turnaround || turnaroundReport?.company_wide?.missed_to_connection,
    },
    OUTGOING_RECONNECTION: {
      title: 'Outgoing Calls Drilldown',
      subtitle: 'Raw agent dialling activity and reconnection turnaround for unconnected calls',
      icon: PhoneCall,
      iconColor: 'text-blue-600 bg-blue-50 border-blue-200',
      slaLabel: null,
      tatMetric: turnaroundReport?.company_wide?.failed_outgoing_to_connection || turnaroundReport?.company_wide?.overall_connection_turnaround,
    },
    SMS_FOLLOWUP: {
      title: 'SMS Follow-Up Drilldown',
      subtitle: 'Audit of outgoing missed calls vs total follow-up SMS messages dispatched per agent',
      icon: MessageSquare,
      iconColor: 'text-purple-600 bg-purple-50 border-purple-200',
      slaLabel: 'Within the Day',
      tatMetric: turnaroundReport?.company_wide?.failed_outgoing_to_sms,
    }
  }[cardType];

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
        const query = recordSearch.toLowerCase();
        const matchesPhone = obl.target_phone.toLowerCase().includes(query);
        const matchesAgent = obl.originating_agent_name.toLowerCase().includes(query);
        const matchesResolver = (obl.resolving_agent_name || '').toLowerCase().includes(query);
        const matchesId = obl.id.toLowerCase().includes(query);
        if (!matchesPhone && !matchesAgent && !matchesResolver && !matchesId) return false;
      }
      return true;
    });
  }, [relevantObligations, obligationStatusFilter, recordSearch]);

  // Filtered Raw Events
  const filteredEvents = useMemo(() => {
    return rawEvents.filter(ev => {
      if (cardType === 'MISSED_INCOMING_CALLBACK') {
        if (ev.type !== 'CALL') return false;
        if (ev.status !== 'MISSED' && ev.status !== 'INCOMING_NOT_PICKED' && ev.direction !== 'INCOMING') return false;
      } else if (cardType === 'OUTGOING_RECONNECTION') {
        if (ev.type !== 'CALL' || ev.direction !== 'OUTGOING') return false;
      } else if (cardType === 'SMS_FOLLOWUP') {
        if (ev.type !== 'SMS' && !(ev.type === 'CALL' && (ev.status === 'MISSED' || ev.status === 'NO_ANSWER' || ev.status === 'FAILED'))) {
          return false;
        }
      }
      if (recordSearch.trim()) {
        const query = recordSearch.toLowerCase();
        const matchesPhone = (ev.target_phone || '').toLowerCase().includes(query);
        const matchesAgent = (ev.agent_name || '').toLowerCase().includes(query);
        if (!matchesPhone && !matchesAgent) return false;
      }
      return true;
    });
  }, [rawEvents, cardType, recordSearch]);

  // Export Drilldown Data to Excel
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
          'Returned Within SLA': a.incoming_returned_within_sla_count ?? a.incoming_callback_met,
          'Returned Outside SLA': a.incoming_returned_outside_sla_count ?? 0,
          'Not Returned': a.incoming_not_returned_count ?? (a.carried_over_incoming_count || 0),
          'Open Obligations': a.open_obligations_count,
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
          'Not Connected': Math.max(0, a.calls_made - a.calls_outgoing_connected),
          'Avg Reconnect TAT (min)': agentTat?.failed_outgoing_to_connection?.mean ?? 'N/A',
          'Median TAT (min)': agentTat?.failed_outgoing_to_connection?.median ?? 'N/A',
        };
      }
      return {
        'Agent Name': a.agent_name,
        'Department Tag': a.tag,
        'Phone': a.phone_number || '',
        'Eligible Missed Calls': a.calls_not_picked,
        'Total SMS Sent': a.sms_count,
        'Returned within period': a.sms_followup_met,
        'Carried over to next period': a.carried_over_sms_count || 0,
        'Open Obligations': a.open_obligations_count,
        'Avg Time to SMS (min)': agentTat?.failed_outgoing_to_sms?.mean ?? 'N/A',
        'Median TAT (min)': agentTat?.failed_outgoing_to_sms?.median ?? 'N/A',
      };
    });
    const wsAgents = XLSX.utils.json_to_sheet(agentData);
    XLSX.utils.book_append_sheet(wb, wsAgents, 'Agent Breakdown');

    // Obligations Sheet (if card has obligations)
    if (cardType !== 'OUTGOING_RECONNECTION') {
      const oblData = filteredObligations.map(obl => ({
        'Obligation ID': obl.id,
        'Target Phone': obl.target_phone,
        'Originating Agent': obl.originating_agent_name,
        'Department Tag': obl.originating_agent_tag,
        'Trigger Time (Nairobi)': obl.trigger_local_timestamp,
        'Deadline (Nairobi)': obl.deadline_local_timestamp,
        'Status': obl.status,
        'Turnaround Minutes': obl.turnaround_minutes ?? 'N/A',
        'Resolving Agent': obl.resolving_agent_name || 'N/A',
        'Resolution Time': obl.resolution_local_timestamp || 'N/A',
      }));
      const wsObl = XLSX.utils.json_to_sheet(oblData);
      XLSX.utils.book_append_sheet(wb, wsObl, 'Obligations Audit');
    }

    XLSX.writeFile(wb, `${cardType}_drilldown_audit.xlsx`);
  };

  const IconComponent = meta.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div 
        id="modal-card-drilldown-container"
        className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Modal Top Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${meta.iconColor}`}>
              <IconComponent className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                  {meta.title}
                </h2>
                {meta.slaLabel && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {meta.slaLabel}
                  </span>
                )}
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

        {/* Top Summary Banner: Plain-Count Reporting */}
        {cardType === 'MISSED_INCOMING_CALLBACK' && (
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 p-4 sm:p-5 bg-slate-50/70 border-b border-slate-100">
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Received</div>
              <div className="text-xl font-bold font-mono text-slate-900">{summary.total_calls_incoming || 0}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Answered</div>
              <div className="text-xl font-bold font-mono text-emerald-600">{summary.total_calls_incoming_connected || 0}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Within SLA</div>
              <div className="text-xl font-bold font-mono text-emerald-700">{headlineStats?.incoming_returned_within_sla_count ?? 0}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Outside SLA</div>
              <div className="text-xl font-bold font-mono text-amber-700">{headlineStats?.incoming_returned_outside_sla_count ?? 0}</div>
            </div>
            <div className={`p-3 rounded-xl border shadow-xs ${(headlineStats?.incoming_not_returned_count || 0) > 0 ? 'bg-rose-50/70 border-rose-200' : 'bg-white border-slate-200/90'}`}>
              <div className={`text-[11px] font-semibold truncate mb-1 ${(headlineStats?.incoming_not_returned_count || 0) > 0 ? 'text-rose-600' : 'text-slate-500'}`}>Not Returned</div>
              <div className={`text-xl font-bold font-mono ${(headlineStats?.incoming_not_returned_count || 0) > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                {headlineStats?.incoming_not_returned_count ?? 0}
              </div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                <span>Avg Callback TAT</span>
                <Clock className="w-3 h-3 text-slate-400" />
              </div>
              <div className="text-lg font-bold font-mono text-slate-900">{formatMinutes(meta.tatMetric?.mean)}</div>
              <div className="text-[10px] text-slate-400">Med: {formatMinutes(meta.tatMetric?.median)}</div>
            </div>
          </div>
        )}

        {cardType === 'OUTGOING_RECONNECTION' && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 sm:p-5 bg-slate-50/70 border-b border-slate-100">
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Dialled</div>
              <div className="text-xl font-bold font-mono text-slate-900">{summary.total_calls_made || 0}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Connected</div>
              <div className="text-xl font-bold font-mono text-emerald-600">{summary.total_calls_outgoing_connected || 0}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Not Connected</div>
              <div className="text-xl font-bold font-mono text-amber-700">
                {Math.max(0, (summary.total_calls_made || 0) - (summary.total_calls_outgoing_connected || 0))}
              </div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Avg Tries / Unconnected</div>
              <div className="text-xl font-bold font-mono text-blue-700">
                {headlineStats?.avg_tries_per_unconnected_number ?? 0}
              </div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                <span>Avg Reconnect TAT</span>
                <Clock className="w-3 h-3 text-slate-400" />
              </div>
              <div className="text-lg font-bold font-mono text-slate-900">{formatMinutes(meta.tatMetric?.mean)}</div>
              <div className="text-[10px] text-slate-400">Med: {formatMinutes(meta.tatMetric?.median)}</div>
            </div>
          </div>
        )}

        {cardType === 'SMS_FOLLOWUP' && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 sm:p-5 bg-slate-50/70 border-b border-slate-100">
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Eligible</div>
              <div className="text-xl font-bold font-mono text-slate-900">{headlineStats?.sms_followup_total ?? (summary.total_calls_not_picked || 0)}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Sent</div>
              <div className="text-xl font-bold font-mono text-purple-600">{summary.total_sms || (headlineStats?.sms_followup_met || 0)}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 truncate mb-1">Returned within period</div>
              <div className="text-xl font-bold font-mono text-purple-700">{headlineStats?.sms_followup_met || 0}</div>
            </div>
            <div className={`p-3 rounded-xl border shadow-xs ${(headlineStats?.carried_over_sms_count || 0) > 0 ? 'bg-rose-50/70 border-rose-200' : 'bg-white border-slate-200/90'}`}>
              <div className={`text-[11px] font-semibold truncate mb-1 ${(headlineStats?.carried_over_sms_count || 0) > 0 ? 'text-rose-600' : 'text-slate-500'}`}>Carried over to next period</div>
              <div className={`text-xl font-bold font-mono ${(headlineStats?.carried_over_sms_count || 0) > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                {headlineStats?.carried_over_sms_count || 0}
              </div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                <span>Avg Time to SMS</span>
                <Clock className="w-3 h-3 text-slate-400" />
              </div>
              <div className="text-lg font-bold font-mono text-slate-900">{formatMinutes(meta.tatMetric?.mean)}</div>
              <div className="text-[10px] text-slate-400">Med: {formatMinutes(meta.tatMetric?.median)}</div>
            </div>
          </div>
        )}

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
            {cardType !== 'OUTGOING_RECONNECTION' && (
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
            )}
            <button
              id="tab-drilldown-events"
              onClick={() => setActiveTab('events')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'events'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Raw Events Stream</span>
            </button>
          </div>

          {/* Filtering Controls */}
          <div className="flex items-center gap-2">
            {activeTab === 'agents' ? (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="input-drilldown-search-agent"
                    type="text"
                    placeholder="Search agent name..."
                    value={agentSearch}
                    onChange={(e) => setAgentSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none w-48 sm:w-56"
                  />
                </div>

                {allTags.length > 0 && (
                  <div className="flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5 text-slate-400" />
                    <select
                      id="select-drilldown-tag-filter"
                      value={selectedTagFilter}
                      onChange={(e) => setSelectedTagFilter(e.target.value)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                      <option value="ALL">All Departments</option>
                      {allTags.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            ) : activeTab === 'obligations' ? (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="input-drilldown-search-records"
                    type="text"
                    placeholder="Search phone or agent..."
                    value={recordSearch}
                    onChange={(e) => setRecordSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none w-48 sm:w-56"
                  />
                </div>

                <select
                  id="select-drilldown-status-filter"
                  value={obligationStatusFilter}
                  onChange={(e) => setObligationStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="MET">MET</option>
                  <option value="CARRIED_OVER">CARRIED OVER</option>
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
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none w-48 sm:w-56"
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
                          <th className="py-3 px-3 text-center">Within SLA</th>
                          <th className="py-3 px-3 text-center">Outside SLA</th>
                          <th className="py-3 px-3 text-center">Not Returned</th>
                          <th className="py-3 px-3 text-center">Avg TAT</th>
                          <th className="py-3 px-3 text-center">Open</th>
                        </>
                      )}
                      {cardType === 'OUTGOING_RECONNECTION' && (
                        <>
                          <th className="py-3 px-3 text-center">Dialled</th>
                          <th className="py-3 px-3 text-center">Connected</th>
                          <th className="py-3 px-3 text-center">Not Connected</th>
                          <th className="py-3 px-3 text-center">Avg TAT</th>
                        </>
                      )}
                      {cardType === 'SMS_FOLLOWUP' && (
                        <>
                          <th className="py-3 px-3 text-center">Eligible</th>
                          <th className="py-3 px-3 text-center">Sent</th>
                          <th className="py-3 px-3 text-center">Returned within period</th>
                          <th className="py-3 px-3 text-center">Carried over to next period</th>
                          <th className="py-3 px-3 text-center">Time to SMS</th>
                          <th className="py-3 px-3 text-center">Open</th>
                        </>
                      )}
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

                        let tatMean: number | null = null;
                        let tatMedian: number | null = null;

                        if (cardType === 'MISSED_INCOMING_CALLBACK') {
                          tatMean = agentTat?.overall_callback_turnaround?.mean ?? agentTat?.missed_to_connection?.mean ?? null;
                          tatMedian = agentTat?.overall_callback_turnaround?.median ?? agentTat?.missed_to_connection?.median ?? null;
                        } else if (cardType === 'OUTGOING_RECONNECTION') {
                          tatMean = agentTat?.failed_outgoing_to_connection?.mean ?? agentTat?.overall_connection_turnaround?.mean ?? null;
                          tatMedian = agentTat?.failed_outgoing_to_connection?.median ?? agentTat?.overall_connection_turnaround?.median ?? null;
                        } else {
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
                                <td className="py-3 px-3 text-center font-mono font-semibold text-emerald-700">
                                  {agent.incoming_returned_within_sla_count ?? agent.incoming_callback_met}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-amber-700">
                                  {agent.incoming_returned_outside_sla_count ?? 0}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-rose-600">
                                  {agent.incoming_not_returned_count ?? (agent.carried_over_incoming_count || 0)}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-700">
                                  {formatMinutes(tatMean)}
                                  {tatMedian !== null && (
                                    <span className="text-[10px] text-slate-400 block">
                                      Med: {formatMinutes(tatMedian)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-bold text-amber-700">
                                  {agentOpenCount}
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
                                <td className="py-3 px-3 text-center font-mono font-semibold text-amber-700">
                                  {Math.max(0, agent.calls_made - agent.calls_outgoing_connected)}
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
                                <td className="py-3 px-3 text-center font-mono font-bold text-amber-700">
                                  {agent.calls_not_picked}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-purple-700">
                                  {agent.sms_count}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-purple-700">
                                  {agent.sms_followup_met}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-semibold text-rose-600">
                                  {agent.carried_over_sms_count || 0}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-slate-700">
                                  {formatMinutes(tatMean)}
                                  {tatMedian !== null && (
                                    <span className="text-[10px] text-slate-400 block">
                                      Med: {formatMinutes(tatMedian)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-bold text-amber-700">
                                  {agentOpenCount}
                                </td>
                              </>
                            )}

                            <td className="py-3 px-4 text-right">
                              <button
                                id={`btn-inspect-agent-${agent.agent_id}`}
                                onClick={() => onInspectAgent(agent.agent_id)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg transition-colors"
                              >
                                <span>Audit Records</span>
                                <ExternalLink className="w-3 h-3 text-slate-500" />
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
                      <th className="py-3 px-3">Deadline</th>
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
                        } else if (obl.status === 'CARRIED_OVER') {
                          statusBadge = (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] bg-rose-50 text-rose-700 border border-rose-200">
                              <AlertOctagon className="w-3 h-3" />
                              CARRIED OVER
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
