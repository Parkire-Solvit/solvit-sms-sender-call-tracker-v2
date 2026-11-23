// shared/pendingApproval.ts
// Pending Approval: the business rules, in one place, with no database and no React. The server uses them to build and
// check emails and to read the weekly export; the screen uses them to show status and to build the reports.
// Ported from the Pending Approvals Desk the section's manager built, rule for rule.

/* ---------- Constants ---------- */

export type ApprovalRoute = 'solver' | 'ref' | 'cp' | 'unresolved';

export const ROUTES: Record<ApprovalRoute, string> = {
  solver: 'Solver (call)',
  ref: 'Ref agent (AM team)',
  cp: 'Channel partner / not recorded',
  unresolved: 'Needs source',
};

export const DOC_NEEDED: Record<string, string> = {
  'No Logbook': 'Logbook copy',
  'No Insurance Instruction Letter': 'Insurance instruction letter',
  'No Insurance Sticker': 'Valid insurance sticker',
  Other: 'See comment',
  'Not in the system': 'Not in the system',
};

/** A job is due for another follow-up this many days after the last one. */
export const FOLLOW_UP_DAYS = 2;
/** An open job with this many follow-ups and no approval is non-actionable. */
export const NONACT_AT = 3;
export const DEFAULT_TARGET_CONVERSION = 0.99;
export const REPORT_TIME_ZONE = 'Africa/Nairobi';

export const NOFU_REASONS: ReadonlyArray<string> = [
  'Job too new, not yet due for follow-up',
  'No client or agent contact available',
  'Payment issue, not a document issue',
  'Duplicate or test job',
  'Handled by AM team or valuer directly',
  'Waiting on another team',
  'Not reached yet (workload)',
  'Other',
];

export const OUTCOMES: ReadonlyArray<readonly [string, string]> = [
  ['has_docs', 'Has the documents, will send'],
  ['gave_contact', 'Gave broker/agent contact'],
  ['req_share', 'Requested client/agent to share the document'],
  ['text_sent', 'Text or WhatsApp sent, awaiting reply'],
  ['email_req', 'Requested by email, awaiting reply'],
  ['no_answer', 'Not picking calls / unreachable'],
  ['solver_fu', 'Asked solver to follow up with the agent'],
  ['am_assist', 'Asked an AM team member to assist'],
  ['client_confirm', 'Client to confirm and advise'],
  ['promised', 'Promised to share, no date given'],
  ['promised_date', 'Promised to share on a set date'],
  ['reminder', 'Reminder sent, not yet ready'],
  ['sticker_expired', 'Sticker expired or short-term sticker'],
  ['unclear', 'Document unclear, asked for a clearer copy'],
  ['ntsa', 'Logbook still with NTSA, client to collect'],
  ['insurer_to_share', 'Initiated by the insurer, insurer to share'],
  ['wrong_insurer', 'Job belongs to a different insurer'],
  ['payment', 'Payment pending, following up'],
  ['no_docs', 'Documents not available'],
  ['other', 'Other'],
  ['custom', 'Type my own outcome…'],
];

export const PARTIES: ReadonlyArray<string> = ['Solver', 'Broker/Agent', 'AM team', 'Insurer', 'Client'];
export const ATTEMPT_TYPES = ['call', 'message', 'email', 'update', 'receipt'] as const;
export type AttemptType = (typeof ATTEMPT_TYPES)[number];
/** Outcome codes the system writes itself (not chosen from the list). */
export const SYSTEM_OUTCOMES: ReadonlyArray<string> = ['sent', 'received', 'approved'];

/* ---------- Types ---------- */

export interface ApprovalAttempt {
  at: string;
  by: string;
  type: AttemptType;
  party: string;
  outcome: string;
  outcome_text?: string;
  contact?: string;
  note?: string;
}

export interface ApprovalJob {
  /** The Request ID from the export. */
  id: string;
  allocated_to: string;
  reg: string;
  val_date: string;
  policy_holder: string;
  initiated_by: string;
  source_raw: string;
  fleet: string;
  client_cell: string;
  insurer: string;
  insurer_email: string;
  request_type: string;
  solver: string;
  solver_email: string;
  solver_phone: string;
  reason: string;
  comment: string;
  status: 'open' | 'closed';
  route_override: ApprovalRoute | null;
  nofu_reason: string | null;
  reactivated_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closed_via: 'export' | 'received' | null;
  attempts: ApprovalAttempt[];
}

