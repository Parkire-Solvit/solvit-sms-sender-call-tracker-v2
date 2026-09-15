import React, { useState } from 'react';
import { 
  Users, 
  Tag as TagIcon, 
  Edit2, 
  CheckCircle2, 
  AlertTriangle, 
  AlertOctagon, 
  TrendingUp, 
  Phone, 
  MessageSquare,
  ChevronRight,
  Filter,
  Trash2,
  FileSpreadsheet,
  Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { AgentComplianceSummary, TagGroupCompliance, Obligation, TurnaroundTimeReport } from '../types/compliance';
import { AgentRecordsDrilldownModal } from './AgentRecordsDrilldownModal';

interface ComplianceAgentTableProps {
  agents: AgentComplianceSummary[];
  tagGroups?: TagGroupCompliance[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  onEditAgentTag: (agent: { id: number; name: string; tag: string }) => void;
  onInspectAgent: (agentId: number) => void;
  onDeleteAgent?: (agent: { id: number; name: string }) => void;
  onRemoveAgent?: (agent: { id: number; name: string }) => void;
  allObligations?: Obligation[];
  allEvents?: any[];
  turnaroundReport?: TurnaroundTimeReport;
  startDate?: string;
  endDate?: string;
  onInspectContact?: (phone: string) => void;
}

export const ComplianceAgentTable: React.FC<ComplianceAgentTableProps> = ({
  agents,
  tagGroups = [],
  selectedTag,
  onSelectTag,
  onEditAgentTag,
  onInspectAgent,
  onDeleteAgent,
  onRemoveAgent,
  allObligations = [],
  allEvents = [],
  turnaroundReport,
  startDate = '',
  endDate = '',
  onInspectContact,
}) => {
  const [drilldownAgent, setDrilldownAgent] = useState<AgentComplianceSummary | null>(null);
  const [drilldownStatusFilter, setDrilldownStatusFilter] = useState<string>('ALL');

  const availableTags = Array.from(new Set(agents.map(a => a.tag).filter(Boolean)));

  const filteredAgents = selectedTag
    ? agents.filter(a => a.tag === selectedTag)
    : agents;

  const handleOpenDrilldown = (ag: AgentComplianceSummary, initialStatus = 'ALL') => {
    setDrilldownAgent(ag);
    setDrilldownStatusFilter(initialStatus);
    onInspectAgent(ag.agent_id);
  };

  // Export the entire Agent Compliance & Operational Performance section to Excel
  const handleExportSectionExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Agent Scorecard
    const agentData = filteredAgents.map((a) => ({
      'Agent Name': a.agent_name,
      'Team Tag': a.tag || 'Uncategorised',
      'Phone Number': a.phone_number || '',
      'Missed': a.calls_missed,
      'Connected / Made': `${a.calls_outgoing_connected} / ${a.calls_made}`,
      'Returned Within SLA': a.incoming_returned_within_sla_count ?? 0,
      'Returned Outside SLA': a.incoming_returned_outside_sla_count ?? 0,
      'SMS Follow-Through': `${a.sms_followup_met} / ${a.sms_followup_total}`,
      'Not Returned': a.incoming_not_returned_count ?? 0,
    }));
    const wsAgents = XLSX.utils.json_to_sheet(agentData);
    XLSX.utils.book_append_sheet(wb, wsAgents, 'Agent Scorecard');

    // Sheet 2: Specific Obligation Records for relevant agents
    const relevantAgentIds = new Set(filteredAgents.map((a) => a.agent_id));
    const relevantObligations = allObligations.filter(
      (obl) =>
        (obl.originating_agent_id && relevantAgentIds.has(obl.originating_agent_id)) ||
        (obl.attributed_agent_id && relevantAgentIds.has(obl.attributed_agent_id))
    );

    const oblRows = relevantObligations.map((obl) => ({
      'Obligation ID': obl.id,
      'Agent Name': obl.originating_agent_name,
      'Team Tag': obl.originating_agent_tag,
      'Target Phone': obl.target_phone,
      'Obligation Type': obl.obligation_type,
      'Status': obl.status,
      'Trigger Time (Nairobi)': obl.trigger_local_timestamp || obl.trigger_timestamp,
      'Deadline (Nairobi)': obl.deadline_local_timestamp || obl.deadline_timestamp,
      'Resolution Time': obl.resolution_local_timestamp || 'Pending / Unresolved',
      'Resolving Agent': obl.resolving_agent_name || 'N/A',
      'Turnaround (Minutes)': obl.turnaround_minutes ?? 'N/A',
    }));
    const wsObl = XLSX.utils.json_to_sheet(oblRows);
    XLSX.utils.book_append_sheet(wb, wsObl, 'Obligation Records Audit');

    // Sheet 3: Team Tag Summaries
    if (tagGroups.length > 0) {
      const tagData = tagGroups.map((tg) => {
        const tagAgents = agents.filter((a) => (a.tag || 'Uncategorised') === tg.tag || a.tag === tg.tag);
        const callsMissed = tagAgents.reduce((sum, a) => sum + (a.calls_missed || 0), 0);
        const connected = tagAgents.reduce((sum, a) => sum + (a.calls_outgoing_connected || 0), 0);
        const dialled = tagAgents.reduce((sum, a) => sum + (a.calls_made || 0), 0);
        const withinSla = tagAgents.reduce((sum, a) => sum + (a.incoming_returned_within_sla_count || 0), 0);
        const outsideSla = tagAgents.reduce((sum, a) => sum + (a.incoming_returned_outside_sla_count || 0), 0);
        const notReturned = tagAgents.reduce((sum, a) => sum + (a.incoming_not_returned_count || 0), 0);
        const smsMet = tagAgents.reduce((sum, a) => sum + (a.sms_followup_met || 0), 0);
        const smsTotal = tagAgents.reduce((sum, a) => sum + (a.sms_followup_total || 0), 0);

        return {
          'Team Tag': tg.tag,
          'Agent Count': tg.agent_count,
          'Missed': callsMissed,
          'Connected / Made': `${connected} / ${dialled}`,
          'Returned Within SLA': withinSla,
          'Returned Outside SLA': outsideSla,
          'SMS Follow-Through': `${smsMet} / ${smsTotal}`,
          'Not Returned': notReturned,
        };
      });
      const wsTags = XLSX.utils.json_to_sheet(tagData);
      XLSX.utils.book_append_sheet(wb, wsTags, 'Team Tag Summaries');
    }

    const sDate = startDate || 'Report';
    const eDate = endDate || 'Latest';
    const tagSuffix = selectedTag ? `_${selectedTag.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
    const fileName = `Solvit_Agent_Compliance_Performance${tagSuffix}_${sDate}_to_${eDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div id="compliance-agent-table-section" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header & Tag Filters */}
      <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 font-bold shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Agent Compliance &amp; Operational Performance
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                  {filteredAgents.length} Agents
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Evaluates incoming callback SLA adherence, outgoing reconnection turnaround, and carried-over obligations.
              </p>
            </div>
          </div>

          {/* Export Button */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              id="btn-export-agent-compliance-excel"
              type="button"
              onClick={handleExportSectionExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
              title="Export Agent Scorecard and all specific obligation records to Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export to Excel</span>
            </button>
          </div>
        </div>

        {/* Tag Pills */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1 mr-1">
            <Filter className="w-3.5 h-3.5" />
            Filter by Team Tag:
          </span>
          <button
            id="filter-tag-all"
            onClick={() => onSelectTag('')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              !selectedTag
                ? 'bg-amber-600 text-white shadow-xs font-bold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Teams ({agents.length})
          </button>
          {availableTags.map((tag) => {
            const count = agents.filter(a => a.tag === tag).length;
            return (
              <button
                key={tag}
                id={`filter-tag-${tag}`}
                onClick={() => onSelectTag(tag === selectedTag ? '' : tag)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedTag === tag
                    ? 'bg-amber-600 text-white shadow-xs font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tag} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
            <tr>
              <th className="px-5 py-3">Agent Name</th>
              <th className="px-4 py-3">Team Tag</th>
              <th className="px-4 py-3 text-center">Missed</th>
              <th className="px-4 py-3 text-center">Connected / Made</th>
              <th className="px-4 py-3 text-center">Returned Within SLA</th>
              <th className="px-4 py-3 text-center">Returned Outside SLA</th>
              <th className="px-4 py-3 text-center">SMS Follow-Through</th>
              <th className="px-4 py-3 text-center">Not Returned</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAgents.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  No agents found for the selected team tag.
                </td>
              </tr>
            ) : (
              filteredAgents.map((ag) => (
                <tr
                  key={ag.agent_id}
                  id={`agent-row-${ag.agent_id}`}
                  className="hover:bg-slate-50/80 transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => handleOpenDrilldown(ag, 'ALL')}
                        className="font-bold text-slate-900 hover:text-amber-700 text-sm text-left hover:underline cursor-pointer flex items-center gap-1.5 group"
                        title={`Drill down into ${ag.agent_name}'s specific records`}
                      >
                        <span>{ag.agent_name}</span>
                        <Layers className="w-3 h-3 text-slate-400 group-hover:text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                      {ag.phone_number && ag.phone_number !== 'Simulated' && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {ag.phone_number}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3.5">
                    <button
                      id={`btn-edit-agent-tag-${ag.agent_id}`}
                      type="button"
                      onClick={() => onEditAgentTag({ id: ag.agent_id, name: ag.agent_name, tag: ag.tag })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 transition-colors border border-slate-200 cursor-pointer"
                      title="Click to edit or create a new team tag"
                    >
                      <TagIcon className="w-3 h-3 text-slate-400" />
                      {ag.tag || 'Untagged'}
                      <Edit2 className="w-2.5 h-2.5 ml-0.5 opacity-60" />
                    </button>
                  </td>

                  <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800 text-xs">
                    {ag.calls_missed}
                  </td>

                  <td className="px-4 py-3.5 text-center">
                    <div className="flex flex-col items-center font-mono">
                      <span className="font-bold text-slate-800 text-xs">
                        {ag.calls_outgoing_connected}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        of {ag.calls_made}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-center">
                    <div className="flex flex-col items-center font-mono">
                      <span className="font-bold text-slate-800 text-xs">
                        {ag.incoming_returned_within_sla_count ?? 0}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        of {ag.incoming_callback_total}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-center">
                    <div className="flex flex-col items-center font-mono">
                      <span className="font-bold text-slate-800 text-xs">
                        {ag.incoming_returned_outside_sla_count ?? 0}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        of {ag.incoming_callback_total}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-center">
                    <div className="flex flex-col items-center font-mono">
                      <span className="font-bold text-slate-800 text-xs">
                        {ag.sms_followup_met}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        of {ag.sms_followup_total}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-center">
                    <button
                      type="button"
                      onClick={() => handleOpenDrilldown(ag, 'CARRIED_OVER')}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold font-mono transition-transform hover:scale-105 cursor-pointer ${
                        (ag.incoming_not_returned_count || 0) > 0
                          ? 'bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 shadow-2xs'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                      title={`Click to drill down into not returned calls for ${ag.agent_name}`}
                    >
                      {ag.incoming_not_returned_count || 0}
                    </button>
                  </td>

                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        id={`btn-inspect-agent-${ag.agent_id}`}
                        type="button"
                        onClick={() => handleOpenDrilldown(ag, 'ALL')}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors border border-amber-200/80 shadow-2xs cursor-pointer"
                        title={`Drill down into ${ag.agent_name}'s specific records`}
                      >
                        <Layers className="w-3.5 h-3.5 text-amber-600" />
                        <span>Drill Down</span>
                        <ChevronRight className="w-3 h-3 text-amber-500" />
                      </button>
                      {(onDeleteAgent || onRemoveAgent) && (
                        <button
                          id={`btn-delete-agent-${ag.agent_id}`}
                          type="button"
                          onClick={() => (onDeleteAgent || onRemoveAgent)!({ id: ag.agent_id, name: ag.agent_name })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200/80 hover:border-rose-300 shadow-2xs cursor-pointer"
                          title={`Delete ${ag.agent_name} from agent list`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Agent Drill-down Records Modal */}
      {drilldownAgent && (
        <AgentRecordsDrilldownModal
          isOpen={!!drilldownAgent}
          onClose={() => setDrilldownAgent(null)}
          agent={drilldownAgent}
          allObligations={allObligations}
          allEvents={allEvents}
          turnaroundReport={turnaroundReport}
          startDate={startDate}
          endDate={endDate}
          initialStatusFilter={drilldownStatusFilter}
          onInspectContact={(phone) => {
            if (onInspectContact) {
              onInspectContact(phone);
            }
          }}
        />
      )}
    </div>
  );
};
