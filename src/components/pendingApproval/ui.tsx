// Pending Approval: small building blocks shared by its screens, in the portal's existing look.
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export const btn = 'px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
export const btnPrimary = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e02831] text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
export const btnOk = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
export const btnSm = '!px-2.5 !py-1 !text-[11px]';
export const field = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/30 focus:border-[#ff353e]/50';
export const label = 'flex flex-col gap-1 text-[11px] font-bold text-slate-600';
export const th = 'py-3 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap';

export type Tone = 'bad' | 'warn' | 'ok' | 'mute' | 'info';
const pillTone: Record<Tone, string> = {
  bad: 'bg-rose-50 text-rose-700 border-rose-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  mute: 'bg-slate-100 text-slate-600 border-slate-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
};
export const toneOf = (c: string): Tone => (c === 'p-bad' ? 'bad' : c === 'p-warn' ? 'warn' : c === 'p-ok' ? 'ok' : 'mute');

export function Pill({ tone = 'mute', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${pillTone[tone]}`}>{children}</span>;
}

export function Panel({ title, how, children, className = '', actions }: { title?: string; how?: React.ReactNode; children?: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <div className={`bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            {title && <h3 className="text-sm font-black text-slate-900">{title}</h3>}
            {how && <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{how}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Tile({ value, label: text, tone = 'border-slate-200/80 text-slate-800', sub }: { value: React.ReactNode; label: string; tone?: string; sub?: string }) {
  return (
    <div className={`p-4 rounded-2xl border bg-white ${tone}`}>
      <span className="text-2xl font-black block leading-tight">{value}</span>
      <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80 mt-1">{text}</span>
      {sub && <span className="text-[10px] font-semibold opacity-70 block mt-0.5">{sub}</span>}
    </div>
  );
}

export function Note({ bad, children }: { bad?: boolean; children: React.ReactNode }) {
  return <div className={`rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${bad ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>{children}</div>;
}

export function Modal({ title, sub, onClose, children, wide }: { title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900">{title}</h2>
            {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const srcTone: Record<string, string> = {
  solver: 'bg-sky-50 text-sky-800 border-sky-200',
  ref: 'bg-violet-50 text-violet-800 border-violet-200',
  cp: 'bg-teal-50 text-teal-800 border-teal-200',
  unresolved: 'bg-rose-50 text-rose-700 border-rose-200',
};
export function SourceBadge({ route, children }: { route: string; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border ${srcTone[route] || srcTone.unresolved}`}>{children}</span>;
}
