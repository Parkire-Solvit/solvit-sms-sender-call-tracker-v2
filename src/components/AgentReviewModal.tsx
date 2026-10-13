import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  GitMerge,
  UserCheck,
  X,
  RefreshCw,
  CheckCircle2,
  Clock,
  PhoneCall,
  ChevronDown
} from 'lucide-react';
import { AgentNeedsReview } from '../types/callbacks';

interface AgentReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  allAgents: Array<{ id: number; name: string; tag?: string; archived_at?: any }>;
  availableTags?: string[];
}

export const AgentReviewModal: React.FC<AgentReviewModalProps> = ({
  isOpen,
  onClose,
  onUpdated,
  allAgents,
  availableTags = ['Callback Team', 'Customer Service', 'Valuation Officer', 'Telesales', 'Uncategorised'],
}) => {
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentNeedsReview[]>([]);
  const [actionInProgress, setActionInProgress] = useState<number | null>(null);
  const [mergeTargetMap, setMergeTargetMap] = useState<Record<number, string>>({});
  const [keepTagMap, setKeepTagMap] = useState<Record<number, string>>({});
  const [actionTypeMap, setActionTypeMap] = useState<Record<number, 'MERGE' | 'KEEP'>>({});
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchNeedsReviewAgents = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agents/needs-review');
      if (res.ok) {
        const data: AgentNeedsReview[] = await res.json();
        setAgents(data);
      } else {
        setAgents([]);
      }
    } catch (err) {
      console.error('Error fetching needs-review agents:', err);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setNotification(null);
      fetchNeedsReviewAgents();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validTargets = allAgents.filter(
    (a) => a.name.toLowerCase() !== 'unknown agent' && !a.archived_at
  );

  const handleMerge = async (sourceId: number) => {
    const targetIdStr = mergeTargetMap[sourceId];
    if (!targetIdStr) {
      setNotification({ type: 'error', message: 'Please select a target agent to merge into.' });
      return;
    }
    const targetId = Number(targetIdStr);
    if (!targetId || targetId === sourceId) {
      setNotification({ type: 'error', message: 'Invalid target agent.' });
      return;
    }

    setActionInProgress(sourceId);
    setNotification(null);

    try {
      const res = await fetch(`/api/agents/${sourceId}/merge-into/${targetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge agent');
      }

      setNotification({
        type: 'success',
        message: data.message || 'Agent successfully merged!',
      });
      await fetchNeedsReviewAgents();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error merging agent' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleKeepSeparate = async (agentId: number) => {
    const selectedTag = keepTagMap[agentId] || 'Callback Team';
    setActionInProgress(agentId);
    setNotification(null);

    try {
      const res = await fetch(`/api/agents/${agentId}/keep-separate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: selectedTag }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to keep agent separate');
      }

      setNotification({
        type: 'success',
        message: `Agent preserved with tag '${selectedTag}'. Needs review cleared.`,
      });
      await fetchNeedsReviewAgents();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error updating agent' });
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0 border border-amber-200">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                  Unrecognised Agent Names Review
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-mono">
                  {agents.length} pending
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Android app sent names that didn&apos;t match existing roster. Merge into existing agent or keep as separate.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            title="Close review modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications */}
        {notification && (
          <div
            className={`p-3 mx-4 mt-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
              notification.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
        )}

        {/* List Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-amber-500 animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-500">Checking unrecognised names...</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-sm font-black text-slate-800">All Agent Names Resolved</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                No unrecognised agent names currently need review. All incoming call activity is mapped to verified agents.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => {
                const currentAction = actionTypeMap[agent.id] || 'MERGE';
                const isWorking = actionInProgress === agent.id;

                return (
                  <div
                    key={agent.id}
                    className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 hover:border-slate-300 transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-900">{agent.name}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wide">
                            Needs Review
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
                          <span className="flex items-center gap-1 font-medium">
                            <PhoneCall className="w-3 h-3 text-slate-400" />
                            {agent.event_count} {agent.event_count === 1 ? 'event' : 'events'} logged
                          </span>
                          {agent.last_active_at && (
                            <span className="flex items-center gap-1 font-medium">
                              <Clock className="w-3 h-3 text-slate-400" />
                              Last seen: {new Date(agent.last_active_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action selector toggle */}
                      <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setActionTypeMap((prev) => ({ ...prev, [agent.id]: 'MERGE' }))}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                            currentAction === 'MERGE'
                              ? 'bg-slate-900 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Merge into...
                        </button>
                        <button
                          type="button"
                          onClick={() => setActionTypeMap((prev) => ({ ...prev, [agent.id]: 'KEEP' }))}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                            currentAction === 'KEEP'
                              ? 'bg-slate-900 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Keep separate
                        </button>
                      </div>
                    </div>

                    {/* Action Form */}
                    {currentAction === 'MERGE' ? (
                      <div className="p-3 bg-white rounded-xl border border-slate-200/80 flex flex-col sm:flex-row items-center gap-2">
                        <div className="flex-1 w-full relative">
                          <select
                            value={mergeTargetMap[agent.id] || ''}
                            onChange={(e) =>
                              setMergeTargetMap((prev) => ({ ...prev, [agent.id]: e.target.value }))
                            }
                            className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
                          >
                            <option value="">Select target agent to merge into...</option>
                            {validTargets
                              .filter((t) => t.id !== agent.id)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name} {t.tag ? `(${t.tag})` : ''}
                                </option>
                              ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          disabled={isWorking || !mergeTargetMap[agent.id]}
                          onClick={() => handleMerge(agent.id)}
                          className="w-full sm:w-auto px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          {isWorking ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <GitMerge className="w-3.5 h-3.5 text-amber-400" />
                          )}
                          <span>Merge &amp; Create Alias</span>
                        </button>
                      </div>
                    ) : (
                      <div className="p-3 bg-white rounded-xl border border-slate-200/80 flex flex-col sm:flex-row items-center gap-2">
                        <div className="flex-1 w-full">
                          <select
                            value={keepTagMap[agent.id] || agent.tag || 'Callback Team'}
                            onChange={(e) =>
                              setKeepTagMap((prev) => ({ ...prev, [agent.id]: e.target.value }))
                            }
                            className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
                          >
                            {availableTags.map((t) => (
                              <option key={t} value={t}>
                                Team Tag: {t}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          disabled={isWorking}
                          onClick={() => handleKeepSeparate(agent.id)}
                          className="w-full sm:w-auto px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          {isWorking ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" />
                          )}
                          <span>Keep As Separate Agent</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:px-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>
            {agents.length} unrecognised {agents.length === 1 ? 'agent' : 'agents'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
