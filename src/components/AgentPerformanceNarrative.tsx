import React from 'react';
import { FileText, Users } from 'lucide-react';
import { AgentComplianceSummary, TurnaroundTimeReport } from '../types/compliance';
import { generateAgentNarrative, bandFor } from '../utils/agentNarrative';

export interface AgentPerformanceNarrativeProps {
  agents: AgentComplianceSummary[];
  turnaroundReport?: TurnaroundTimeReport;
}

export const AgentPerformanceNarrative: React.FC<AgentPerformanceNarrativeProps> = ({
  agents,
  turnaroundReport,
}) => {
  const csAgents = agents.filter(
    (a) => (a.tag || '').trim().toLowerCase() === 'customer service'
  );

  const sortedAgents = [...csAgents].sort((a, b) => {
    const aNoData =
      a.combined_compliance_pct === null ||
      a.combined_compliance_pct === undefined ||
      isNaN(a.combined_compliance_pct);
    const bNoData =
      b.combined_compliance_pct === null ||
      b.combined_compliance_pct === undefined ||
      isNaN(b.combined_compliance_pct);

    if (aNoData && bNoData) return a.agent_name.localeCompare(b.agent_name);
    if (aNoData) return 1;
    if (bNoData) return -1;
    return a.combined_compliance_pct! - b.combined_compliance_pct!;
  });

  const getTheme = (pct: number | null | undefined) => {
    const band = bandFor(pct);
    if (band === 'STRONG') {
      return {
        card: 'border-l-4 border-l-emerald-500 bg-emerald-50/25 border-slate-200',
        badge: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      };
    }
    if (band === 'NEEDS_WORK') {
      return {
        card: 'border-l-4 border-l-amber-500 bg-amber-50/25 border-slate-200',
        badge: 'text-amber-700 bg-amber-50 border-amber-200',
      };
    }
    if (band === 'CRITICAL') {
      return {
        card: 'border-l-4 border-l-rose-500 bg-rose-50/25 border-slate-200',
        badge: 'text-rose-700 bg-rose-50 border-rose-200',
      };
    }
    return {
      card: 'border-l-4 border-l-slate-400 bg-slate-50/40 border-slate-200',
      badge: 'text-slate-500 bg-slate-100 border-slate-200',
    };
  };

  return (
    <div id="agent-performance-narrative-section" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Section Header */}
      <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 font-bold shadow-xs">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Customer Service Performance Summary
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              A plain-language summary of each Customer Service agent&apos;s response performance for the selected period.
            </p>
          </div>
        </div>
      </div>

      {/* Cards Container */}
      <div className="p-6 space-y-4">
        {sortedAgents.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">
            <Users className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="font-semibold">No Customer Service agents found in this period.</p>
          </div>
        ) : (
          sortedAgents.map((agent) => {
            const tatGroup = turnaroundReport?.by_agent?.[agent.agent_id];
            const narrative = generateAgentNarrative(agent, tatGroup);
            const theme = getTheme(agent.combined_compliance_pct);
            const hasPct =
              agent.combined_compliance_pct !== null &&
              agent.combined_compliance_pct !== undefined &&
              !isNaN(agent.combined_compliance_pct);

            return (
              <div
                key={agent.agent_id}
                id={`card-narrative-agent-${agent.agent_id}`}
                className={`rounded-xl p-5 border shadow-2xs transition-all ${theme.card}`}
              >
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {agent.agent_name}
                  </h3>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-md font-mono font-bold text-xs border ${theme.badge}`}
                  >
                    {(agent.carried_over_count || 0) === 0 ? 'All Completed' : `${agent.carried_over_count} Carried Over`}
                  </span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed font-normal">
                  {narrative}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
