import React, { useEffect, useState } from 'react';
import { Activity, X } from 'lucide-react';
import type { UnmatchedActivity } from '../types/callbacks';

interface Props { isOpen: boolean; onClose: () => void; }

export const UnmatchedActivityModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [items, setItems] = useState<UnmatchedActivity[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    fetch(`/api/callback-jobs/unmatched-activity?days=${days}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load unmatched activity');
        setItems(body);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isOpen, days]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] overflow-hidden">
        <header className="p-5 border-b flex items-center justify-between gap-4">
          <div className="flex items-center gap-2"><Activity className="w-5 h-5 text-indigo-600" /><div><h2 className="font-black">Unmatched callback activity</h2><p className="text-xs text-slate-500">Outgoing calls and SMS that did not update the assigned callback record.</p></div></div>
          <div className="flex items-center gap-3"><select value={days} onChange={(e) => setDays(Number(e.target.value))} className="border rounded-lg px-2 py-1 text-sm"><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select><button onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button></div>
        </header>
        <div className="p-5 overflow-auto max-h-[68vh]">
          {loading && <p className="text-sm text-slate-500">Checking activity…</p>}
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          {!loading && !error && !items.length && <p className="text-center py-10 text-sm text-slate-500">No unmatched activity found.</p>}
          {!!items.length && <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500 border-b"><th className="p-2">Time</th><th className="p-2">Agent</th><th className="p-2">Activity</th><th className="p-2">Number / registration</th><th className="p-2">Reason</th><th className="p-2">Suggested record</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b"><td className="p-2 whitespace-nowrap">{new Date(item.timestamp).toLocaleString()}</td><td className="p-2 font-semibold">{item.agent_name}</td><td className="p-2">{item.type} {item.status || ''}</td><td className="p-2 font-mono">{item.target_phone}{item.reg_no ? ` / ${item.reg_no}` : ''}</td><td className="p-2">{item.reason.replaceAll('_', ' ')}</td><td className="p-2">{item.suggested_job ? `${item.suggested_job.vehicle_reg} — ${item.suggested_job.assigned_agent_name || 'Unassigned'}` : '—'}</td></tr>)}</tbody></table>}
        </div>
      </div>
    </div>
  );
};
