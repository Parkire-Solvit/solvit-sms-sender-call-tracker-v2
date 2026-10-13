import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { AgentNeedingReview } from '../types/callbacks';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  allAgents: Array<{ id: number; name: string; tag?: string }>;
  onChanged?: () => void;
}

export const AgentReviewModal: React.FC<Props> = ({ isOpen, onClose, allAgents, onChanged }) => {
  const [items, setItems] = useState<AgentNeedingReview[]>([]);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const response = await fetch('/api/agents/needs-review');
    if (!response.ok) throw new Error('Unable to load agents needing review');
    setItems(await response.json());
  };

  useEffect(() => {
    if (isOpen) load().catch((err) => setError(err.message));
  }, [isOpen]);

  if (!isOpen) return null;

  const act = async (agent: AgentNeedingReview, mode: 'keep' | 'merge') => {
    const targetId = targets[agent.id];
    if (mode === 'merge' && !targetId) return setError('Select the correct existing agent first.');
    setBusy(agent.id);
    setError('');
    try {
      const url = mode === 'keep'
        ? `/api/agents/${agent.id}/keep-separate`
        : `/api/agents/${agent.id}/merge-into/${targetId}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: mode === 'keep' ? JSON.stringify({ tag: 'Callback Team' }) : undefined,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Update failed');
      await load();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden">
        <header className="p-5 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <div><h2 className="font-black text-slate-900">Review new agent names</h2><p className="text-xs text-slate-500">Keep a real new agent or merge a spelling variation.</p></div>
          </div>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </header>
        <div className="p-5 overflow-y-auto max-h-[68vh] space-y-3">
          {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
          {!items.length && <div className="text-center text-sm text-slate-500 py-10">No agent names need review.</div>}
          {items.map((agent) => (
            <div key={agent.id} className="border rounded-xl p-4 grid gap-3 md:grid-cols-[1fr_1.5fr_auto] md:items-center">
              <div><div className="font-bold">{agent.name}</div><div className="text-xs text-slate-500">{agent.event_count} recorded event(s)</div></div>
              <select className="border rounded-lg px-3 py-2 text-sm" value={targets[agent.id] || ''} onChange={(e) => setTargets({ ...targets, [agent.id]: e.target.value })}>
                <option value="">Select existing agent to merge into</option>
                {allAgents.filter((a) => a.id !== agent.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <div className="flex gap-2">
                <button disabled={busy === agent.id} onClick={() => act(agent, 'keep')} className="px-3 py-2 border rounded-lg text-xs font-bold">Keep</button>
                <button disabled={busy === agent.id || !targets[agent.id]} onClick={() => act(agent, 'merge')} className="px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold disabled:opacity-40">Merge</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
