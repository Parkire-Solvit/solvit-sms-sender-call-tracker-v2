// pendingApprovals.ts
// Pending Approval: everything that touches the database. Business rules live in shared/pendingApproval.ts.
//
// Concurrency: follow-ups are rows that are only ever added, so two people logging on the same job both keep their
// entry. Closing a job is guarded by "only while it is still open", so two people marking the same job received close it
// once and the second is told it was already closed. Nothing here rewrites a whole job from a copy a screen was holding.
import type { DbAdapter, DbTransactionClient } from "./db";
import { HttpError } from "./httpError";
import {
  ATTEMPT_TYPES, NOFU_REASONS, OUTCOMES, PARTIES, fmtD, normPhone, okMail, parseApprovalExportRows, solverKey,
  type ApprovalAttempt, type ApprovalDirectory, type ApprovalJob, type ApprovalPerson, type ApprovalRoute, type ApprovalSolver, type AttemptType,
} from "./shared/pendingApproval";

type Db = DbAdapter | DbTransactionClient;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const str = (v: unknown, max = 255): string => String(v ?? "").trim().slice(0, max);

/* ---------- Settings ---------- */

export interface ApprovalSettings {
  team_tag: string;
  target_conversion: number;
  valuation_group: string;
  cs_group: string;
  default_sender_mailbox: string;
}

export async function getApprovalSettings(db: Db): Promise<ApprovalSettings> {
  const r = await db.queryOne<any>("SELECT * FROM pending_approval_settings WHERE id = 1");
  return {
    team_tag: r?.team_tag || "Approvals Team",
    target_conversion: r ? Number(r.target_conversion) : 0.99,
    valuation_group: r?.valuation_group || "valuations@solvit.co.ke",
    cs_group: r?.cs_group || "cs-team@solvit.co.ke",
    default_sender_mailbox: r?.default_sender_mailbox || "",
  };
}

/** The report target and the two group addresses. Open to everyone who works the section. */
export async function updateApprovalWorkingSettings(db: Db, patch: { target_conversion?: unknown; valuation_group?: unknown; cs_group?: unknown }): Promise<ApprovalSettings> {
  const cur = await getApprovalSettings(db);
  let target = cur.target_conversion;
  if (patch.target_conversion !== undefined) {
    const t = Number(patch.target_conversion);
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new HttpError(400, "The target must be between 0% and 100%.");
    target = Math.round(t * 10000) / 10000;
  }
  const valGroup = patch.valuation_group === undefined ? cur.valuation_group : str(patch.valuation_group);
  const csGroup = patch.cs_group === undefined ? cur.cs_group : str(patch.cs_group);
  if (!okMail(valGroup) || !okMail(csGroup)) throw new HttpError(400, "Both group addresses must be valid email addresses.");
  await db.execute(
    "UPDATE pending_approval_settings SET target_conversion = ?, valuation_group = ?, cs_group = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
    [target, valGroup, csGroup]
  );
  return getApprovalSettings(db);
}

export interface ApprovalSender { username: string; mailbox: string }

