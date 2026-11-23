// Pending Approval: the three dialogs. Log outcome, compose an email (AM team or insurer), and mark document received.
import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  DOC_NEEDED, OUTCOMES, PARTIES, actionOf, buildAM, buildInsurer, buildReceived, buildSolver, esc, excelRows, fmtD, groupBy, nextStep, routeOf,
  solverEmailOf, solverOf, type ApprovalJob,
} from '../../../shared/pendingApproval';
import { api, blobToBase64, downloadBlob, XLSX_TYPE, type Shared } from './api';
import { Modal, Note, Pill, btn, btnOk, btnPrimary, field, label } from './ui';

const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------- Log outcome ---------- */

export function LogOutcomeModal({ job, shared, presetParty, onClose }: { job: ApprovalJob; shared: Shared; presetParty?: string; onClose: () => void }) {
  const { ctx, reload } = shared;
  const route = routeOf(job, ctx.dir);
  const sp = solverOf(ctx.solvers, job.solver);
  const brokerNext = nextStep(job, ctx.dir).t.startsWith('Call broker');
  const defaultParty = presetParty || (route === 'solver' ? (brokerNext ? 'Broker/Agent' : 'Solver') : route === 'ref' ? 'AM team' : 'Insurer');
  const [type, setType] = useState(route === 'solver' ? 'call' : 'update');
  const [party, setParty] = useState(defaultParty);
  const [outcome, setOutcome] = useState('has_docs');
  const [custom, setCustom] = useState('');
  const [cn, setCn] = useState('');
  const [cp, setCp] = useState('');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState(sp.phone || job.solver_phone || '');
  const [email, setEmail] = useState(sp.email || job.solver_email || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // One key per opened form: a retry of this same form is recognised by the server and saved once.
  const formKey = useRef(`pa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const save = async () => {
    if (outcome === 'custom' && !custom.trim()) { setError('Type the outcome, or pick one from the list.'); return; }
    setSaving(true); setError('');
    try {
      const solverChanged = route === 'solver' && (phone.trim() !== (sp.phone || '') || email.trim() !== (sp.email || ''));
      await api('POST', `/api/pending-approvals/jobs/${encodeURIComponent(job.id)}/attempts`, {
        type, party, outcome, outcome_text: custom.trim(), contact: `${cn} ${cp}`.trim(), note: note.trim(), client_request_id: formKey.current,
        ...(solverChanged ? { solver_phone: phone.trim(), solver_email: email.trim() } : {}),
      });
      await reload();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal title={`Log outcome: ${job.reg}`} onClose={onClose}
      sub={<>{job.policy_holder} · {job.insurer} · needs {DOC_NEEDED[job.reason] || job.reason}{job.comment ? ` (${job.comment})` : ''}</>}>
      {route === 'solver' && (
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>Solver phone ({job.solver})<input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" /></label>
          <label className={label}>Solver email<input className={field} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Type
          <select className={field} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="call">Call (new follow-up)</option>
            <option value="message">Text or WhatsApp (new follow-up)</option>
            <option value="email">Email sent by hand (new follow-up)</option>
            <option value="update">Outcome of an earlier call or email (not a new follow-up)</option>
          </select>
        </label>
        <label className={label}>Who
          <select className={field} value={party} onChange={(e) => setParty(e.target.value)}>{PARTIES.map((p) => <option key={p}>{p}</option>)}</select>
        </label>
      </div>
      <label className={label}>Outcome
        <select className={field} value={outcome} onChange={(e) => setOutcome(e.target.value)}>{OUTCOMES.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
      </label>
      {outcome === 'custom' && <label className={label}>Your outcome<input className={field} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Client says logbook is with the bank" /></label>}
      {outcome === 'gave_contact' && (
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>Broker/agent name<input className={field} value={cn} onChange={(e) => setCn(e.target.value)} /></label>
          <label className={label}>Broker/agent phone<input className={field} value={cp} onChange={(e) => setCp(e.target.value)} /></label>
        </div>
      )}
      <label className={label}>Note<textarea className={`${field} min-h-[70px]`} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <Note bad>{error}</Note>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save outcome'}</button>
      </div>
    </Modal>
  );
}

/* ---------- Compose an email ---------- */

function excelBlob(list: ApprovalJob[], kind: 'am' | 'ins'): Blob {
  const rowsOf = (l: ApprovalJob[]) => excelRows(l, kind);
  const sheet = (l: ApprovalJob[]) => {
    const rows = rowsOf(l);
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || {}).map((k) => ({ wch: /Policy|Comment|Insurance|Document/.test(k) ? 32 : /Reg|Date|ID|Attempts/.test(k) ? 14 : 22 }));
    return ws;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(list), 'All jobs');
  const by = groupBy(list, (j) => j.insurer || 'Unknown');
  const used = new Set(['All jobs']);
  Object.keys(by).sort().forEach((c) => {
    const base = c.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Sheet';
    let k = base, i = 2;
    while (used.has(k)) k = `${base} ${i++}`;
    used.add(k);
    XLSX.utils.book_append_sheet(wb, sheet(by[c]), k);
  });
  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: XLSX_TYPE });
}

export function ComposeModal({ kind, keyName, list, shared, onClose }: { kind: 'am' | 'ins'; keyName: string; list: ApprovalJob[]; shared: Shared; onClose: () => void }) {
  const { ctx, state, reload, toast } = shared;
  const [included, setIncluded] = useState<Set<string>>(() => new Set(list.filter((j) => actionOf(j) !== 'nonact').map((j) => j.id)));
  const chosen = useMemo(() => list.filter((j) => included.has(j.id)), [list, included]);
  const built = useMemo(() => (chosen.length ? (kind === 'am' ? buildAM(keyName, chosen, ctx) : buildInsurer(keyName, chosen, ctx)) : null), [chosen, kind, keyName, ctx]);
  const initial = useMemo(() => (list.length ? (kind === 'am' ? buildAM(keyName, list, ctx) : buildInsurer(keyName, list, ctx)) : null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [to, setTo] = useState((initial?.to || []).join(', '));
  const [cc, setCc] = useState((initial?.cc || []).join(', '));
  const [subjectEdited, setSubjectEdited] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const multi = chosen.length > 1;
  const fname = `Pending_approvals_${keyName.replace(/\W+/g, '_')}_${stamp()}.xlsx`;
  const attachLine = multi ? `<p><i>The full list is in the attached Excel file (${esc(fname)}).</i></p>` : '';
  const subject = subjectEdited ?? built?.subject ?? '';
  const addrs = (v: string) => v.split(/[,;\s]+/).filter(Boolean);
  const canSend = state.mail.can_send;

  const toggle = (id: string) => setIncluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const send = async () => {
    if (!built) return;
    setSending(true); setError('');
    try {
      const attachments = multi ? [{ name: fname, contentType: XLSX_TYPE, contentBytes: await blobToBase64(excelBlob(chosen, kind)) }] : [];
      const r = await api<{ ok: boolean; recorded: number; warning?: string }>('POST', '/api/pending-approvals/mail/send', {
        to: addrs(to), cc: addrs(cc), subject, html: built.html + attachLine, attachments,
        record: { kind, key: keyName, job_ids: chosen.map((j) => j.id) },
      });
      await reload();
      toast(r.warning || (multi ? `Email sent with Excel attached for ${chosen.length} job(s)` : 'Email sent'), !!r.warning);
      onClose();
    } catch (e) {
      setError(`Not sent: ${(e as Error).message}. Nothing was recorded.`);
      setSending(false);
    }
  };

  return (
    <Modal wide title={kind === 'am' ? `Email AM team: ${keyName}` : `Email insurer: ${keyName}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>To<input className={field} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className={label}>CC<input className={field} value={cc} onChange={(e) => setCc(e.target.value)} /></label>
      </div>
      <label className={label}>Subject<input className={field} value={subject} onChange={(e) => setSubjectEdited(e.target.value)} /></label>
      <div>
        <p className="text-[11px] text-slate-500 mb-1">Jobs included (untick to leave one out). The list is grouped by insurance company, in the email and in the Excel file.</p>
        <div className="max-h-40 overflow-y-auto space-y-1 border border-slate-100 rounded-xl p-2">
          {list.map((j) => (
            <label key={j.id} className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
              <input type="checkbox" checked={included.has(j.id)} onChange={() => toggle(j.id)} />
              <span>{j.reg} · {j.insurer} · {j.policy_holder} · {DOC_NEEDED[j.reason] || j.reason}{actionOf(j) === 'nonact' ? ' (non-actionable, left unticked)' : ''}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="border border-slate-200 rounded-xl p-3 text-xs max-h-64 overflow-auto bg-slate-50/50 text-slate-800 [&_p]:my-2 [&_table]:border-collapse [&_table]:my-1 [&_th]:border [&_th]:border-slate-300 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:bg-slate-100 [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1"
        dangerouslySetInnerHTML={{ __html: (built?.html || '<p>No jobs selected.</p>') + attachLine }} />
      <Note>{multi ? 'More than one job: the Excel list is attached automatically when you send.' : 'Single job: sent directly, no Excel needed.'}</Note>
      {!canSend && <Note bad>{state.mail.configured ? 'No sender mailbox is set for your login. Ask an administrator to set one in Import & Settings.' : 'Email is not configured on the server yet, so it cannot be sent from here. You can copy the text or download the Excel.'}</Note>}
      {canSend && !state.mail.verified && <Note>Email sending has not been verified for your mailbox yet, so this email may fail. If it does, ask an administrator to complete the email check in Import & Settings.</Note>}
      {error && <Note bad>{error}</Note>}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btn} onClick={async () => {
          const tmp = document.createElement('div'); tmp.innerHTML = (built?.html || '') + attachLine;
          try { await navigator.clipboard.writeText(tmp.innerText || tmp.textContent || ''); toast('Copied'); } catch { toast('Copy blocked here; select the preview text instead', true); }
        }}>Copy text</button>
        {multi && <button type="button" className={btn} onClick={() => { try { downloadBlob(fname, excelBlob(chosen, kind)); toast('Excel ready'); } catch (e) { toast(`Excel not saved: ${(e as Error).message}`, true); } }}>Download Excel only</button>}
        <button type="button" className={btnPrimary} disabled={sending || !chosen.length || !canSend} onClick={send}>
          {sending ? 'Sending…' : multi ? 'Send with Excel attached' : 'Send email'}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Document received ---------- */

export function ReceivedModal({ ids, shared, onClose, onDone }: { ids: string[]; shared: Shared; onClose: () => void; onDone: () => void }) {
  const { ctx, state, reload, toast } = shared;
  const list = ids.map((id) => state.jobs.find((j) => j.id === id)).filter((j): j is ApprovalJob => !!j && j.status === 'open');
  const byValuer = groupBy(list, (j) => j.allocated_to || 'Unallocated');
  const bySolver = groupBy(list, (j) => j.solver || 'Unknown solver');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canSend = state.mail.can_send;

  const go = async (sendEmail: boolean) => {
    setBusy(true); setError('');
    try {
      const r = await api<{ closed: number; solver_failures: string[] }>('POST', '/api/pending-approvals/jobs/received', { ids: list.map((j) => j.id), note, send_email: sendEmail });
      await reload();
      onDone();
      toast(r.solver_failures.length ? `Closed. Valuers emailed. Solver not notified: ${r.solver_failures.join('; ')}` : sendEmail ? 'Jobs closed; valuation team and solvers emailed' : `${r.closed} job(s) closed`, r.solver_failures.length > 0);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal wide title="Mark document received" onClose={onClose}
      sub={`${list.length} job(s) will be closed. The allocated valuation team member and the solver each get one email.`}>
      <div>
        <p className="text-[11px] font-bold text-slate-700 mb-1">Valuation team (valuations group in copy)</p>
        <ul className="text-[11px] text-slate-600 space-y-0.5 list-disc pl-4">
          {Object.keys(byValuer).map((n) => {
            const em = ctx.dir.val.find((p) => p.name.toLowerCase() === n.toLowerCase())?.email;
            return <li key={n}><b>{n}</b> → {em || `${ctx.dir.valGroup} (no personal address on file)`}: {byValuer[n].map((j) => j.reg).join(', ')}</li>;
          })}
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-700 mb-1">Solvers</p>
        <ul className="text-[11px] text-slate-600 space-y-0.5 list-disc pl-4">
          {Object.keys(bySolver).map((n) => {
            const em = solverEmailOf(ctx.solvers, bySolver[n][0]);
            return <li key={n}><b>{n}</b> → {em || <Pill tone="bad">no email on file, not notified</Pill>}: {bySolver[n].map((j) => j.reg).join(', ')}</li>;
          })}
        </ul>
      </div>
      <label className={label}>Note for the approver (optional, not sent to the solver)
        <textarea className={`${field} min-h-[60px]`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Logbook received by email from the insurer" />
      </label>
      {!canSend && <Note bad>{state.mail.configured ? 'No sender mailbox is set for your login, so emails cannot be sent. You can still close the jobs without email.' : 'Email is not configured on the server yet. You can still close the jobs without email; tell the valuer yourself.'}</Note>}
      {canSend && !state.mail.verified && <Note>Email sending has not been verified for your mailbox yet, so the emails may fail. If they do, nothing is closed; you can still close without email.</Note>}
      {error && <Note bad>{error}</Note>}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btn} disabled={busy || !list.length} onClick={() => go(false)}>Close without email</button>
        <button type="button" className={btnOk} disabled={busy || !list.length || !canSend} onClick={() => go(true)}>{busy ? 'Working…' : 'Close and email'}</button>
      </div>
    </Modal>
  );
}
