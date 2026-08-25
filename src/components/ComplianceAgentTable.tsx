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
  Filter
} from 'lucide-react';
import { AgentComplianceSummary, TagGroupCompliance } from '../types/compliance';

interface ComplianceAgentTableProps {
  agents: AgentComplianceSummary[];
  tagGroups?: TagGroupCompliance[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  onEditAgentTag: (agent: { id: number; name: string; tag: string }) => void;
  onInspectAgent: (agentId: number) => void;
}

export const ComplianceAgentTable: React.FC<ComplianceAgentTableProps> = ({
  agents,
  tagGroups = [],
  selectedTag,
  onSelectTag,
  onEditAgentTag,
  onInspectAgent,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'compliance' | 'activity'>('compliance');

  const formatPct = (pct: number | null) => {
    if (pct === null || isNaN(pct)) return <span className="text-slate-400 font-normal">N/A</span>;
    let color = 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (pct < 75) color = 'text-rose-700 bg-rose-50 border-rose-200';
    else if (pct < 90) color = 'text-amber-700 bg-amber-50 border-amber-200';

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs border ${color}`}>
        {pct.toFixed(1)}%
      </span>
    );
  };

  const availableTags = Array.from(new Set(agents.map(a => a.tag).filter(Boolean)));

  const filteredAgents = selectedTag
    ? agents.filter(a => a.tag === selectedTag)
    : agents;

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
                Evaluates incoming callback adherence, outgoing reconnection rates, and attributed SLA breaches.
              </p>
            </div>
          </div>

          {/* Toggle between Compliance View & Activity View */}
          <div className="flex items-center gap-3">
            <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
              <button
                id="btn-view-compliance-scores"
                onClick={() => setActiveSubTab('compliance')}
                className={`px-3.5 py-1.5 rounded-lg transition-all ${
                  activeSubTab === 'compliance'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Compliance Scorecard
              </button>
              <button
                id="btn-view-activity-counts"
                onClick={() => setActiveSubTab('activity')}
                className={`px-3.5 py-1.5 rounded-lg transition-all ${
                  activeSubTab === 'activity'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Raw Activity Counts
              </button>
            </div>
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

              {activeSubTab === 'compliance' ? (
                <>
                  <th className="px-4 py-3 text-center">Callback Met %</th>
                  <th className="px-4 py-3 text-center">Reconnect Met %</th>
                  <th className="px-4 py-3 text-center">SMS Follow-up %</th>
                  <th className="px-4 py-3 text-center">Combined Score</th>
                  <th className="px-4 py-3 text-center">Open Obligations</th>
                  <th className="px-4 py-3 text-center">Attributed Breaches</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-3 text-center">Calls Made</th>
                  <th className="px-4 py-3 text-center">Incoming</th>
                  <th className="px-4 py-3 text-center">Connected</th>
                  <th className="px-4 py-3 text-center">Not Picked</th>
                  <th className="px-4 py-3 text-center">Missed</th>
                  <th className="px-4 py-3 text-center">SMS Sent</th>
                </>
              )}

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
                      <span className="font-bold text-slate-900 text-sm">
                        {ag.agent_name}
                      </span>
                      {ag.phone_number && ag.phone_number !== 'Simulated' && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {ag.phone_number}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => onEditAgentTag({ id: ag.agent_id, name: ag.agent_name, tag: ag.tag })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 transition-colors border border-slate-200"
                    >
                      <TagIcon className="w-3 h-3 text-slate-400" />
                      {ag.tag || 'Untagged'}
                      <Edit2 className="w-2.5 h-2.5 ml-0.5 opacity-60" />
                    </button>
                  </td>

                  {activeSubTab === 'compliance' ? (
                    <>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex flex-col items-center">
                          {formatPct(ag.incoming_callback_compliance_pct)}
                          <span className="text-[10px] text-slate-400 mt-0.5">
                            {ag.incoming_callback_met}/{ag.incoming_callback_total}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <div className="flex flex-col items-center">
                          {formatPct(ag.outgoing_reconnect_compliance_pct)}
                          <span className="text-[10px] text-slate-400 mt-0.5">
                            {ag.outgoing_reconnect_met}/{ag.outgoing_reconnect_total}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <div className="flex flex-col items-center">
                          {formatPct(ag.sms_followup_compliance_pct)}
                          <span className="text-[10px] text-slate-400 mt-0.5">
                            {ag.sms_followup_met}/{ag.sms_followup_total}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <div className="flex flex-col items-center">
                          {formatPct(ag.combined_compliance_pct)}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold font-mono ${
                          ag.open_obligations_count > 0
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {ag.open_obligations_count}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold font-mono ${
                          ag.breaches_attributed_count > 0
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {ag.breaches_attributed_count}
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3.5 text-center font-mono font-semibold text-slate-700">
                        {ag.calls_made}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-semibold text-slate-700">
                        {ag.calls_incoming}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-bold text-emerald-600">
                        {ag.calls_connected}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-semibold text-slate-500">
                        {ag.calls_not_picked}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-bold text-rose-600">
                        {ag.calls_missed}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-bold text-purple-600">
                        {ag.sms_count}
                      </td>
                    </>
                  )}

                  <td className="px-4 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => onInspectAgent(ag.agent_id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                      Inspect
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