/** Who may open the section, and which mailbox emails are sent from. Administrators only. */
export async function updateApprovalAdminSettings(
  db: DbAdapter,
  patch: { team_tag?: unknown; default_sender_mailbox?: unknown; senders?: unknown }
): Promise<{ settings: ApprovalSettings; senders: ApprovalSender[] }> {
  await db.transaction(async (tx) => {
    if (patch.team_tag !== undefined) {
      const tag = str(patch.team_tag, 100);
      if (!tag) throw new HttpError(400, "The team tag cannot be empty.");
      await tx.execute("UPDATE pending_approval_settings SET team_tag = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [tag]);
    }
    if (patch.default_sender_mailbox !== undefined) {
      const m = str(patch.default_sender_mailbox);
      if (m && !okMail(m)) throw new HttpError(400, "The default sender mailbox must be a valid email address.");
      await tx.execute("UPDATE pending_approval_settings SET default_sender_mailbox = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [m || null]);
    }
    if (patch.senders !== undefined) {
      if (!Array.isArray(patch.senders)) throw new HttpError(400, "Sender mailboxes must be a list.");
      const seen = new Set<string>();
      const rows: ApprovalSender[] = [];
      for (const s of patch.senders as any[]) {
        const username = str(s?.username, 64).toLowerCase(), mailbox = str(s?.mailbox);
        if (!username && !mailbox) continue;
        if (!username || !okMail(mailbox)) throw new HttpError(400, "Every sender needs a username and a valid mailbox.");
        if (seen.has(username)) throw new HttpError(400, `The username ${username} is listed twice.`);
        seen.add(username);
        rows.push({ username, mailbox });
      }
      await tx.execute("DELETE FROM pending_approval_senders");
      for (const r of rows) await tx.execute("INSERT INTO pending_approval_senders (username, mailbox) VALUES (?, ?)", [r.username, r.mailbox]);
    }
  });
  return { settings: await getApprovalSettings(db), senders: await listApprovalSenders(db) };
}

export async function listApprovalSenders(db: Db): Promise<ApprovalSender[]> {
  return (await db.queryAll<any>("SELECT username, mailbox FROM pending_approval_senders ORDER BY username")).map((r) => ({ username: r.username, mailbox: r.mailbox }));
}

/** The mailbox a login's emails go out from: its own, else the default. Empty when neither is set. */
export async function senderMailboxFor(db: Db, username: string, envFallback = ""): Promise<string> {
  const own = await db.queryOne<any>("SELECT mailbox FROM pending_approval_senders WHERE username = ?", [username.toLowerCase()]);
  if (own?.mailbox) return own.mailbox;
  const s = await getApprovalSettings(db);
  return s.default_sender_mailbox || envFallback || "";
}

/* ---------- Email checks ---------- */

export interface ApprovalMailCheck { mailbox: string; ok: boolean; message: string; checked_by: string; checked_at: string }

/** Remembers the outcome of an email check for a mailbox, replacing the previous one. */
export async function recordApprovalMailCheck(db: Db, c: { mailbox: string; ok: boolean; message: string; by: string }): Promise<void> {
  await db.execute(
    `INSERT INTO pending_approval_mail_checks (mailbox, ok, message, checked_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (mailbox) DO UPDATE SET ok = EXCLUDED.ok, message = EXCLUDED.message, checked_by = EXCLUDED.checked_by, checked_at = CURRENT_TIMESTAMP`,
    [c.mailbox.trim().toLowerCase(), c.ok, c.message.slice(0, 1000), c.by.slice(0, 255)]
  );
}

const toCheck = (r: any): ApprovalMailCheck => ({ mailbox: r.mailbox, ok: r.ok === true, message: r.message, checked_by: r.checked_by, checked_at: iso(r.checked_at)! });

export async function listApprovalMailChecks(db: Db): Promise<ApprovalMailCheck[]> {
  return (await db.queryAll<any>("SELECT * FROM pending_approval_mail_checks ORDER BY mailbox")).map(toCheck);
}

export async function getApprovalMailCheck(db: Db, mailbox: string): Promise<ApprovalMailCheck | null> {
  if (!mailbox) return null;
  const r = await db.queryOne<any>("SELECT * FROM pending_approval_mail_checks WHERE mailbox = ?", [mailbox.trim().toLowerCase()]);
  return r ? toCheck(r) : null;
}

/* ---------- Team and solvers ---------- */

export async function getApprovalDirectory(db: Db): Promise<ApprovalDirectory> {
  const s = await getApprovalSettings(db);
  const rows = await db.queryAll<any>("SELECT team, name, email FROM pending_approval_team ORDER BY id");
  const pick = (t: string): ApprovalPerson[] => rows.filter((r) => r.team === t).map((r) => ({ name: r.name, email: r.email }));
  return { am: pick("am"), val: pick("val"), valGroup: s.valuation_group, csGroup: s.cs_group };
}

/** Replaces both team lists and the group addresses. Every person needs a name and a valid email. */
export async function saveApprovalDirectory(db: DbAdapter, dir: Partial<ApprovalDirectory>): Promise<ApprovalDirectory> {
  const clean = (list: unknown, label: string): ApprovalPerson[] => {
    if (!Array.isArray(list)) throw new HttpError(400, `The ${label} list is missing.`);
    const out: ApprovalPerson[] = [], seen = new Set<string>();
    for (const p of list as any[]) {
      const name = str(p?.name), email = str(p?.email);
      if (!name || !okMail(email)) throw new HttpError(400, "Every person needs a name and a valid email.");
      if (seen.has(name.toLowerCase())) throw new HttpError(400, `${name} is listed twice in the ${label} list.`);
      seen.add(name.toLowerCase());
      out.push({ name, email });
    }
    return out;
  };
  const am = clean(dir.am, "AM team"), val = clean(dir.val, "valuation team");
  await db.transaction(async (tx) => {
    await updateApprovalWorkingSettings(tx, { valuation_group: dir.valGroup, cs_group: dir.csGroup });
    await tx.execute("DELETE FROM pending_approval_team");
    for (const p of am) await tx.execute("INSERT INTO pending_approval_team (team, name, email) VALUES ('am', ?, ?)", [p.name, p.email]);
    for (const p of val) await tx.execute("INSERT INTO pending_approval_team (team, name, email) VALUES ('val', ?, ?)", [p.name, p.email]);
  });
  return getApprovalDirectory(db);
}

export async function listApprovalSolvers(db: Db): Promise<ApprovalSolver[]> {
  return (await db.queryAll<any>("SELECT name, region, location, phone, email FROM pending_approval_solvers ORDER BY name"))
    .map((r) => ({ name: r.name, region: r.region, location: r.location, phone: r.phone, email: r.email }));
}

/** Adds or updates solver contacts. A blank field never erases a saved value; an invalid email is ignored. */
export async function upsertApprovalSolvers(db: Db, items: Array<Partial<ApprovalSolver>>): Promise<number> {
  let n = 0;
  for (const it of items) {
    const name = str(it?.name);
    if (!name) continue;
    const phone = normPhone(it.phone).slice(0, 50), email = okMail(it.email) ? str(it.email) : "";
    const region = str(it.region), location = str(it.location);
    await db.execute(
      `INSERT INTO pending_approval_solvers (name_key, name, region, location, phone, email) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (name_key) DO UPDATE SET
         region = CASE WHEN EXCLUDED.region <> '' THEN EXCLUDED.region ELSE pending_approval_solvers.region END,
         location = CASE WHEN EXCLUDED.location <> '' THEN EXCLUDED.location ELSE pending_approval_solvers.location END,
         phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE pending_approval_solvers.phone END,
         email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE pending_approval_solvers.email END,
         updated_at = CURRENT_TIMESTAMP`,
      [solverKey(name), name, region, location, phone, email]
    );
    n++;
  }
  return n;
}

/** Sets one solver's phone and/or email exactly as given (an empty value clears it): used when a person edits a cell. */
export async function setApprovalSolverContact(db: Db, name: string, field: "phone" | "email", value: string): Promise<void> {
  const n = str(name);
  if (!n) throw new HttpError(400, "A solver name is required.");
  const v = field === "phone" ? normPhone(value).slice(0, 50) : str(value);
  if (field === "email" && v && !okMail(v)) throw new HttpError(400, "That is not a valid email address.");
  await db.execute(
    `INSERT INTO pending_approval_solvers (name_key, name) VALUES (?, ?) ON CONFLICT (name_key) DO NOTHING`,
    [solverKey(n), n]
  );
  await db.execute(`UPDATE pending_approval_solvers SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE name_key = ?`, [v, solverKey(n)]);
}

/* ---------- Reading ---------- */

function rowToAttempt(r: any): ApprovalAttempt {
  const a: ApprovalAttempt = { at: iso(r.attempted_at)!, by: r.by_name, type: r.attempt_type as AttemptType, party: r.party, outcome: r.outcome };
  if (r.outcome_text) a.outcome_text = r.outcome_text;
  if (r.contact) a.contact = r.contact;
  if (r.note) a.note = r.note;
  return a;
}

function rowToJob(r: any, attempts: ApprovalAttempt[]): ApprovalJob {
  return {
    id: r.request_id, allocated_to: r.allocated_to, reg: r.vehicle_reg, val_date: iso(r.val_date)!, policy_holder: r.policy_holder,
    initiated_by: r.initiated_by, source_raw: r.source_raw, fleet: r.fleet, client_cell: r.client_cell, insurer: r.insurer, insurer_email: r.insurer_email,
    request_type: r.request_type, solver: r.solver_name, solver_email: r.solver_email, solver_phone: r.solver_phone, reason: r.reason, comment: r.comment,
    status: r.status, route_override: r.route_override || null, nofu_reason: r.nofu_reason || null, reactivated_at: iso(r.reactivated_at),
    closed_at: iso(r.closed_at), closed_by: r.closed_by || null, closed_via: r.closed_via || null, attempts,
  };
}

export async function listApprovalJobs(db: Db, requestIds?: string[]): Promise<ApprovalJob[]> {
  const where = requestIds ? " WHERE j.request_id = ANY(?)" : "";
  const params = requestIds ? [requestIds] : [];
  const jobs = await db.queryAll<any>(`SELECT j.* FROM pending_approval_jobs j${where} ORDER BY j.val_date ASC, j.id ASC`, params);
  const attempts = await db.queryAll<any>(
    `SELECT a.*, j.request_id FROM pending_approval_attempts a JOIN pending_approval_jobs j ON j.id = a.job_id${where} ORDER BY a.attempted_at ASC, a.id ASC`,
    params
  );
  const byJob = new Map<string, ApprovalAttempt[]>();
  for (const a of attempts) {
    const list = byJob.get(a.request_id) || [];
    list.push(rowToAttempt(a));
    byJob.set(a.request_id, list);
  }
  return jobs.map((r) => rowToJob(r, byJob.get(r.request_id) || []));
}

/** A cheap fingerprint of everything the screen shows. Browsers poll it and fetch the full state only when it changes. */
export async function getApprovalRevision(db: Db): Promise<string> {
  const r = await db.queryOne<any>(
    `SELECT
       (SELECT COUNT(*)::text || ':' || COALESCE(MAX(EXTRACT(EPOCH FROM updated_at))::text, '') FROM pending_approval_jobs) AS jobs,
       (SELECT COUNT(*)::text || ':' || COALESCE(MAX(id), 0)::text FROM pending_approval_attempts) AS attempts,
       (SELECT COUNT(*)::text || ':' || COALESCE(MAX(EXTRACT(EPOCH FROM updated_at))::text, '') FROM pending_approval_solvers) AS solvers,
       (SELECT COUNT(*)::text || ':' || COALESCE(MAX(EXTRACT(EPOCH FROM updated_at))::text, '') FROM pending_approval_team) AS team,
       (SELECT EXTRACT(EPOCH FROM updated_at)::text FROM pending_approval_settings WHERE id = 1) AS settings,
       (SELECT COUNT(*)::text || ':' || COALESCE(MAX(id), 0)::text FROM pending_approval_emails) AS emails`
  );
  return [r?.jobs, r?.attempts, r?.solvers, r?.team, r?.settings, r?.emails].join("|");
}

export async function getApprovalState(db: Db) {
  const settings = await getApprovalSettings(db);
  return {
    revision: await getApprovalRevision(db),
    settings: { target_conversion: settings.target_conversion },
    directory: await getApprovalDirectory(db),
    solvers: await listApprovalSolvers(db),
    jobs: await listApprovalJobs(db),
  };
}

export interface ApprovalEmailRow { id: number; at: string; by: string; kind: string; key: string; to: string[]; cc: string[]; subject: string; jobs: string[] }
export async function listApprovalEmails(db: Db, limit = 500): Promise<ApprovalEmailRow[]> {
  const rows = await db.queryAll<any>("SELECT * FROM pending_approval_emails ORDER BY sent_at DESC, id DESC LIMIT ?", [Math.min(Math.max(limit, 1), 2000)]);
  return rows.map((r) => ({ id: Number(r.id), at: iso(r.sent_at)!, by: r.by_name, kind: r.kind, key: r.email_key, to: r.to_addrs || [], cc: r.cc_addrs || [], subject: r.subject, jobs: r.job_ids || [] }));
}

/* ---------- Follow-ups ---------- */

const MANUAL_TYPES: ReadonlyArray<string> = ATTEMPT_TYPES.filter((t) => t !== "receipt");

async function openJobRow(db: Db, requestId: string, lock = false): Promise<{ id: number; status: string }> {
  const j = await db.queryOne<any>(`SELECT id, status FROM pending_approval_jobs WHERE request_id = ?${lock ? " FOR UPDATE" : ""}`, [requestId]);
  if (!j) throw new HttpError(404, "Job not found.");
  return j;
}

export interface LogAttemptInput {
  type?: unknown; party?: unknown; outcome?: unknown; outcome_text?: unknown; contact?: unknown; note?: unknown;
  solver_phone?: unknown; solver_email?: unknown; client_request_id?: unknown;
}

/** Records a call, text, email or the outcome of an earlier contact. Returns false when this exact save was already stored. */
export async function logApprovalAttempt(db: DbAdapter, requestId: string, input: LogAttemptInput, actor: string): Promise<{ saved: boolean }> {
  const type = str(input.type, 20), party = str(input.party, 40), outcome = str(input.outcome, 40);
  if (!MANUAL_TYPES.includes(type)) throw new HttpError(400, "Choose what kind of contact this was.");
  if (!PARTIES.includes(party)) throw new HttpError(400, "Choose who was contacted.");
  if (!OUTCOMES.some((o) => o[0] === outcome)) throw new HttpError(400, "Choose an outcome from the list.");
  const outcomeText = str(input.outcome_text, 300);
  if (outcome === "custom" && !outcomeText) throw new HttpError(400, "Type the outcome, or pick one from the list.");
  const contact = outcome === "gave_contact" ? str(input.contact, 300) : "";
  const note = str(input.note, 2000);
  const requestKey = str(input.client_request_id, 80) || null;
  const solverEmail = str(input.solver_email), solverPhone = str(input.solver_phone);
  if (solverEmail && !okMail(solverEmail)) throw new HttpError(400, "The solver email is not a valid email address.");

  return db.transaction(async (tx) => {
    const job = await openJobRow(tx, requestId, true);
    if (job.status === "closed") throw new HttpError(409, "This job is already closed. Refresh the page.");
    const r = await tx.execute(
      `INSERT INTO pending_approval_attempts (job_id, by_name, attempt_type, party, outcome, outcome_text, contact, note, client_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_request_id) DO NOTHING`,
      [job.id, actor, type, party, outcome, outcomeText || null, contact || null, note || null, requestKey]
    );
    if (r.affectedRows === 0) return { saved: false };
    await tx.execute("UPDATE pending_approval_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id]);
    if (solverPhone || solverEmail) {
      const j = await tx.queryOne<any>("SELECT solver_name FROM pending_approval_jobs WHERE id = ?", [job.id]);
      if (j?.solver_name) await upsertApprovalSolvers(tx, [{ name: j.solver_name, phone: solverPhone, email: solverEmail }]);
    }
    return { saved: true };
  });
}

export async function setApprovalRoute(db: Db, requestId: string, route: unknown): Promise<void> {
  if (!["solver", "ref", "cp"].includes(String(route))) throw new HttpError(400, "Choose Solver, Ref agent or Channel partner.");
  const job = await openJobRow(db, requestId);
  await db.execute("UPDATE pending_approval_jobs SET route_override = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [route as ApprovalRoute, job.id]);
}

/** Brings a non-actionable job back into play: follow-ups are counted again from now. */
export async function reactivateApprovalJob(db: Db, requestId: string): Promise<void> {
  const job = await openJobRow(db, requestId);
  if (job.status === "closed") throw new HttpError(409, "This job is already closed. Refresh the page.");
  await db.execute("UPDATE pending_approval_jobs SET reactivated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id]);
}

/** Sets the "why no follow-up" reason. Only jobs that have no follow-up yet are changed. Returns how many were. */
export async function setApprovalNoFollowUpReason(db: Db, requestIds: unknown, reason: unknown): Promise<number> {
  if (!Array.isArray(requestIds) || requestIds.length === 0) throw new HttpError(400, "Tick the jobs first.");
  const r = str(reason);
  if (!NOFU_REASONS.includes(r)) throw new HttpError(400, "Choose a reason from the list.");
  const res = await db.execute(
    `UPDATE pending_approval_jobs j SET nofu_reason = ?, updated_at = CURRENT_TIMESTAMP
     WHERE j.request_id = ANY(?) AND j.status = 'open'
       AND NOT EXISTS (SELECT 1 FROM pending_approval_attempts a WHERE a.job_id = j.id AND a.attempt_type IN ('call', 'message', 'email'))`,
    [r, requestIds.map(String)]
  );
  return res.affectedRows;
}

/* ---------- Closing ---------- */

/** Closes the jobs that are still open and records a receipt on each. Returns the Request IDs that were closed by this call. */
export async function closeApprovalJobs(
  db: DbAdapter,
  requestIds: string[],
  opts: { actor: string; via: "received" | "export"; note?: string }
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const closed: string[] = [];
    for (const id of [...new Set(requestIds)]) {
      const job = await tx.queryOne<any>("SELECT id FROM pending_approval_jobs WHERE request_id = ? AND status = 'open' FOR UPDATE", [id]);
      if (!job) continue;
      await tx.execute(
        "UPDATE pending_approval_jobs SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?, closed_via = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [opts.actor, opts.via, job.id]
      );
      await tx.execute(
        "INSERT INTO pending_approval_attempts (job_id, by_name, attempt_type, party, outcome, note) VALUES (?, ?, 'receipt', '-', ?, ?)",
        [job.id, opts.actor, opts.via === "export" ? "approved" : "received", str(opts.note, 2000) || null]
      );
      closed.push(id);
    }
    return closed;
  });
}

/* ---------- Email log ---------- */

export interface RecordEmailInput { by: string; kind: string; key: string; to: string[]; cc: string[]; subject: string; jobIds: string[] }
export async function recordApprovalEmail(db: Db, e: RecordEmailInput): Promise<void> {
  await db.execute(
    "INSERT INTO pending_approval_emails (by_name, kind, email_key, to_addrs, cc_addrs, subject, job_ids) VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?::jsonb)",
    [e.by, e.kind.slice(0, 20), e.key.slice(0, 255), JSON.stringify(e.to), JSON.stringify(e.cc), e.subject.slice(0, 500), JSON.stringify(e.jobIds)]
  );
}

/** After a follow-up email has gone out: one "email sent" follow-up on each job that is still open, plus the log entry. */
export async function recordSentFollowUp(db: DbAdapter, e: RecordEmailInput & { party: "AM team" | "Insurer" }): Promise<number> {
  return db.transaction(async (tx) => {
    let n = 0;
    for (const id of [...new Set(e.jobIds)]) {
      const job = await tx.queryOne<any>("SELECT id FROM pending_approval_jobs WHERE request_id = ? AND status = 'open' FOR UPDATE", [id]);
      if (!job) continue;
      await tx.execute(
        "INSERT INTO pending_approval_attempts (job_id, by_name, attempt_type, party, outcome, note) VALUES (?, ?, 'email', ?, 'sent', ?)",
        [job.id, e.by, e.party, "To " + e.to.join(", ")]
      );
      await tx.execute("UPDATE pending_approval_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id]);
      n++;
    }
    await recordApprovalEmail(tx, e);
    return n;
  });
}

/* ---------- Weekly export ---------- */

export interface ApprovalImportResult {
  import_id: number;
  added: number;
  refreshed: number;
  skipped_test: number;
  skipped_invalid: Array<{ id: string; why: string }>;
  /** Closed jobs that are in this file again. They stay closed; the screen mentions them. */
  already_closed_in_file: number;
  open_after: number;
  missing: Array<{ id: string; reg: string }>;
}

/**
 * Applies the weekly pending-jobs export. New jobs are added; existing jobs keep their follow-ups and status and only
 * refresh their details (a blank solver email or phone never erases a saved one). Open jobs that are not in the file are
 * only reported: they are closed as approved when the user confirms (closeMissingFromImport).
 */
export async function importApprovalExport(db: DbAdapter, fileName: string, importedBy: string, rawRows: unknown): Promise<ApprovalImportResult> {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new HttpError(400, "No rows provided for import.");
  const parsed = parseApprovalExportRows(rawRows as Array<Record<string, unknown>>);
  if (parsed.seen.length === 0) throw new HttpError(400, "No Request_id values were found. Check that this is the pending-jobs export.");

  return db.transaction(async (tx) => {
    let added = 0, refreshed = 0, alreadyClosed = 0;
    for (const r of parsed.rows) {
      if (r.solver && (r.solver_email || r.solver_phone)) await upsertApprovalSolvers(tx, [{ name: r.solver, email: r.solver_email, phone: r.solver_phone }]);
      const ex = await tx.queryOne<any>("SELECT id, status FROM pending_approval_jobs WHERE request_id = ? FOR UPDATE", [r.id]);
      if (ex) {
        await tx.execute(
          `UPDATE pending_approval_jobs SET allocated_to = ?, vehicle_reg = ?, val_date = ?, policy_holder = ?, initiated_by = ?, source_raw = ?, fleet = ?, client_cell = ?,
             insurer = ?, insurer_email = ?, request_type = ?, solver_name = ?,
             solver_email = CASE WHEN ? <> '' THEN ? ELSE solver_email END, solver_phone = CASE WHEN ? <> '' THEN ? ELSE solver_phone END,
             reason = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [r.allocated_to, r.reg, r.val_date, r.policy_holder, r.initiated_by, r.source_raw, r.fleet, r.client_cell, r.insurer, r.insurer_email, r.request_type, r.solver,
            r.solver_email, r.solver_email, r.solver_phone, r.solver_phone, r.reason, r.comment, ex.id]
        );
        refreshed++;
        if (ex.status === "closed") alreadyClosed++;
      } else {
        await tx.execute(
          `INSERT INTO pending_approval_jobs (request_id, allocated_to, vehicle_reg, val_date, policy_holder, initiated_by, source_raw, fleet, client_cell,
             insurer, insurer_email, request_type, solver_name, solver_email, solver_phone, reason, comment)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.allocated_to, r.reg, r.val_date, r.policy_holder, r.initiated_by, r.source_raw, r.fleet, r.client_cell, r.insurer, r.insurer_email, r.request_type,
            r.solver, r.solver_email, r.solver_phone, r.reason, r.comment]
        );
        added++;
      }
    }
    const open = await tx.queryAll<any>("SELECT request_id, vehicle_reg FROM pending_approval_jobs WHERE status = 'open'");
    const seen = new Set(parsed.seen);
    const missing = open.filter((o) => !seen.has(o.request_id)).map((o) => ({ id: o.request_id as string, reg: o.vehicle_reg as string }));
    const rec = await tx.execute(
      `INSERT INTO pending_approval_imports (file_name, imported_by, row_count_total, added_count, refreshed_count, skipped_count, missing_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)`,
      [str(fileName, 500) || "PENDING_APPROVALS.xlsx", str(importedBy) || "System", rawRows.length, added, refreshed, parsed.skippedTest + parsed.skippedInvalid.length, JSON.stringify(missing.map((m) => m.id))]
    );
    return {
      import_id: rec.lastInsertId, added, refreshed, skipped_test: parsed.skippedTest, skipped_invalid: parsed.skippedInvalid,
      already_closed_in_file: alreadyClosed, open_after: open.length, missing,
    };
  });
}

/** Closes, as approved, the jobs the user confirmed were missing from an upload. Only the latest upload can be confirmed, once. */
export async function closeMissingFromImport(db: DbAdapter, importId: number, actor: string): Promise<{ closed: number }> {
  const imp = await db.queryOne<any>("SELECT * FROM pending_approval_imports WHERE id = ?", [importId]);
  if (!imp) throw new HttpError(404, "That upload was not found.");
  if (imp.closed_missing_at) throw new HttpError(409, "These jobs were already closed for this upload.");
  const latest = await db.queryOne<any>("SELECT MAX(id) AS id FROM pending_approval_imports");
  if (Number(latest?.id) !== Number(imp.id)) throw new HttpError(409, "A newer upload exists. Upload the file again to review what is missing.");
  const ids: string[] = imp.missing_ids || [];
  const closed = await closeApprovalJobs(db, ids, { actor, via: "export", note: `Not in the pending export uploaded ${fmtD(iso(imp.imported_at))}` });
  await db.execute(
    "UPDATE pending_approval_imports SET closed_missing_at = CURRENT_TIMESTAMP, closed_missing_by = ?, closed_missing_count = ? WHERE id = ?",
    [actor, closed.length, imp.id]
  );
  return { closed: closed.length };
}