export interface ApprovalPerson { name: string; email: string }
export interface ApprovalDirectory {
  am: ApprovalPerson[];
  val: ApprovalPerson[];
  valGroup: string;
  csGroup: string;
}
export interface ApprovalSolver { name: string; region: string; location: string; phone: string; email: string }
export type SolverMap = Record<string, Partial<ApprovalSolver>>;

/** Everything the rules need to know about the people involved. */
export interface ApprovalContext {
  dir: ApprovalDirectory;
  solvers: SolverMap;
  senderName: string;
}

export const amEmailOf = (dir: ApprovalDirectory, name: string): string | undefined =>
  dir.am.find((p) => p.name.toLowerCase() === (name || '').toLowerCase())?.email;
export const valEmailOf = (dir: ApprovalDirectory, name: string): string | undefined =>
  dir.val.find((p) => p.name.toLowerCase() === (name || '').toLowerCase())?.email;
export const isAm = (dir: ApprovalDirectory, name: string): boolean => amEmailOf(dir, name) !== undefined;
export const solverKey = (name: string): string => (name || '').trim().toLowerCase();
export const solverOf = (solvers: SolverMap, name: string): Partial<ApprovalSolver> => solvers[solverKey(name)] || {};
export const solverEmailOf = (solvers: SolverMap, j: ApprovalJob): string => solverOf(solvers, j.solver).email || j.solver_email || '';
export const solverPhoneOf = (solvers: SolverMap, j: ApprovalJob): string => solverOf(solvers, j.solver).phone || j.solver_phone || '';

/* ---------- Dates (all in Nairobi time, whatever the server or browser clock says) ---------- */

const ymdFormat = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** YYYY-MM-DD of a moment, in Nairobi. */
export function nairobiYmd(value: string | number | Date): string {
  return ymdFormat.format(new Date(value));
}
export const fmtD = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: REPORT_TIME_ZONE }) : '';
export const fmtDT = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: REPORT_TIME_ZONE }) : '';
/** Whole days between two moments (a to b). */
export const daysBetween = (a: string | number | Date, b: string | number | Date): number =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 864e5);

/* ---------- Routing and status ---------- */

export function routeOf(j: ApprovalJob, dir: ApprovalDirectory): ApprovalRoute {
  if (j.route_override) return j.route_override;
  const s = j.source_raw;
  if (s === 'Ref Agent') return 'ref';
  if (s === 'Solver' || s === 'Broker') return 'solver';
  if (s === 'Channel Partner' || s === 'Not recorded') return 'cp';
  if (isAm(dir, j.initiated_by)) return 'ref';
  if (j.initiated_by && j.initiated_by.toLowerCase() === (j.solver || '').toLowerCase()) return 'solver';
  return 'unresolved';
}

/** A follow-up: a call, text or email. Outcomes of earlier contacts and the system's receipts are not follow-ups. */
export const isAtt = (a: ApprovalAttempt): boolean => a.type !== 'receipt' && a.type !== 'update';
export const attemptsOf = (j: ApprovalJob): ApprovalAttempt[] => j.attempts || [];
export const nAtt = (j: ApprovalJob): number => attemptsOf(j).filter(isAtt).length;
export const msgs = (j: ApprovalJob): number => attemptsOf(j).filter((a) => a.type === 'message').length;
export const calls = (j: ApprovalJob): number => attemptsOf(j).filter((a) => a.type === 'call').length;
export const mails = (j: ApprovalJob): number => attemptsOf(j).filter((a) => a.type === 'email').length;
/** Follow-ups counted from the last reactivation (all of them when never reactivated). */
export const cntSince = (j: ApprovalJob): number =>
  attemptsOf(j).filter((a) => isAtt(a) && (!j.reactivated_at || a.at > j.reactivated_at)).length;
export const lastAtt = (j: ApprovalJob): ApprovalAttempt | undefined => attemptsOf(j).filter(isAtt).slice(-1)[0];

export type ActionState = 'closed' | 'none' | 'nonact' | 'due' | 'waiting';
export function actionOf(j: ApprovalJob, now: number = Date.now()): ActionState {
  if (j.status === 'closed') return 'closed';
  if (!nAtt(j)) return 'none';
  if (cntSince(j) >= NONACT_AT) return 'nonact';
  const l = lastAtt(j)!;
  return daysBetween(l.at, now) >= FOLLOW_UP_DAYS ? 'due' : 'waiting';
}
export const ACTION_LABEL: Record<ActionState, [string, string]> = {
  none: ['Not actioned', 'p-bad'],
  waiting: ['Actioned, waiting', 'p-warn'],
  due: ['Actioned, follow-up due', 'p-warn'],
  nonact: ['Non-actionable', 'p-mute'],
  closed: ['Closed', 'p-ok'],
};

