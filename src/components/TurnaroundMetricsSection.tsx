import React, { useState } from 'react';
import { 
  Clock, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle, 
  AlertOctagon, 
  HelpCircle,
  Users,
  Tag as TagIcon,
  PhoneCall,
  MessageSquare
} from 'lucide-react';
import { 
  TurnaroundTimeReport, 
  MeanMedianMetric, 
  TurnaroundMetricsGroup 
} from '../types/compliance';

interface TurnaroundMetricsSectionProps {
  report: TurnaroundTimeReport;
  selectedTag?: string;
  selectedAgentId?: string;
}

export const TurnaroundMetricsSection: React.FC<TurnaroundMetricsSectionProps> = ({
  report,
}) => {
  const [viewMode, setViewMode] = useState<'company' | 'by_tag' | 'by_agent'>('company');
  const [activeTag, setActiveTag] = useState<string>('');
  const [activeAgentId, setActiveAgentId] = useState<string>('');

  const formatMinutes = (minutes: number | null) => {
    if (minutes === null || isNaN(minutes)) return 'N/A';
    if (minutes < 1) return '< 1 min';
    if (minutes >= 60) {
      const hrs = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return `${hrs}h ${mins}m`;
    }
    return `${Math.round(minutes)} min`;
  };

  const getStatusBadge = (status: MeanMedianMetric['status']) => {
    switch (status) {
      case 'OPTIMAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Optimal (&le; 50%)
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            Warning (50-100%)
          </span>
        );
      case 'BREACHED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertOctagon className="w-3 h-3 text-rose-600" />
            Breached (&gt; 100%)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
            <HelpCircle className="w-3 h-3 text-slate-400" />
            No Data
          </span>
        );
    }
  };

  // Determine current active metric group based on viewMode
  let currentMetrics: TurnaroundMetricsGroup = report.company_wide;
  let contextTitle = 'Company-Wide Turnaround Overview';

  const tags = Object.keys(report.by_tag || {});
  const agents = Object.entries(report.by_agent || {}) as [string, TurnaroundMetricsGroup & { agent_name: string; tag: string }][];

  if (viewMode === 'by_tag') {
    const targetTag = activeTag || tags[0] || '';
    if (targetTag && report.by_tag[targetTag]) {
      currentMetrics = report.by_tag[targetTag];
      contextTitle = `Tag Group: ${targetTag} (${report.by_tag[targetTag].agent_count} agents)`;
    }
  } else if (viewMode === 'by_agent') {
    const targetId = activeAgentId || (agents[0] ? agents[0][0] : '');
    if (targetId && report.by_agent[Number(targetId)]) {
      currentMetrics = report.by_agent[Number(targetId)];
      contextTitle = `Agent: ${report.by_agent[Number(targetId)].agent_name} [${report.by_agent[Number(targetId)].tag}]`;
    }
  }

  const metricCards = [
    {
      id: 'metric-overall-callback',
      title: 'Overall Callback TAT (All Missed Calls)',
      desc: 'Combined average speed to call back missed incoming & unanswered outgoing calls',
      data: currentMetrics.overall_callback_turnaround || currentMetrics.missed_to_first_attempt,
      icon: Clock,
      iconColor: 'text-[#ff353e] bg-[#ff353e]/10',
    },
    {
      id: 'metric-missed-first-attempt',
      title: 'Missed Incoming &rarr; 1st Callback Attempt',
      desc: 'Speed to first attempted callback return on incoming missed calls',
      data: currentMetrics.missed_to_first_attempt,
      icon: PhoneCall,
      iconColor: 'text-blue-600 bg-blue-50',
    },
    {
      id: 'metric-missed-connection',
      title: 'Missed Incoming &rarr; Connected Call',
      desc: 'Total elapsed time until successful client connection',
      data: currentMetrics.missed_to_connection,
      icon: CheckCircle2,
      iconColor: 'text-emerald-600 bg-emerald-50',
    },
    {
      id: 'metric-failed-next-attempt',
      title: 'Unconnected Outgoing &rarr; Next Attempt',
      desc: 'Time before second outgoing attempt was made',
      data: currentMetrics.failed_outgoing_to_next_attempt,
      icon: TrendingUp,
      iconColor: 'text-indigo-600 bg-indigo-50',
    },
    {
      id: 'metric-failed-reconnect',
      title: 'Unconnected Outgoing &rarr; Reconnection',
      desc: 'Total time to successfully reconnect customer',
      data: currentMetrics.failed_outgoing_to_connection,
      icon: PhoneCall,
      iconColor: 'text-amber-600 bg-amber-50',
    },
    {
      id: 'metric-failed-sms',
      title: 'Unconnected Outgoing &rarr; SMS Sent',
      desc: 'Speed of sending SMS follow-up after call failed',
      data: currentMetrics.failed_outgoing_to_sms,
      icon: MessageSquare,
      iconColor: 'text-purple-600 bg-purple-50',
    },
  ];

  return (
    <div id="turnaround-metrics-section" className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-50 text-amber-700 font-bold">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Response Turnaround Time Metrics (Mean &amp; Median)
              </h2>
              <p className="text-xs text-slate-500">
                Measures actual response speeds evaluated against active Master Settings thresholds.
              </p>
            </div>
          </div>
        </div>

        {/* View Switchers */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              id="btn-turnaround-company"
              onClick={() => setViewMode('company')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'company'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Company-Wide
            </button>
            <button
              id="btn-turnaround-by-tag"
              onClick={() => {
                setViewMode('by_tag');
                if (!activeTag && tags.length > 0) setActiveTag(tags[0]);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'by_tag'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              By Tag Group
            </button>
            <button
              id="btn-turnaround-by-agent"
              onClick={() => {
                setViewMode('by_agent');
                if (!activeAgentId && agents.length > 0) setActiveAgentId(agents[0][0]);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'by_agent'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              By Agent
            </button>
          </div>

          {/* Sub-selector for Tag */}
          {viewMode === 'by_tag' && tags.length > 0 && (
            <select
              id="select-turnaround-tag"
              value={activeTag || tags[0]}
              onChange={(e) => setActiveTag(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none shadow-xs"
            >
              {tags.map((t) => (
                <option key={t} value={t}>
                  Tag: {t}
                </option>
              ))}
            </select>
          )}

          {/* Sub-selector for Agent */}
          {viewMode === 'by_agent' && agents.length > 0 && (
            <select
              id="select-turnaround-agent"
              value={activeAgentId || (agents[0] ? agents[0][0] : '')}
              onChange={(e) => setActiveAgentId(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none shadow-xs"
            >
              {agents.map(([id, ag]) => (
                <option key={id} value={id}>
                  {ag.agent_name} ({ag.tag})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span className="font-semibold text-slate-700">{contextTitle}</span>
        <span className="text-[11px] text-slate-400">
          Threshold rule status: &le; 50% optimal (green), 50-100% warning (amber), &gt; 100% breached (red)
        </span>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              id={card.id}
              className="p-4 rounded-xl border border-slate-200 bg-slate-50/40 hover:bg-white hover:border-slate-300 hover:shadow-sm transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className={`p-2 rounded-lg ${card.iconColor}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  {getStatusBadge(card.data.status)}
                </div>

                <h3 className="text-xs font-bold text-slate-800 leading-snug">
                  {card.title}
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">
                  {card.desc}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200/60 grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block">
                    Mean (Avg)
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-900">
                    {formatMinutes(card.data.mean)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block">
                    Median
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-900">
                    {formatMinutes(card.data.median)}
                  </span>
                </div>
                <div className="col-span-2 flex items-center justify-between text-[10px] text-slate-400 mt-1 font-medium">
                  <span>Samples: {card.data.count}</span>
                  <span>Limit: {formatMinutes(card.data.threshold)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
