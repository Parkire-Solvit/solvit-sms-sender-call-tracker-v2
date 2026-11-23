// Pending Approval: Import & Settings, and the email log.
import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload } from 'lucide-react';
import { fmtDT, okMail, parseSolverSheet, parseTeamRows, type ApprovalDirectory, type ApprovalPerson } from '../../../shared/pendingApproval';
import { api, type AdminSettings, type ApprovalEmailRow, type Shared } from './api';
import { Note, Panel, Pill, btn, btnOk, btnPrimary, btnSm, field, label, th } from './ui';

/* ---------- Email log ---------- */

const KIND_LABEL: Record<string, string> = { am: 'AM team', ins: 'Insurer', received: 'Received (valuer)', solver: 'Received (solver)' };

export function EmailLog({ revision }: { revision: string }) {
  const [rows, setRows] = useState<ApprovalEmailRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api<ApprovalEmailRow[]>('GET', '/api/pending-approvals/emails').then((r) => { if (live) { setRows(r); setError(''); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [revision]);
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-x-auto">
      {error && <div className="p-3"><Note bad>{error}</Note></div>}
      <table className="w-full text-left border-collapse text-xs min-w-[800px]">
        <thead><tr className="bg-slate-50 border-b border-slate-200/80"><th className={th}>When</th><th className={th}>By</th><th className={th}>Type</th><th className={th}>To</th><th className={th}>CC</th><th className={th}>Subject</th><th className={`${th} text-right`}>Jobs</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {(rows || []).map((e) => (
            <tr key={e.id}><td className="py-2.5 px-3 whitespace-nowrap">{fmtDT(e.at)}</td><td className="py-2.5 px-3">{e.by}</td><td className="py-2.5 px-3">{KIND_LABEL[e.kind] || e.kind}</td><td className="py-2.5 px-3">{e.to.join(', ')}</td><td className="py-2.5 px-3">{e.cc.join(', ')}</td><td className="py-2.5 px-3">{e.subject}</td><td className="py-2.5 px-3 text-right">{e.jobs.length}</td></tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={7} className="py-4 px-3 text-slate-500">No emails sent from this system yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Import ---------- */

interface ImportResult {
  import_id: number; added: number; refreshed: number; skipped_test: number; skipped_invalid: Array<{ id: string; why: string }>;
  already_closed_in_file: number; open_after: number; missing: Array<{ id: string; reg: string }>;
}

function ImportPanel({ shared }: { shared: Shared }) {
  const { reload, toast } = shared;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setError(''); setResult(null); setClosed(null);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const r = await api<ImportResult>('POST', '/api/pending-approvals/import', { file_name: f.name, rows });
      setResult(r);
      await reload();
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`);
    } finally { setBusy(false); }
  };

  const closeMissing = async () => {
    if (!result) return;
    setClosing(true);
    try {
      const r = await api<{ closed: number }>('POST', `/api/pending-approvals/import/${result.import_id}/close-missing`, {});
      setClosed(r.closed);
      await reload();
    } catch (err) { toast((err as Error).message, true); } finally { setClosing(false); }
  };

  const m = result?.missing.length || 0;
  return (
    <Panel title="Import a new pending-jobs export" how="Upload the Excel export (same columns as the sample). New jobs are added; existing jobs keep their attempts and status and only refresh their details. Solver_Email (and Solver_Contact or Solver_Phone, if present) update the solver contacts below. Test rows are skipped. Open jobs that are missing from the file are treated as approved: you will see how many and confirm before they are closed.">
      <label className={`${btnPrimary} w-fit`}><Upload className="w-3.5 h-3.5" />{busy ? 'Reading…' : 'Choose export file'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} disabled={busy} /></label>
      {error && <div className="mt-2"><Note bad>{error}</Note></div>}
      {result && (
        <div className="mt-3 space-y-2 text-[11px] text-slate-700">
          <p>Done: <b>{result.added}</b> added, <b>{result.refreshed}</b> refreshed, <b>{result.skipped_test}</b> test rows skipped{result.skipped_invalid.length ? `, ${result.skipped_invalid.length} row(s) skipped for a missing or invalid valuation date (${result.skipped_invalid.slice(0, 5).map((s) => s.id).join(', ')}${result.skipped_invalid.length > 5 ? '…' : ''})` : ''}.</p>
          {result.already_closed_in_file > 0 && <Note>{result.already_closed_in_file} job(s) in this file were already closed here. They stay closed. If one is still waiting for approval, tell an administrator.</Note>}
          {closed !== null ? <Pill tone="ok">{closed} job(s) closed as approved</Pill> : m > 0 ? (
            <Note>
              {m} open job(s) are not in this file, so they have been approved. {m * 2 > result.open_after && <b>That is more than half of the open jobs. Check you uploaded the full export before closing. </b>}
              <button type="button" className={`${btnOk} ${btnSm} ml-1`} disabled={closing} onClick={closeMissing}>{closing ? 'Closing…' : `Close ${m} as approved`}</button>
              <div className="text-[10px] text-slate-500 mt-1">{result.missing.slice(0, 10).map((j) => j.reg).join(', ')}{m > 10 ? '…' : ''}</div>
            </Note>
          ) : <p className="text-slate-500">Every open job is still in this file, so none were closed.</p>}
        </div>
      )}
    </Panel>
  );
}

/* ---------- Team emails ---------- */

function TeamPanel({ shared }: { shared: Shared }) {
  const { state, reload } = shared;
  const [draft, setDraft] = useState<ApprovalDirectory>(state.directory);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const serverKey = JSON.stringify(state.directory);
  useEffect(() => { if (!dirty) setDraft(state.directory); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (fn: (d: ApprovalDirectory) => void) => { setDirty(true); setDraft((d) => { const n = JSON.parse(JSON.stringify(d)) as ApprovalDirectory; fn(n); return n; }); };

  const save = async (d: ApprovalDirectory = draft) => {
    if ([...d.am, ...d.val].some((p) => !p.name || !okMail(p.email)) || !okMail(d.valGroup) || !okMail(d.csGroup)) {
      setMsg({ bad: true, text: 'Every person needs a name and a valid email, and both group addresses must be valid.' });
      return false;
    }
    try { await api('PUT', '/api/pending-approvals/directory', d); setDirty(false); await reload(); setMsg({ bad: false, text: 'Saved' }); return true; }
    catch (e) { setMsg({ bad: true, text: (e as Error).message }); return false; }
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const parsed = parseTeamRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
      const n = parsed.am.length + parsed.val.length;
      if (!n) { setMsg({ bad: true, text: 'No usable rows. The file needs columns Name, Email and Team (AM or Valuation).' }); return; }
      const next: ApprovalDirectory = JSON.parse(JSON.stringify(draft));
      for (const k of ['am', 'val'] as const) for (const p of parsed[k]) {
        const ex = next[k].find((x) => x.name.toLowerCase() === p.name.toLowerCase());
        if (ex) ex.email = p.email; else next[k].push(p);
      }
      setDraft(next);
      if (await save(next)) setMsg({ bad: false, text: `${n} contact(s) saved${parsed.bad ? `, ${parsed.bad} row(s) skipped (missing name, valid email or team)` : ''}` });
    } catch (err) { setMsg({ bad: true, text: `Upload failed: ${(err as Error).message}` }); }
  };

  const list = (k: 'am' | 'val', title: string) => (
    <div>
      <h4 className="text-xs font-black text-slate-800 mb-2">{title}</h4>
      <div className="space-y-1.5">
        {draft[k].map((p: ApprovalPerson, i: number) => (
          <div key={i} className="flex gap-1.5">
            <input className={field} value={p.name} placeholder="Name" aria-label={`${title} name`} onChange={(e) => change((d) => { d[k][i].name = e.target.value; })} />
            <input className={field} value={p.email} placeholder="name@solvit.co.ke" aria-label={`${title} email`} onChange={(e) => change((d) => { d[k][i].email = e.target.value.trim(); })} />
            <button type="button" className={`${btn} ${btnSm}`} onClick={() => change((d) => { d[k].splice(i, 1); })}>Remove</button>
          </div>
        ))}
      </div>
      <button type="button" className={`${btn} ${btnSm} mt-2`} onClick={() => change((d) => { d[k].push({ name: '', email: '' }); })}>Add person</button>
    </div>
  );

  return (
    <Panel title="Team emails" how="Used for AM emails and for “Document received” emails. Edit a name or address, add or remove people, or upload an Excel/CSV with the columns Name, Email, Team (AM or Valuation). Names must match the Initiated_by and Allocated_to names in the pending jobs sheet.">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {list('am', 'AM team')}
        {list('val', 'Valuation team')}
        <div className="space-y-2">
          <h4 className="text-xs font-black text-slate-800">Group addresses</h4>
          <label className={label}>Valuation group (copied on received emails)<input className={field} value={draft.valGroup} onChange={(e) => change((d) => { d.valGroup = e.target.value.trim(); })} /></label>
          <label className={label}>CS team group (copied on AM and insurer emails)<input className={field} value={draft.csGroup} onChange={(e) => change((d) => { d.csGroup = e.target.value.trim(); })} /></label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <label className={btn}><Upload className="w-3.5 h-3.5" />Upload team list<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={upload} /></label>
        <button type="button" className={btnPrimary} onClick={() => save()}>Save team emails</button>
        {dirty && <Pill tone="warn">Unsaved changes</Pill>}
        {msg && (msg.bad ? <Note bad>{msg.text}</Note> : <Pill tone="ok">{msg.text}</Pill>)}
      </div>
    </Panel>
  );
}

/* ---------- Solver contacts ---------- */

function SolversPanel({ shared }: { shared: Shared }) {
  const { state, reload } = shared;
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [nn, setNn] = useState(''); const [np, setNp] = useState(''); const [ne, setNe] = useState('');
  const all = state.solvers;
  const f = q.toLowerCase();
  const rows = useMemo(() => all.filter((s) => !f || [s.name, s.region, s.location, s.phone, s.email].join(' ').toLowerCase().includes(f)), [all, f]);

  const saveCell = async (name: string, field_: 'phone' | 'email', value: string, current: string) => {
    const v = value.trim();
    if (v === current) return;
    if (field_ === 'email' && v && !okMail(v)) { setMsg({ bad: true, text: 'Not a valid email' }); return; }
    try { await api('PUT', '/api/pending-approvals/solvers/contact', { name, field: field_, value: v }); await reload(); setMsg({ bad: false, text: 'Saved' }); } catch (e) { setMsg({ bad: true, text: (e as Error).message }); }
  };
  const add = async () => {
    if (!nn.trim()) { setMsg({ bad: true, text: 'Enter a name' }); return; }
    if (ne.trim() && !okMail(ne.trim())) { setMsg({ bad: true, text: 'Not a valid email' }); return; }
    try { await api('POST', '/api/pending-approvals/solvers', { items: [{ name: nn.trim(), phone: np, email: ne.trim() }] }); setNn(''); setNp(''); setNe(''); await reload(); setMsg({ bad: false, text: 'Saved' }); } catch (e) { setMsg({ bad: true, text: (e as Error).message }); }
  };
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg({ bad: false, text: 'Reading…' });
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const items = parseSolverSheet(XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }));
      if (!items.length) { setMsg({ bad: true, text: 'No solvers found. Use the regional list, or columns Name, Phone, Email.' }); return; }
      let saved = 0;
      for (let i = 0; i < items.length; i += 500) { saved += (await api<{ saved: number }>('POST', '/api/pending-approvals/solvers', { items: items.slice(i, i + 500) })).saved; }
      await reload();
      setMsg({ bad: false, text: `${saved} solver(s) saved` });
    } catch (err) { setMsg({ bad: true, text: `Upload failed: ${(err as Error).message}` }); }
  };

  return (
    <Panel title="Solver contacts" how={`${all.length} solvers, ${all.filter((s) => !s.email).length} without an email. Edit a phone or email to save it. Upload the regional contact list, or a pending-jobs export with Solver_Name and Solver_Email columns, to add or update contacts. Blank cells in an upload never erase saved contacts.`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input type="search" className={`${field} !w-64`} placeholder="Search solvers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search solvers" />
        <label className={btn}><Upload className="w-3.5 h-3.5" />Upload solver contacts<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={upload} /></label>
        {msg && (msg.bad ? <Note bad>{msg.text}</Note> : <Pill tone="ok">{msg.text}</Pill>)}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <input className={`${field} !w-48`} placeholder="New solver name" aria-label="New solver name" value={nn} onChange={(e) => setNn(e.target.value)} />
        <input className={`${field} !w-36`} placeholder="Phone" aria-label="New solver phone" value={np} onChange={(e) => setNp(e.target.value)} />
        <input className={`${field} !w-56`} placeholder="Email" aria-label="New solver email" value={ne} onChange={(e) => setNe(e.target.value)} />
        <button type="button" className={btnPrimary} onClick={add}>Add solver</button>
      </div>
      <div className="max-h-[420px] overflow-auto border border-slate-100 rounded-xl">
        <table className="w-full text-left border-collapse text-xs min-w-[680px]">
          <thead className="sticky top-0"><tr className="bg-slate-50 border-b border-slate-200/80"><th className={th}>Name</th><th className={th}>Region</th><th className={th}>Location</th><th className={th}>Phone</th><th className={th}>Email</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.name}>
                <td className="py-1.5 px-3 font-semibold">{s.name}</td><td className="py-1.5 px-3">{s.region}</td><td className="py-1.5 px-3">{s.location}</td>
                <td className="py-1.5 px-3"><input className={field} key={`p${s.phone}`} defaultValue={s.phone} aria-label={`Phone for ${s.name}`} onBlur={(e) => saveCell(s.name, 'phone', e.target.value, s.phone)} /></td>
                <td className="py-1.5 px-3"><input className={field} key={`e${s.email}`} defaultValue={s.email} aria-label={`Email for ${s.name}`} onBlur={(e) => saveCell(s.name, 'email', e.target.value, s.email)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------- Access and email sending (administrators) ---------- */

function AdminPanel() {
  const [s, setS] = useState<AdminSettings | null>(null);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  useEffect(() => { api<AdminSettings>('GET', '/api/pending-approvals/admin-settings').then(setS).catch((e) => setMsg({ bad: true, text: e.message })); }, []);
  if (!s) return msg ? <Note bad>{msg.text}</Note> : null;
  const set = (patch: Partial<AdminSettings>) => setS({ ...s, ...patch });
  const save = async () => {
    try {
      const r = await api<AdminSettings>('PUT', '/api/pending-approvals/admin-settings', { team_tag: s.team_tag, default_sender_mailbox: s.default_sender_mailbox, senders: s.senders });
      setS(r); setMsg({ bad: false, text: 'Saved' });
    } catch (e) { setMsg({ bad: true, text: (e as Error).message }); }
  };
  return (
    <Panel title="Access and email sending (administrators only)" how="Agents whose agent tag matches the team tag below open Pending Approval. Emails are sent from the signed-in person's own mailbox if you list one here, otherwise from the default mailbox.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        <label className={label}>Approvals team tag<input className={field} value={s.team_tag} onChange={(e) => set({ team_tag: e.target.value })} /></label>
        <label className={label}>Default sender mailbox<input className={field} value={s.default_sender_mailbox} placeholder={s.env_sender || 'cs-team@solvit.co.ke'} onChange={(e) => set({ default_sender_mailbox: e.target.value })} /></label>
      </div>
      <h4 className="text-xs font-black text-slate-800 mt-4 mb-1">Sender mailbox per login</h4>
      <div className="space-y-1.5 max-w-2xl">
        {s.senders.map((r, i) => (
          <div key={i} className="flex gap-1.5">
            <input className={field} value={r.username} placeholder="Portal username" aria-label="Portal username" onChange={(e) => set({ senders: s.senders.map((x, k) => (k === i ? { ...x, username: e.target.value } : x)) })} />
            <input className={field} value={r.mailbox} placeholder="mailbox@solvit.co.ke" aria-label="Sender mailbox" onChange={(e) => set({ senders: s.senders.map((x, k) => (k === i ? { ...x, mailbox: e.target.value } : x)) })} />
            <button type="button" className={`${btn} ${btnSm}`} onClick={() => set({ senders: s.senders.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
      </div>
      <button type="button" className={`${btn} ${btnSm} mt-2`} onClick={() => set({ senders: [...s.senders, { username: '', mailbox: '' }] })}>Add sender</button>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" className={btnPrimary} onClick={save}>Save</button>
        {msg && (msg.bad ? <Note bad>{msg.text}</Note> : <Pill tone="ok">{msg.text}</Pill>)}
        {s.mail_configured ? <Pill tone="ok">Microsoft email connection configured</Pill> : <Pill tone="warn">Email is not configured on the server yet</Pill>}
      </div>
    </Panel>
  );
}

/* ---------- The Import & Settings tab ---------- */

export function SettingsTab({ shared, isAdmin }: { shared: Shared; isAdmin: boolean }) {
  return (
    <div className="space-y-4">
      <ImportPanel shared={shared} />
      <Panel title="Routing rules in use">
        <ul className="text-[11px] text-slate-700 space-y-1 list-disc pl-4 leading-relaxed">
          <li><b>Solver / Broker:</b> call the solver, then the broker/agent they name.</li>
          <li><b>Ref Agent:</b> email the AM member who initiated it, jobs grouped by insurer, the CS team group in copy ({shared.state.directory.csGroup}).</li>
          <li><b>Channel Partner / Not recorded:</b> email the insurance company address, the CS team group in copy.</li>
          <li><b>Not found:</b> treated as Ref Agent if the initiator is an AM member, Solver if the initiator is the solver, otherwise you set it on the job.</li>
          <li><b>Document received:</b> emails the allocated valuation team member, the valuation group in copy ({shared.state.directory.valGroup}), and the solver.</li>
          <li><b>Excel:</b> an email covering more than one job always carries an Excel list (one sheet per insurance company). A single-job email does not.</li>
        </ul>
      </Panel>
      <Panel title="Signed in as"><p className="text-xs text-slate-700">Follow-ups and emails are recorded under <b>{shared.actor}</b>.</p></Panel>
      <TeamPanel shared={shared} />
      <SolversPanel shared={shared} />
      {isAdmin && <AdminPanel />}
    </div>
  );
}