export function nextStep(j: ApprovalJob, dir: ApprovalDirectory, now: number = Date.now()): { t: string; c: string } {
  const r = routeOf(j, dir), at = attemptsOf(j), l = lastAtt(j);
  if (j.status === 'closed') return { t: 'Closed', c: 'p-ok' };
  if (actionOf(j, now) === 'nonact') return { t: `${NONACT_AT}+ follow-ups without approval`, c: 'p-mute' };
  if (r === 'unresolved') return { t: 'Set the source first', c: 'p-bad' };
  if (!l) return { t: r === 'solver' ? 'Call solver' : r === 'ref' ? 'Email AM team' : 'Email insurer', c: 'p-bad' };
  if (r === 'solver') {
    const gc = [...at].reverse().find((a) => a.outcome === 'gave_contact');
    if (gc && !at.some((a) => a.party === 'Broker/Agent' && a.at > gc.at)) {
      return { t: 'Call broker/agent' + (gc.contact ? ': ' + gc.contact : ''), c: 'p-warn' };
    }
  }
  const d = daysBetween(l.at, now);
  if (d >= FOLLOW_UP_DAYS) return { t: `Follow up (${d}d since last attempt)`, c: 'p-warn' };
  return { t: 'Waiting for documents', c: 'p-mute' };
}

export const outLabel = (v: string): string => (OUTCOMES.find((o) => o[0] === v) || [0, v || ''])[1] as string;
export function outText(a: ApprovalAttempt): string {
  if (a.outcome === 'custom') return a.outcome_text || 'Other';
  if (a.outcome === 'sent') return 'Email sent';
  if (a.outcome === 'received') return 'Document received';
  if (a.outcome === 'approved') return 'Approved (off the pending list)';
  return outLabel(a.outcome);
}

export const isValidOutcome = (v: string): boolean => OUTCOMES.some((o) => o[0] === v) || SYSTEM_OUTCOMES.includes(v);

/* ---------- Email builders ---------- */

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const th = (t: string) => `<th>${t}</th>`;
const sig = (ctx: ApprovalContext) => `<p>${esc(ctx.senderName)}<br>Customer Service, Solvit</p>`;
export function groupBy<T>(list: T[], f: (x: T) => string): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  list.forEach((x) => { (m[f(x)] = m[f(x)] || []).push(x); });
  return m;
}
/** 1 for a first email, 2 for the second, and so on: drives "(follow-up n)" in the subject. */
export const nth = (list: ApprovalJob[]): number => Math.max(0, ...list.map(mails)) + 1;

export interface BuiltEmail { to: string[]; cc: string[]; subject: string; html: string }

