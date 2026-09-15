import React, { useState, useMemo } from 'react';
import {
  X,
  User,
  Tag as TagIcon,
  Phone,
  Calendar,
  Clock,
  CheckCircle2,
  AlertOctagon,
  AlertCircle,
  FileSpreadsheet,
  Search,
  Filter,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  PhoneIncoming,
  PhoneCall,
  MessageSquare,
  Layers,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  Obligation,
  AgentComplianceSummary,
  TurnaroundTimeReport,
  TurnaroundMetricsGroup
} from '../types/compliance';

export interface AgentRecordsDrilldownModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: AgentComplianceSummary | null;
  allObligations?: Obligation[];
  allEvents?: any[];
  turnaroundReport?: TurnaroundTimeReport;
  startDate: string;
  endDate: string;
  initialStatusFilter?: string;
  onInspectContact: (phone: string) => void;
}

export const AgentRecordsDrilldownModal: React.FC<AgentRecordsDrilldownModalProps> = ({
  isOpen,
  onClose,
  agent,
  allObligations = [],
  allEvents = [],
  turnaroundReport,
  startDate,
  endDate,
  initialStatusFilter = 'ALL',
  onInspectContact,
}) => {
  const [activeTab, setActiveTab] = useState<'obligations' | 'events'>('obligations');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 15;

  // Reset page when filters change
  const handleFilterChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    setCurrentPage(1);
  };

  // Turnaround metrics for this agent
  const agentTat = useMemo<TurnaroundMetricsGroup | undefined>(() => {
    if (!agent || !turnaroundReport?.by_agent) return undefined;
    return turnaroundReport.by_agent[agent.agent_id];
  }, [agent, turnaroundReport]);

  // Filter obligations associated with this agent
  const agentObligations = useMemo(() => {
    if (!agent) return [];
    return allObligations.filter((obl) => {
      // Match by originating agent ID or attributed agent ID, or fallback name matching
      const idMatch =
        obl.originating_agent_id === agent.agent_id ||
        obl.attributed_agent_id === agent.agent_id;
      if (idMatch) return true;
      if (obl.originating_agent_name && agent.agent_name) {
        return (
          obl.originating_agent_name.trim().toLowerCase() ===
          agent.agent_name.trim().toLowerCase()
        );
      }
      return false;
    });
  }, [agent, allObligations]);

  // Filter communication events for this agent
  const agentEvents = useMemo(() => {
    if (!agent) return [];
    return allEvents.filter((ev) => {
      const idMatch = ev.agent_id === agent.agent_id;
      if (idMatch) return true;
      if (ev.agent_name && agent.agent_name) {
        return (
          ev.agent_name.trim().toLowerCase() ===
          agent.agent_name.trim().toLowerCase()
        );
      }
      return false;
    });
  }, [agent, allEvents]);

  // Filtered obligations based on search and selected filters
  const filteredObligations = useMemo(() => {
    return agentObligations.filter((obl) => {
      // Status filter
      if (statusFilter !== 'ALL' && obl.status !== statusFilter) {
        return false;
      }
      // Type filter
      if (typeFilter !== 'ALL' && obl.obligation_type !== typeFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const phone = (obl.target_phone || '').toLowerCase();
        const id = (obl.id || '').toLowerCase();
        const resolvingAgent = (obl.resolving_agent_name || '').toLowerCase();
        if (!phone.includes(query) && !id.includes(query) && !resolvingAgent.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [agentObligations, statusFilter, typeFilter, searchQuery]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    return agentEvents.filter((ev) => {
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const phone = (ev.target_phone || '').toLowerCase();
        const type = (ev.type || '').toLowerCase();
        const status = (ev.status || '').toLowerCase();
        if (!phone.includes(query) && !type.includes(query) && !status.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [agentEvents, searchQuery]);

  // Pagination for obligations
  const totalPages = Math.max(1, Math.ceil(filteredObligations.length / pageSize));
  const paginatedObligations = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredObligations.slice(start, start + pageSize);
  }, [filteredObligations, currentPage]);

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

  const getObligationTypeLabel = (type: string) => {
    switch (type) {
      case 'MISSED_INCOMING_CALLBACK':
        return {
          name: 'Incoming Callback',
          sla: '30m SLA',
          icon: PhoneIncoming,
          badge: 'bg-rose-50 text-rose-700 border-rose-200',
        };
      case 'OUTGOING_RECONNECTION':
        return {
          name: 'Outgoing Reconnect',
          sla: '24h SLA',
          icon: PhoneCall,
          badge: 'bg-blue-50 text-blue-700 border-blue-200',
        };
      case 'SMS_FOLLOWUP':
        return {
          name: 'SMS Follow-up',
          sla: '30m SLA',
          icon: MessageSquare,
          badge: 'bg-purple-50 text-purple-700 border-purple-200',
        };
      default:
        return {
          name: type,
          sla: '',
          icon: Clock,
          badge: 'bg-slate-100 text-slate-700 border-slate-200',
        };
    }
  };

  const getStatusBadge = (status: string, remaining?: number) => {
    switch (status) {
      case 'MET':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Met
          </span>
        );
      case 'CARRIED_OVER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
            Carried Over
          </span>
        );
      case 'OPEN':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
            Open {remaining !== undefined ? `(${remaining}m left)` : ''}
          </span>
        );
    }
  };

  // Export this agent's specific records to Excel (.xlsx)
  const handleExportAgentExcel = () => {
    if (!agent) return;

    const wb = XLSX.utils.book_new();

    // Sheet 1: Specific Obligation Records
    const oblData = filteredObligations.map((obl) => {
      const typeInfo = getObligationTypeLabel(obl.obligation_type);
      return {
        'Obligation ID': obl.id,
        'Target Phone': obl.target_phone,
        'Obligation Type': typeInfo.name,
        'SLA Target': typeInfo.sla,
        'Status': obl.status,
        'Originating Agent': obl.originating_agent_name || agent.agent_name,
        'Department': obl.originating_agent_tag || agent.tag,
        'Trigger Time (Nairobi)': obl.trigger_local_timestamp || obl.trigger_timestamp,
        'SLA Deadline (Nairobi)': obl.deadline_local_timestamp || obl.deadline_timestamp,
        'Resolution Time': obl.resolution_local_timestamp || 'Pending / Unresolved',
        'Resolving Agent': obl.resolving_agent_name || 'N/A',
        'Turnaround (Minutes)': obl.turnaround_minutes ?? 'N/A',
        'SMS Follow-up Sent': obl.sms_sent ? 'Yes' : 'No',
      };
    });
    const wsObl = XLSX.utils.json_to_sheet(oblData);
    XLSX.utils.book_append_sheet(wb, wsObl, 'Obligations Audit');

    // Sheet 2: Agent Scorecard & Activity Summary
    const agentSummaryData = [
      {
        Metric: 'Agent Name',
        Value: agent.agent_name,
      },
      {
        Metric: 'Team / Department',
        Value: agent.tag || 'Uncategorised',
      },
      {
        Metric: 'Phone Number',
        Value: agent.phone_number || 'N/A',
      },
      {
        Metric: 'Evaluation Period',
        Value: `${startDate} to ${endDate}`,
      },
      {
        Metric: 'Combined Compliance %',
        Value:
          agent.combined_compliance_pct !== null && agent.combined_compliance_pct !== undefined
            ? `${agent.combined_compliance_pct.toFixed(1)}%`
            : 'N/A',
      },
      {
        Metric: 'Incoming Callback Met %',
        Value:
          agent.incoming_callback_compliance_pct !== null && agent.incoming_callback_compliance_pct !== undefined
            ? `${agent.incoming_callback_compliance_pct.toFixed(1)}% (${agent.incoming_callback_met}/${agent.incoming_callback_total})`
            : 'N/A',
      },
      {
        Metric: 'Outgoing Reconnect Met %',
        Value:
          agent.outgoing_reconnect_compliance_pct !== null && agent.outgoing_reconnect_compliance_pct !== undefined
            ? `${agent.outgoing_reconnect_compliance_pct.toFixed(1)}% (${agent.outgoing_reconnect_met}/${agent.outgoing_reconnect_total})`
            : 'N/A',
      },
      {
        Metric: 'SMS Follow-up Met %',
        Value:
          agent.sms_followup_compliance_pct !== null && agent.sms_followup_compliance_pct !== undefined
            ? `${agent.sms_followup_compliance_pct.toFixed(1)}% (${agent.sms_followup_met}/${agent.sms_followup_total})`
            : 'N/A',
      },
      {
        Metric: 'Open Obligations',
        Value: agent.open_obligations_count,
      },
      {
        Metric: 'Carried Over',
        Value: agent.carried_over_count,
      },
      {
        Metric: 'Total Calls Made',
        Value: agent.calls_made,
      },
      {
        Metric: 'Connected Outgoing Calls',
        Value: agent.calls_outgoing_connected,
      },
      {
        Metric: 'Incoming Calls Received',
        Value: agent.calls_incoming,
      },
      {
        Metric: 'Connected Incoming Calls',
        Value: agent.calls_incoming_connected,
      },
      {
        Metric: 'Missed Calls',
        Value: agent.calls_missed,
      },
      {
        Metric: 'Unanswered Outbound (Not Picked)',
        Value: agent.calls_not_picked,
      },
      {
        Metric: 'SMS Sent',
        Value: agent.sms_count,
      },
      {
        Metric: 'Median Incoming Callback Turnaround',
        Value: formatMinutes(agentTat?.missed_to_first_attempt?.median),
      },
      {
        Metric: 'Median Reconnect Turnaround',
        Value: formatMinutes(agentTat?.failed_outgoing_to_connection?.median),
      },
      {
        Metric: 'Median SMS Follow-up Turnaround',
        Value: formatMinutes(agentTat?.failed_outgoing_to_sms?.median),
      },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(agentSummaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Agent Summary');

    // Sheet 3: Communication Event Logs
    if (agentEvents.length > 0) {
      const eventsData = agentEvents.map((ev) => ({
        'Event ID': ev.id,
        'Time (Nairobi)': ev.local_timestamp || ev.timestamp,
        'Target Phone': ev.target_phone,
        'Type': ev.type,
        'Direction': ev.direction || 'N/A',
        'Call Status': ev.status || 'N/A',
        'Duration (sec)': ev.duration || 0,
        'Compliance Note': ev.compliance_note || 'N/A',
      }));
      const wsEvents = XLSX.utils.json_to_sheet(eventsData);
      XLSX.utils.book_append_sheet(wb, wsEvents, 'Communication Logs');
    }

    const sanitizedAgentName = agent.agent_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `Solvit_Agent_${sanitizedAgentName}_Records_${startDate}_to_${endDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  if (!isOpen || !agent) return null;

  const countMet = agentObligations.filter((o) => o.status === 'MET').length;
  const countCarriedOver = agentObligations.filter((o) => o.status === 'CARRIED_OVER').length;
  const countOpen = agentObligations.filter((o) => o.status === 'OPEN').length;

  return (
    <div
      id="agent-drilldown-modal-backdrop"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
    >
      <div
        id="agent-drilldown-modal-container"
        className="bg-white rounded-2xl max-w-6xl w-full max-h-[92vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 font-bold shadow-xs">
              <User className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900 leading-tight">
                  {agent.agent_name}
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                  <TagIcon className="w-3 h-3 text-slate-400" />
                  {agent.tag || 'Uncategorised'}
                </span>
                {agent.phone_number && (
                  <span className="text-xs font-mono text-slate-400">
                    {agent.phone_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                <span>Period: <strong className="text-slate-700">{startDate}</strong> to <strong className="text-slate-700">{endDate}</strong></span>
                <span>•</span>
                <span>Total Obligations: <strong className="text-slate-700">{agentObligations.length}</strong></span>
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              id="btn-modal-export-agent-excel"
              type="button"
              onClick={handleExportAgentExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all"
              title="Export this agent's specific obligation records to Excel"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export to Excel</span>
            </button>
            <button
              id="btn-close-agent-drilldown-modal"
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Executive KPI Scorecard Cards */}
        <div className="p-5 sm:p-6 bg-slate-50/60 border-b border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Combined Score */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Combined Score</span>
            <span className={`text-lg font-black mt-0.5 block ${
              (agent.combined_compliance_pct ?? 0) >= 90
                ? 'text-emerald-700'
                : (agent.combined_compliance_pct ?? 0) >= 75
                ? 'text-amber-700'
                : 'text-rose-700'
            }`}>
              {agent.combined_compliance_pct !== null && agent.combined_compliance_pct !== undefined
                ? `${agent.combined_compliance_pct.toFixed(1)}%`
                : 'N/A'}
            </span>
          </div>

          {/* Incoming Callback */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Incoming (30m)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-slate-800">
                {agent.incoming_callback_compliance_pct !== null && agent.incoming_callback_compliance_pct !== undefined
                  ? `${agent.incoming_callback_compliance_pct.toFixed(1)}%`
                  : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-400">
                ({agent.incoming_callback_met}/{agent.incoming_callback_total})
              </span>
            </div>
          </div>

          {/* Outgoing Reconnect */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Reconnect (24h)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-slate-800">
                {agent.outgoing_reconnect_compliance_pct !== null && agent.outgoing_reconnect_compliance_pct !== undefined
                  ? `${agent.outgoing_reconnect_compliance_pct.toFixed(1)}%`
                  : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-400">
                ({agent.outgoing_reconnect_met}/{agent.outgoing_reconnect_total})
              </span>
            </div>
          </div>

          {/* SMS Follow-up */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">SMS Follow-up</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-slate-800">
                {agent.sms_followup_compliance_pct !== null && agent.sms_followup_compliance_pct !== undefined
                  ? `${agent.sms_followup_compliance_pct.toFixed(1)}%`
                  : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-400">
                ({agent.sms_followup_met}/{agent.sms_followup_total})
              </span>
            </div>
          </div>

          {/* Open Obligations */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Open Obligations</span>
            <span className={`text-lg font-bold mt-0.5 block ${
              agent.open_obligations_count > 0 ? 'text-amber-700' : 'text-slate-600'
            }`}>
              {agent.open_obligations_count}
            </span>
          </div>

          {/* Carried Over */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Carried Over</span>
            <span className={`text-lg font-bold mt-0.5 block ${
              (agent.carried_over_count || 0) > 0 ? 'text-rose-700' : 'text-slate-600'
            }`}>
              {agent.carried_over_count || 0}
            </span>
          </div>
        </div>

        {/* Tab Selection & Filters Bar */}
        <div className="p-4 sm:px-6 bg-white border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Tabs */}
          <div className="flex items-center gap-2">
            <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
              <button
                id="btn-tab-obligations"
                type="button"
                onClick={() => setActiveTab('obligations')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'obligations'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Obligations Audit ({filteredObligations.length})</span>
              </button>
              <button
                id="btn-tab-events"
                type="button"
                onClick={() => setActiveTab('events')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'events'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Calls &amp; SMS Log ({filteredEvents.length})</span>
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="input-agent-drilldown-search"
                type="text"
                placeholder="Search phone number or contact..."
                value={searchQuery}
                onChange={(e) => handleFilterChange(setSearchQuery, e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Sub-Filters for Obligations */}
        {activeTab === 'obligations' && (
          <div className="px-5 py-2.5 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Status Filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 font-semibold mr-1">Status:</span>
              <button
                type="button"
                onClick={() => handleFilterChange(setStatusFilter, 'ALL')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  statusFilter === 'ALL'
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                All ({agentObligations.length})
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(setStatusFilter, 'CARRIED_OVER')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                  statusFilter === 'CARRIED_OVER'
                    ? 'bg-rose-600 text-white font-bold'
                    : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'
                }`}
              >
                <AlertOctagon className="w-3 h-3" />
                Carried Over ({countCarriedOver})
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(setStatusFilter, 'MET')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                  statusFilter === 'MET'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                Met ({countMet})
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(setStatusFilter, 'OPEN')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                  statusFilter === 'OPEN'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-white text-amber-800 border border-amber-200 hover:bg-amber-50'
                }`}
              >
                <Clock className="w-3 h-3" />
                Open ({countOpen})
              </button>
            </div>

            {/* Type Filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 font-semibold mr-1">Type:</span>
              <button
                type="button"
                onClick={() => handleFilterChange(setTypeFilter, 'ALL')}
                className={`px-2 py-0.5 rounded-md font-medium text-[11px] ${
                  typeFilter === 'ALL'
                    ? 'bg-amber-500 text-white font-bold'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                All Types
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(setTypeFilter, 'MISSED_INCOMING_CALLBACK')}
                className={`px-2 py-0.5 rounded-md font-medium text-[11px] ${
                  typeFilter === 'MISSED_INCOMING_CALLBACK'
                    ? 'bg-amber-500 text-white font-bold'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                Incoming Callback
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(setTypeFilter, 'OUTGOING_RECONNECTION')}
                className={`px-2 py-0.5 rounded-md font-medium text-[11px] ${
                  typeFilter === 'OUTGOING_RECONNECTION'
                    ? 'bg-amber-500 text-white font-bold'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                Outgoing Reconnect
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(setTypeFilter, 'SMS_FOLLOWUP')}
                className={`px-2 py-0.5 rounded-md font-medium text-[11px] ${
                  typeFilter === 'SMS_FOLLOWUP'
                    ? 'bg-amber-500 text-white font-bold'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                SMS Follow-up
              </button>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'obligations' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                  <tr>
                    <th className="px-5 py-3">Target Contact</th>
                    <th className="px-4 py-3">Obligation Type</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3">Trigger Time</th>
                    <th className="px-4 py-3">SLA Deadline</th>
                    <th className="px-4 py-3">Resolution &amp; Agent</th>
                    <th className="px-4 py-3 text-center">Turnaround</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedObligations.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-slate-400">
                        <div className="max-w-xs mx-auto text-center">
                          <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                          <p className="font-semibold text-slate-700">No obligation records found</p>
                          <p className="text-xs text-slate-400 mt-1">
                            No obligations match the current filters for {agent.agent_name}.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedObligations.map((obl) => {
                      const typeInfo = getObligationTypeLabel(obl.obligation_type);
                      const IconComponent = typeInfo.icon;
                      return (
                        <tr
                          key={obl.id}
                          id={`obl-row-${obl.id}`}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          {/* Target Contact */}
                          <td className="px-5 py-3.5">
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => onInspectContact(obl.target_phone)}
                                className="font-bold text-amber-700 hover:text-amber-800 hover:underline text-left font-mono text-xs flex items-center gap-1"
                                title="Inspect full communication history with this contact"
                              >
                                {obl.target_phone}
                                <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                              </button>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {obl.id}
                              </span>
                            </div>
                          </td>

                          {/* Obligation Type */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <IconComponent className="w-3.5 h-3.5 text-slate-500" />
                              <span className="font-semibold text-slate-800">
                                {typeInfo.name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                ({typeInfo.sla})
                              </span>
                            </div>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3.5 text-center">
                            {getStatusBadge(obl.status, obl.remaining_minutes)}
                          </td>

                          {/* Trigger Time */}
                          <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px]">
                            {obl.trigger_local_timestamp || obl.trigger_timestamp}
                          </td>

                          {/* SLA Deadline */}
                          <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px]">
                            {obl.deadline_local_timestamp || obl.deadline_timestamp}
                          </td>

                          {/* Resolution Details */}
                          <td className="px-4 py-3.5 text-slate-600 text-xs">
                            {obl.resolution_local_timestamp ? (
                              <div className="flex flex-col">
                                <span className="font-mono text-[11px] text-slate-700">
                                  {obl.resolution_local_timestamp}
                                </span>
                                {obl.resolving_agent_name && (
                                  <span className="text-[10px] text-slate-400">
                                    by {obl.resolving_agent_name}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">
                                Unresolved
                              </span>
                            )}
                          </td>

                          {/* Turnaround Time */}
                          <td className="px-4 py-3.5 text-center font-mono font-bold text-xs">
                            {obl.turnaround_minutes !== null && obl.turnaround_minutes !== undefined ? (
                              <span
                                className={
                                  obl.status === 'CARRIED_OVER'
                                    ? 'text-rose-700'
                                    : 'text-emerald-700'
                                }
                              >
                                {formatMinutes(obl.turnaround_minutes)}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-normal">Pending</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => onInspectContact(obl.target_phone)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors border border-slate-200 hover:border-amber-200"
                              title="Inspect Contact Thread"
                            >
                              <span>View Thread</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Communication Events Log */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                  <tr>
                    <th className="px-5 py-3">Timestamp (Nairobi)</th>
                    <th className="px-4 py-3">Target Phone</th>
                    <th className="px-4 py-3 text-center">Type</th>
                    <th className="px-4 py-3 text-center">Direction</th>
                    <th className="px-4 py-3 text-center">Outcome</th>
                    <th className="px-4 py-3 text-center">Duration</th>
                    <th className="px-4 py-3">Compliance Effect</th>
                    <th className="px-4 py-3 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEvents.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-slate-400">
                        <Phone className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-semibold text-slate-700">No events logged</p>
                        <p className="text-xs text-slate-400 mt-1">
                          No communication records match for {agent.agent_name}.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredEvents.slice(0, 100).map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3 font-mono text-[11px] text-slate-600">
                          {ev.local_timestamp || ev.timestamp}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-bold text-slate-900">
                          {ev.target_phone}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[10px] ${
                            ev.type === 'CALL' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                          }`}>
                            {ev.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-500 font-medium">
                          {ev.direction || 'OUTGOING'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[10px] ${
                            ev.status === 'CONNECTED'
                              ? 'bg-emerald-50 text-emerald-700'
                              : ev.status === 'MISSED'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {ev.status || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-slate-600">
                          {ev.duration ? `${ev.duration}s` : '0s'}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {ev.compliance_note || ev.compliance_effect || 'Standard activity'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => onInspectContact(ev.target_phone)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-amber-700 hover:underline"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer with Pagination */}
        {activeTab === 'obligations' && totalPages > 1 && (
          <div className="p-3 sm:px-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing {Math.min(filteredObligations.length, (currentPage - 1) * pageSize + 1)} to{' '}
              {Math.min(filteredObligations.length, currentPage * pageSize)} of{' '}
              {filteredObligations.length} records
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-semibold text-slate-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