export function jobTable(list: ApprovalJob[], withBy: boolean): string {
  const head = ['Request ID', 'Vehicle reg', 'Valuation date', 'Policy holder', 'Document needed', 'Comment'].concat(withBy ? ['Initiated by'] : []);
  return "<table border='1' cellpadding='4' cellspacing='0'><tr>" + head.map(th).join('') + '</tr>' +
    list.map((j) => '<tr>' + [j.id, j.reg, fmtD(j.val_date), j.policy_holder, DOC_NEEDED[j.reason] || j.reason, j.comment]
      .concat(withBy ? [j.initiated_by || '-'] : []).map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</table>';
}

/** Ref Agent jobs: one email to the AM team member who initiated them, grouped by insurer, team group in copy. */
export function buildAM(name: string, list: ApprovalJob[], ctx: ApprovalContext): BuiltEmail {
  const by = groupBy(list, (j) => j.insurer || 'Unknown');
  let h = `<p>Hi ${esc(name.split(' ')[0])},</p><p>The jobs below were initiated by you. They are submitted but cannot be approved because documents are missing. If a job belongs to another AM team member's account, please pass it to them (copy me in) or tell me who handles it. Otherwise, please get the documents from the client or insurer and send them to me, replying to this email.</p>`;
  Object.keys(by).sort().forEach((c) => { h += `<p><b>${esc(c)}</b> (${by[c].length})</p>` + jobTable(by[c], false); });
  h += `<p>Total: ${list.length} job(s). Thank you.</p>` + sig(ctx);
  const personal = amEmailOf(ctx.dir, name);
  const n = nth(list);
  return {
    to: [personal || ctx.dir.csGroup],
    cc: personal ? [ctx.dir.csGroup] : [],
    subject: `Pending approvals: documents needed for ${list.length} job(s)` + (n > 1 ? ` (follow-up ${n - 1})` : ''),
    html: h,
  };
}

/** Channel Partner and Not recorded jobs: one email per insurer, CS group in copy. */
export function buildInsurer(company: string, list: ApprovalJob[], ctx: ApprovalContext): BuiltEmail {
  const h = `<p>Dear ${esc(company)} team,</p><p>The valuations below were completed and submitted but cannot be approved yet because the documents listed are missing. Kindly share the documents (reply to this email) so we can release the reports.</p>` +
    jobTable(list, false) + `<p>Total: ${list.length} job(s). Thank you for your help.</p>` + sig(ctx);
  return {
    to: [list[0].insurer_email],
    cc: [ctx.dir.csGroup],
    subject: `Solvit valuations awaiting documents: ${company} (${list.length} job(s))` + (nth(list) > 1 ? ' - follow-up' : ''),
    html: h,
  };
}

/** Document received: tells the allocated valuer (valuation group in copy) that the jobs are ready for approval. */
export function buildReceived(name: string, list: ApprovalJob[], note: string, ctx: ApprovalContext): BuiltEmail {
  const h = `<p>Hi ${esc(name.split(' ')[0])},</p><p>The missing document(s) for the job(s) below have been received. They are ready for approval.</p>` +
    "<table border='1' cellpadding='4' cellspacing='0'><tr>" + ['Request ID', 'Vehicle reg', 'Policy holder', 'Insurer', 'Document received'].map(th).join('') + '</tr>' +
    list.map((j) => '<tr>' + [j.id, j.reg, j.policy_holder, j.insurer, DOC_NEEDED[j.reason] || j.reason].map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</table>' +
    (note ? `<p>Note: ${esc(note)}</p>` : '') + sig(ctx);
  const personal = valEmailOf(ctx.dir, name);
  return {
    to: [personal || ctx.dir.valGroup],
    cc: personal ? [ctx.dir.valGroup] : [],
    subject: `Documents received: ${list.length} job(s) ready for approval`,
    html: h,
  };
}

/** Document received: tells the solver the report will now move to approval. */
export function buildSolver(name: string, list: ApprovalJob[], ctx: ApprovalContext): BuiltEmail {
  const h = `<p>Hi ${esc(name.split(' ')[0])},</p><p>We have now received the missing document(s) for the job(s) below. The report(s) will now move to approval. Thank you for your help.</p>` +
    "<table border='1' cellpadding='4' cellspacing='0'><tr>" + ['Request ID', 'Vehicle reg', 'Policy holder', 'Document received'].map(th).join('') + '</tr>' +
    list.map((j) => '<tr>' + [j.id, j.reg, j.policy_holder, DOC_NEEDED[j.reason] || j.reason].map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</table>' + sig(ctx);
  return {
    to: [solverEmailOf(ctx.solvers, list[0])],
    cc: [],
    subject: 'Documents received for your job(s): ' + list.map((j) => j.reg).join(', ').slice(0, 120),
    html: h,
  };
}

/** The rows of the Excel list attached to a multi-job email (one sheet per insurer, plus "All jobs"). */
export function excelRows(list: ApprovalJob[], kind: 'am' | 'ins'): Array<Record<string, string | number>> {
  return list.map((j) => ({
    'Request ID': j.id, 'Insurance company': j.insurer, 'Vehicle reg': j.reg, 'Valuation date': fmtD(j.val_date),
    'Policy holder': j.policy_holder, Solver: j.solver,
    ...(kind === 'ins' ? {} : { 'Initiated by': j.initiated_by, Source: j.source_raw }),
    'Allocated to': j.allocated_to, 'Document needed': DOC_NEEDED[j.reason] || j.reason, Comment: j.comment,
    'Attempts so far': attemptsOf(j).filter((a) => a.type !== 'receipt').length,
  }));
}

/* ---------- Reading the weekly export ---------- */

export const okMail = (e: unknown): boolean => /^\S+@\S+\.\S+$/.test(String(e || ''));
export const normPhone = (v: unknown): string => {
  let t = String(v ?? '').trim().replace(/\s+/g, '');
  if (/^\d{9}$/.test(t)) t = '0' + t;
  return t;
};

export interface ParsedApprovalRow {
  id: string;
  allocated_to: string; reg: string; val_date: string; policy_holder: string; initiated_by: string; source_raw: string;
  fleet: string; client_cell: string; insurer: string; insurer_email: string; request_type: string;
  solver: string; solver_email: string; solver_phone: string; reason: string; comment: string;
}
export interface ParseExportResult {
  rows: ParsedApprovalRow[];
  /** Every Request ID in the file, including skipped rows: a skipped row must not make its job look "missing". */
  seen: string[];
  skippedTest: number;
  skippedInvalid: Array<{ id: string; why: string }>;
}

const headerKey = (h: string): string => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** A valuation time from the export. A time with no zone is Nairobi time. Returns null when it is not a date. */
export function parseValDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(EXCEL_EPOCH_MS + Math.round(value * 864e5) - 3 * 36e5);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const normalised = s.replace(' ', 'T');
  const d = new Date(hasZone ? normalised : /^\d{4}-\d{2}-\d{2}$/.test(normalised) ? `${normalised}T00:00:00+03:00` : `${normalised}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseApprovalExportRows(raw: Array<Record<string, unknown>>): ParseExportResult {
  const out: ParseExportResult = { rows: [], seen: [], skippedTest: 0, skippedInvalid: [] };
  const seen = new Set<string>();
  for (const r of raw) {
    const m: Record<string, unknown> = {};
    for (const k of Object.keys(r)) m[headerKey(k)] = r[k];
    const get = (...names: string[]): string => {
      for (const n of names) { const v = m[headerKey(n)]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); }
      return '';
    };
    const id = get('Request_id');
    if (!id) continue;
    seen.add(id);
    const reason = get('Awaiting Document Reason'), reg = get('Vehicle_reg');
    if (reason === 'Test' || /TEST/i.test(reg) || get('Insurance_company') === 'Test Test') { out.skippedTest++; continue; }
    const valDate = parseValDate(m[headerKey('Valuation_date')]);
    if (!valDate) { out.skippedInvalid.push({ id, why: 'Valuation_date is missing or not a date' }); continue; }
    out.rows.push({
      id, allocated_to: get('Allocated_to'), reg, val_date: valDate, policy_holder: get('Policy_holder'), initiated_by: get('Initiated_by'),
      source_raw: get('Initiator_Source'), fleet: get('Fleet_name'), client_cell: get('Client_cell'), insurer: get('Insurance_company'),
      insurer_email: get('Insurance_company_email'), request_type: get('Request_type'), solver: get('Solver_name'), solver_email: get('Solver_email'),
      solver_phone: get('Solver_contact', 'Solver_phone', 'Solver_cell', 'Solver_contacts'), reason, comment: get('Awaiting Document Reason Comment'),
    });
  }
  out.seen = [...seen];
  return out;
}

/** The regional solver contact list, or a sheet with Name, Phone, Email columns. Rows are arrays (header: 1). */
export function parseSolverSheet(a: string[][]): ApprovalSolver[] {
  const out: ApprovalSolver[] = [];
  const hi = a.findIndex((r) => r.some((c) => /^(solver[\s_]*)?name$/i.test(String(c).trim())));
  if (hi >= 0) {
    const h = a[hi].map((c) => String(c).trim().toLowerCase().replace(/[\s_]+/g, ' '));
    const ix = (re: RegExp) => h.findIndex((c) => re.test(c));
    const n = ix(/^(solver )?name$/), p = ix(/^(solver )?(phone|contact|cell|mobile)/), e = ix(/^(solver )?email$/), rg = ix(/^region/), lc = ix(/^location/);
    a.slice(hi + 1).forEach((r) => {
      const name = String(r[n] || '').trim();
      if (name) out.push({ name, phone: p >= 0 ? normPhone(r[p]) : '', email: e >= 0 ? String(r[e] || '').trim() : '', region: rg >= 0 ? String(r[rg] || '').trim() : '', location: lc >= 0 ? String(r[lc] || '').trim() : '' });
    });
  } else {
    let region = '';
    a.forEach((r) => {
      if (String(r[1]).trim().toLowerCase() === 'location') { region = String(r[0]).trim(); return; }
      const name = String(r[0] || '').trim();
      if (name && String(r[2] || '').trim() && !/listing/i.test(name)) out.push({ name, phone: normPhone(r[2]), email: '', region, location: String(r[1] || '').trim() });
    });
  }
  return out;
}

/** The team list upload: columns Name, Email, Team (AM or Valuation). */
export function parseTeamRows(rows: Array<Record<string, unknown>>): { am: ApprovalPerson[]; val: ApprovalPerson[]; bad: number } {
  const out = { am: [] as ApprovalPerson[], val: [] as ApprovalPerson[], bad: 0 };
  const pick = (r: Record<string, unknown>, names: string[]): string => {
    const k = Object.keys(r).find((x) => names.includes(x.trim().toLowerCase().replace(/[\s_]+/g, ' ')));
    return k === undefined ? '' : String(r[k]).trim();
  };
  for (const r of rows) {
    const name = pick(r, ['name', 'full name']), email = pick(r, ['email', 'email address']), t = pick(r, ['team', 'group']);
    if (!name && !email) continue;
    const k = /valu/i.test(t) ? 'val' : /^am|account/i.test(t) ? 'am' : '';
    if (!k || !name || !okMail(email)) { out.bad++; continue; }
    const list = out[k];
    const ex = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (ex) ex.email = email; else list.push({ name, email });
  }
  return out;
}

/* ---------- Reports ---------- */

export type ReportGrain = 'day' | 'week' | 'month';
export interface ReportOptions {
  from?: string;
  to?: string;
  insurer?: string;
  grain: ReportGrain;
  target: number;
  now?: number;
  dir: ApprovalDirectory;
}
export interface ReportTable { t: string; head: string[]; rows: Array<Array<string | number>>; total?: boolean }
export interface JobInfo {
  j: ApprovalJob;
  n: number;
  followed: boolean;
  out: 'approved' | 'nonact' | 'pending';
  last: ApprovalAttempt | null;
  first: ApprovalAttempt | null;
}

export const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 1000) / 10}%` : '-');
const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function computeApprovalReport(jobs: ApprovalJob[], o: ReportOptions) {
  const now = o.now ?? Date.now();
  const js = jobs.filter((j) => (!o.from || nairobiYmd(j.val_date) >= o.from) && (!o.to || nairobiYmd(j.val_date) <= o.to) && (!o.insurer || j.insurer === o.insurer));
  const nz = (j: ApprovalJob) => attemptsOf(j).filter(isAtt);
  const nzo = (j: ApprovalJob) => attemptsOf(j).filter((a) => a.type !== 'receipt');
  const info: JobInfo[] = js.map((j) => {
    const at = nz(j), closed = j.status === 'closed';
    const followed = at.length > 0 || (closed && j.closed_via !== 'export');
    return { j, n: at.length, followed, out: closed ? 'approved' : actionOf(j, now) === 'nonact' ? 'nonact' : 'pending', last: nzo(j).length ? nzo(j)[nzo(j).length - 1] : null, first: at.length ? at[0] : null };
  });
  const lastOut = (x: JobInfo): string => (!x.last ? 'No follow-up logged' : x.last.outcome === 'sent' ? 'Email sent, awaiting reply' : outText(x.last) || 'Other');
  const F = info.filter((x) => x.followed), N = info.filter((x) => !x.followed);
  const A = F.filter((x) => x.out === 'approved'), P = F.filter((x) => x.out === 'pending'), NA = F.filter((x) => x.out === 'nonact'), NOT = F.filter((x) => x.out !== 'approved');
  const conv = F.length ? A.length / F.length : 0;
  const gap = ((conv - o.target) * 100).toFixed(1);
  const grp = <T,>(arr: T[], f: (x: T) => string): Record<string, T[]> => { const m: Record<string, T[]> = {}; arr.forEach((x) => { const k = f(x) || 'Unspecified'; (m[k] = m[k] || []).push(x); }); return m; };
  const pk = (d: string): string => {
    const ymd = nairobiYmd(d);
    if (o.grain === 'day') return ymd;
    if (o.grain === 'month') return ymd.slice(0, 7);
    const dt = new Date(ymd + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };
  const plabel = (k: string): string => (o.grain === 'month' ? k : (o.grain === 'week' ? 'Week of ' : '') + fmtD(k + 'T00:00:00+03:00'));

  const T: ReportTable[] = [];
  T.push({ t: 'Segment 1: followed-up jobs', head: ['Measure', 'Jobs'], rows: [
    ['Total jobs pending approval (pipeline)', info.length], ['Total jobs followed up', F.length], ['Followed up and approved', A.length],
    ['Followed up, still pending (actionable)', P.length], [`Followed up, non-actionable (${NONACT_AT}+ follow-ups, not approved)`, NA.length], ['Total followed-up jobs not approved', NOT.length]] });
  const bar = grp(NOT, lastOut);
  const barRows = Object.keys(bar).map((k) => [k, bar[k].filter((x) => x.out === 'pending').length, bar[k].filter((x) => x.out === 'nonact').length, bar[k].length] as [string, number, number, number]).sort((a, b) => b[3] - a[3]);
  T.push({ t: 'Reasons for non-approval: what happened at the latest follow-up', head: ['Latest follow-up outcome', 'Still pending', 'Non-actionable', 'Total not approved'], rows: [...barRows, ['Total', P.length, NA.length, NOT.length]], total: true });
  const dr = grp(NOT, (x) => x.j.reason);
  const drRows = Object.keys(dr).map((k) => [k, dr[k].filter((x) => x.out === 'pending').length, dr[k].filter((x) => x.out === 'nonact').length, dr[k].length] as [string, number, number, number]).sort((a, b) => b[3] - a[3]);
  T.push({ t: 'Reasons for non-approval: document missing', head: ['Document missing', 'Still pending', 'Non-actionable', 'Total not approved'], rows: [...drRows, ['Total', P.length, NA.length, NOT.length]], total: true });
  const per = grp(F, (x) => pk(x.first ? x.first.at : x.j.closed_at || x.j.val_date));
  const perKeys = Object.keys(per).sort();
  const perRows = perKeys.map((k) => {
    const a = per[k].filter((x) => x.out === 'approved'), c = (m: (x: JobInfo) => boolean) => a.filter(m).length;
    return [plabel(k), per[k].length, c((x) => x.n <= 1), c((x) => x.n === 2), c((x) => x.n >= 3), a.length, pct(a.length, per[k].length), ((a.length / per[k].length - o.target) * 100).toFixed(1) + ' pts'];
  });
  T.push({ t: 'Conversion by follow-up period (by date of first follow-up)', head: ['Period', 'Jobs followed up', 'Approved after 1st follow-up', 'Approved after 2nd', 'Approved after 3rd or more', 'Total approved', 'Conversion %', 'vs target'],
    rows: [...perRows, ['Total', F.length, A.filter((x) => x.n <= 1).length, A.filter((x) => x.n === 2).length, A.filter((x) => x.n >= 3).length, A.length, pct(A.length, F.length), gap + ' pts']], total: true });
  const pr = grp(F, (x) => x.j.reason);
  const prRows = Object.keys(pr).map((k) => { const a = pr[k].filter((x) => x.out === 'approved').length; return [k, pr[k].length, a, pct(a, pr[k].length), pr[k].length - a] as [string, number, number, string, number]; }).sort((a, b) => b[1] - a[1]);
  T.push({ t: 'Conversion by pending reason', head: ['Pending reason', 'Jobs followed up', 'Approved', 'Conversion %', 'Still open'], rows: [...prRows, ['Total', F.length, A.length, pct(A.length, F.length), NOT.length]], total: true });
  const nf = grp(N, (x) => (x.j.closed_via === 'export' ? 'Approved on its own before any follow-up' : x.j.nofu_reason || 'Reason not captured'));
  const nfRows = Object.keys(nf).map((k) => [k, nf[k].length, pct(nf[k].length, N.length)] as [string, number, string]).sort((a, b) => b[1] - a[1]);
  T.push({ t: 'Segment 2: jobs not followed up', head: ['Reason no follow-up was done', 'Jobs', 'Share'], rows: [...nfRows, ['Total pending jobs not followed up', N.length, '100%']], total: true });
  const rt = grp(info, (x) => routeOf(x.j, o.dir));
  const rtRows = (Object.keys(ROUTES) as ApprovalRoute[]).filter((k) => rt[k]).map((k) => {
    const g = rt[k], f = g.filter((x) => x.followed), a = f.filter((x) => x.out === 'approved');
    return [ROUTES[k], g.length, f.length, a.length, pct(a.length, f.length), f.reduce((t, x) => t + x.n, 0), a.length ? (a.reduce((t, x) => t + x.n, 0) / a.length).toFixed(1) : '-'];
  });
  T.push({ t: 'By source', head: ['Source', 'Pending pipeline', 'Followed up', 'Approved', 'Conversion %', 'Follow-ups logged', 'Avg follow-ups to approve'], rows: rtRows });
  const ins = grp(info, (x) => x.j.insurer);
  const insRows = Object.keys(ins).map((k) => { const g = ins[k], f = g.filter((x) => x.followed), a = f.filter((x) => x.out === 'approved'); return [k, g.length, f.length, a.length, pct(a.length, f.length), f.length - a.length] as [string, number, number, number, string, number]; }).sort((a, b) => b[1] - a[1]);
  T.push({ t: 'By insurance company', head: ['Insurance company', 'Pending pipeline', 'Followed up', 'Approved', 'Conversion %', 'Followed up, not approved'], rows: insRows });

  const allAt = js.flatMap(nz);
  const today = nairobiYmd(now);
  const perDay = [...Array(14)].map((_, i) => {
    const ymd = nairobiYmd(new Date(today + 'T12:00:00Z').getTime() - (13 - i) * 864e5);
    return { ymd, day: Number(ymd.slice(8)), n: allAt.filter((a) => nairobiYmd(a.at) === ymd).length };
  });
  const activity = {
    total: allAt.length,
    calls: allAt.filter((a) => a.type === 'call').length,
    emails: allAt.filter((a) => a.type === 'email').length,
    texts: allAt.filter((a) => a.type === 'message').length,
    avgFollowUpsBeforeApproval: avg(A.map((x) => x.n)),
    avgDaysValuationToApproval: avg(A.filter((x) => x.j.closed_at).map((x) => daysBetween(x.j.val_date, x.j.closed_at!))),
    avgDaysValuationToFirst: avg(F.filter((x) => x.first).map((x) => daysBetween(x.j.val_date, x.first!.at))),
    perDay,
  };

  // Who did the work: follow-ups logged and jobs closed as received, per person.
  const people: Record<string, { followUps: number; calls: number; emails: number; texts: number; closed: number }> = {};
  const person = (n: string) => (people[n] = people[n] || { followUps: 0, calls: 0, emails: 0, texts: 0, closed: 0 });
  allAt.forEach((a) => { const p = person(a.by || 'Unknown'); p.followUps++; if (a.type === 'call') p.calls++; else if (a.type === 'email') p.emails++; else p.texts++; });
  js.forEach((j) => { if (j.status === 'closed' && j.closed_via === 'received' && j.closed_by) person(j.closed_by).closed++; });
  const team = Object.keys(people).map((name) => ({ name, ...people[name] })).sort((a, b) => b.followUps - a.followUps);

  const notApprovedRows = NOT.map((x) => ({ 'Request ID': x.j.id, 'Vehicle reg': x.j.reg, 'Insurance company': x.j.insurer, Source: x.j.source_raw, 'Document missing': x.j.reason, 'Follow-ups': x.n, Status: x.out === 'nonact' ? 'Non-actionable' : 'Still pending', 'Latest outcome': lastOut(x), 'Latest note': x.last ? x.last.note || '' : '', 'Initiated by': x.j.initiated_by, 'Allocated to': x.j.allocated_to }));
  const notFollowedRows = N.map((x) => ({ 'Request ID': x.j.id, 'Vehicle reg': x.j.reg, 'Insurance company': x.j.insurer, Source: x.j.source_raw, 'Document missing': x.j.reason, 'Age (days)': daysBetween(x.j.val_date, now), 'Reason no follow-up': x.j.closed_via === 'export' ? 'Approved on its own before any follow-up' : x.j.nofu_reason || 'Reason not captured', 'Allocated to': x.j.allocated_to }));

  return {
    info, F, N, A, P, NA, NOT, conv, gap, tables: T, activity, team, notApprovedRows, notFollowedRows,
    periods: perKeys.map((k) => { const a = per[k].filter((x) => x.out === 'approved').length; return { key: k, label: plabel(k), followed: per[k].length, approved: a, conversion: per[k].length ? a / per[k].length : 0 }; }),
    bySource: (Object.keys(ROUTES) as ApprovalRoute[]).filter((k) => rt[k]).map((k) => { const f = rt[k].filter((x) => x.followed), a = f.filter((x) => x.out === 'approved'); return { label: ROUTES[k], pipeline: rt[k].length, followed: f.length, approved: a.length, conversion: f.length ? a.length / f.length : 0 }; }),
    byInsurer: Object.keys(ins).map((k) => { const f = ins[k].filter((x) => x.followed), a = f.filter((x) => x.out === 'approved'); return { label: k, pipeline: ins[k].length, followed: f.length, approved: a.length, conversion: f.length ? a.length / f.length : 0 }; }).sort((a, b) => b.pipeline - a.pipeline),
    barriers: barRows.map((r) => ({ label: r[0], pending: r[1], nonact: r[2], total: r[3] })),
    docMissing: drRows.map((r) => ({ label: r[0], pending: r[1], nonact: r[2], total: r[3] })),
  };
}
export type ApprovalReport = ReturnType<typeof computeApprovalReport>;
