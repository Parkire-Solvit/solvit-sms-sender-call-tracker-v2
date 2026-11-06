// tests/pendingOwnershipDb.test.ts
// Pending Submission / Inspection: every record has an owner (open or closed), oldest schedule date first,
// conversion rate in the KPI, and the keyless "remove last upload" for Callbacks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function statusOf(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
  } catch (e: any) {
    return typeof e?.status === "number" ? e.status : -1;
  }
  return 0;
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping pending ownership DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-ownership-test-"));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_RESET_KEY = "test-reset-key-123456";
  process.chdir(dir);

  const { initDatabase } = await import(pathToFileURL(path.join(root, "db.ts")).href);
  const ps = await import(pathToFileURL(path.join(root, "pendingSubmissions.ts")).href);
  const kpi = await import(pathToFileURL(path.join(root, "agentKpiService.ts")).href);
  const cb = await import(pathToFileURL(path.join(root, "insuranceCallbacks.ts")).href);
  const dr = await import(pathToFileURL(path.join(root, "dataReset.ts")).href);
  const db = await initDatabase();

  console.log("Running DB integration tests for record ownership, ordering, conversion and keyless callbacks undo...");

  const TAG = "Callback Team(Submission)";
  const INS = "Pending Inspection";
  const SUB = "Pending Submission";
  const mk = (id: number, status: string, schedule: string) => ({
    external_id: id, job_status: status, solver_name: `Solver ${id}`, solver_contact: `0700${String(100000 + id)}`, solver_email: "",
    vehicle_reg: `KAA ${String(1000 + id)}A`, insurance_company: "Fidelity",
    client_phone: `0722${String(100000 + id).padStart(6, "0")}`, customer_email: "",
    schedule_date: schedule, latest_pending_reason: "x",
  });
  const jobOf = async (ext: number) => db.queryOne("SELECT * FROM pending_submission_jobs WHERE external_id = ?", [ext]);
  const count = async (sql: string, params: unknown[] = []) => Number((await db.queryOne(sql, params)).n);

  // ---- 1. Records arrive while nobody is tagged: all unassigned. Two are then closed while still unassigned. ----
  await ps.importPendingSubmissions(db, "list.xlsx", "Brian", [
    mk(1, INS, "2026-03-01T00:00:00.000Z"),
    mk(2, INS, "2026-01-15T00:00:00.000Z"),
    mk(3, INS, "2026-02-01T00:00:00.000Z"),
    mk(4, INS, "2026-01-15T00:00:00.000Z"),
    mk(5, INS, "2026-04-01T00:00:00.000Z"),
    mk(11, SUB, "2026-02-10T00:00:00.000Z"),
    mk(12, SUB, "2026-02-11T00:00:00.000Z"),
  ]);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id IS NULL")) === 7, "all 7 start unassigned");

  const id2 = Number((await jobOf(2)).id);
  const id3 = Number((await jobOf(3)).id);
  const id12 = Number((await jobOf(12)).id);
  await ps.logPendingSubmissionOutcome(db, id2, { outcome: "WITHDRAWN", comment: "Duplicate", logged_by: "Brian" }); // closed RED
  await ps.logPendingSubmissionOutcome(db, id3, { outcome: "SCHEDULED", comment: "Booked", logged_by: "Brian" }); // closed GREEN
  await ps.logPendingSubmissionOutcome(db, id12, { outcome: "SOLVER_SUBMITTED", comment: "Done", logged_by: "Brian" }); // closed GREEN (submission)
  assert((await jobOf(2)).status === "RED" && (await jobOf(3)).status === "GREEN" && (await jobOf(12)).status === "GREEN", "three records are closed");

  // The team screen counts them as unassigned, so "nothing to assign" can no longer be shown wrongly.
  let team = await ps.getPendingSubmissionTeam(db);
  assert(team.unassigned_open_count === 4 && team.unassigned_closed_count === 3, `team counts open (4) and closed (3) unassigned (got ${team.unassigned_open_count}/${team.unassigned_closed_count})`);

  // With nobody tagged the guard is harmless and changes nothing.
  await ps.ensureSubmissionsAssigned(db);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id IS NULL")) === 7, "no team means nothing is assigned and nothing fails");

  // ---- 2. Mary becomes the only active agent. A closed record held by an archived agent keeps that agent. ----
  await db.execute("INSERT INTO agents (name, tag, phone_number) VALUES ('Mary Muriuki', ?, '0711000001')", [TAG]);
  await db.execute("INSERT INTO agents (name, tag, phone_number, archived_at) VALUES ('Old Agent', ?, '0711000009', CURRENT_TIMESTAMP)", [TAG]);
  const mary = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Mary Muriuki'")).id);
  const oldAgent = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Old Agent'")).id);
  await db.execute("UPDATE pending_submission_jobs SET assigned_agent_id = ? WHERE id = ?", [oldAgent, id3]);

  const closedBefore = await db.queryAll("SELECT id, status, latest_outcome, closed_at FROM pending_submission_jobs WHERE status <> 'AMBER' ORDER BY id");
  const logsBefore = await count("SELECT COUNT(*) AS n FROM pending_submission_logs WHERE pending_submission_job_id IN (?, ?)", [id2, id12]);

  // Dry run reports both kinds and changes nothing.
  const dry = await ps.reassignOpenSubmissions(db, { dryRun: true });
  assert(dry.records === 4 && dry.closed_records === 2, `dry run: 4 open and 2 closed (got ${dry.records}/${dry.closed_records})`);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id IS NULL")) === 6, "dry run changed nothing");

  // The guard that runs on every list load gives every unowned record to Mary.
  await ps.ensureSubmissionsAssigned(db);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id IS NULL")) === 0, "no record is unassigned any more");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id = ?", [mary])) === 6, "Mary holds all six unowned records, open and closed");
  assert(Number((await jobOf(3)).assigned_agent_id) === oldAgent, "a closed record held by an archived agent keeps that agent");
  assert(Number((await jobOf(2)).assigned_agent_id) === mary && Number((await jobOf(12)).assigned_agent_id) === mary, "the closed unassigned records went to Mary");

  // History of closed records is untouched: same status, outcome and closed_at, and no new history row.
  const closedAfter = await db.queryAll("SELECT id, status, latest_outcome, closed_at FROM pending_submission_jobs WHERE status <> 'AMBER' ORDER BY id");
  assert(JSON.stringify(closedBefore) === JSON.stringify(closedAfter), "closed records keep their status, outcome and closed time");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_logs WHERE pending_submission_job_id IN (?, ?)", [id2, id12])) === logsBefore, "no history rows were added to closed records");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_logs WHERE outcome = 'REASSIGNED_BY_SYSTEM'")) === 4, "the four open records are logged as assigned, as before");

  team = await ps.getPendingSubmissionTeam(db);
  assert(team.unassigned_open_count === 0 && team.unassigned_closed_count === 0, "team screen shows nothing unassigned");
  const again = await ps.reassignOpenSubmissions(db, { dryRun: true });
  assert(again.records === 0 && again.closed_records === 0, "a second check finds nothing to do");

  // ---- 3. List order: oldest schedule date first, ties by external id ----
  const listed = await ps.getPendingSubmissionJobs(db, { job_type: "INSPECTION" });
  assert(listed.map((j: any) => j.external_id).join(",") === "2,4,3,1,5", `inspection list is oldest schedule date first (got ${listed.map((j: any) => j.external_id).join(",")})`);
  const listedAll = await ps.getPendingSubmissionJobs(db, {});
  assert(Number(listedAll[0].external_id) === 2, "the oldest record of all is first");

  // ---- 4. Conversion rate in the KPI: all GREEN records over all records ----
  const insKpi = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), "INSPECTION");
  assert(insKpi.conversion.green === 1 && insKpi.conversion.total === 5 && insKpi.conversion.rate === 20, `inspection conversion is 1 of 5 = 20% (got ${JSON.stringify(insKpi.conversion)})`);
  const maryRow = insKpi.agents.find((a: any) => a.agent_id === mary);
  assert(maryRow.conversion.total === 4 && maryRow.conversion.green === 0 && maryRow.conversion.rate === 0, `Mary holds 4 inspection records (the fifth is held by the archived agent), none green (got ${JSON.stringify(maryRow.conversion)})`);
  const subKpi = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), "SUBMISSION");
  assert(subKpi.conversion.green === 1 && subKpi.conversion.total === 2 && subKpi.conversion.rate === 50, "submission conversion is 1 of 2 = 50%");
  // A record closed GREEN long ago still counts (no date window).
  await db.execute("UPDATE pending_submission_jobs SET closed_at = '2025-01-01T00:00:00Z' WHERE id = ?", [id12]);
  const subKpi2 = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), "SUBMISSION");
  assert(subKpi2.conversion.green === 1 && subKpi2.conversion.total === 2, "old closed records still count: all records, no date window");

  // ---- 5. Callbacks: remove the last upload without the reset key (phrase and backup still required) ----
  const cbRow = (i: number) => ({
    vehicle_reg: `KBB ${String(100 + i)}A`, client_name: `Client ${i}`, client_phone: `0733${String(100000 + i).padStart(6, "0")}`,
    customer_email: "", channel_partner: "Partner", initiated_date: "2026-01-01", reason: "x",
  });
  await cb.importCallbackJobs(db, { file_name: "a.xlsx", imported_by: "Caroline", rows: [cbRow(1), cbRow(2), cbRow(3)] });
  assert((await dr.getDataResetPreview(db, "callbacks")).undo_requires_key === false, "callbacks reports a keyless undo");
  const bk = await dr.buildDataBackup(db, "callbacks");
  assert((await statusOf(() => dr.undoLastUpload(db, "callbacks", { confirm_phrase: "remove last upload", backup_token: bk.token }))) === 400, "the exact phrase is still required");
  assert((await statusOf(() => dr.undoLastUpload(db, "callbacks", { confirm_phrase: "REMOVE LAST UPLOAD" }))) === 409, "the backup is still required");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 3, "nothing changed after the refusals");
  const undone = await dr.undoLastUpload(db, "callbacks", { confirm_phrase: "REMOVE LAST UPLOAD", backup_token: bk.token });
  assert(undone.success && undone.removed_records === 3, "undo works with no reset key");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 0, "the upload's records are gone");
  assert((await db.queryOne("SELECT changed_by FROM settings_change_log WHERE setting_key = 'data_reset.callbacks.undo_last_upload'")).changed_by === "Admin (typed confirmation and backup)", "the audit entry does not claim a reset key was used");

  // Pending still needs the key for undo and for its backup. Delete-all stays key-protected in both sections.
  assert((await dr.getDataResetPreview(db, "pending-submissions")).undo_requires_key === true, "pending undo still reports the key as required");
  const pbk = await dr.buildDataBackup(db, "pending-submissions");
  assert((await statusOf(() => dr.undoLastUpload(db, "pending-submissions", { confirm_phrase: "REMOVE LAST UPLOAD", backup_token: pbk.token }))) === 403, "pending undo without the key is refused");
  assert((await statusOf(() => dr.undoLastUpload(db, "pending-submissions", { reset_key: "wrong", confirm_phrase: "REMOVE LAST UPLOAD", backup_token: pbk.token }))) === 403, "pending undo with a wrong key is refused");
  dr.resetThrottleForTests();
  assert((await statusOf(async () => dr.verifyBackupAccess("pending-submissions", ""))) === 403, "pending backup without the key is refused");
  await cb.importCallbackJobs(db, { file_name: "b.xlsx", imported_by: "Caroline", rows: [cbRow(1)] });
  const cbk = await dr.buildDataBackup(db, "callbacks");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { confirm_phrase: "DELETE ALL CALLBACKS", confirm_count: "1", backup_token: cbk.token }))) === 403, "callbacks delete-all still needs the key");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 1, "delete-all without the key deleted nothing");
  dr.resetThrottleForTests();

  // ---- 6. Callbacks: Customer Rejected and Done Elsewhere need a real comment, on the server too ----
  const jid = Number((await db.queryOne("SELECT id FROM callback_jobs LIMIT 1")).id);
  for (const outcome of ["DECLINED", "VALUED_ELSEWHERE"]) {
    for (const bad of ["", "   ", "short"]) {
      let message = "";
      try {
        await cb.logCallbackOutcome(db, jid, outcome, bad, "Mary Muriuki");
      } catch (e: any) {
        message = String(e?.message ?? "");
      }
      assert(/Comment is required/.test(message), `${outcome} with comment "${bad}" is refused`);
    }
  }
  assert((await count("SELECT COUNT(*) AS n FROM callback_job_logs WHERE callback_job_id = ?", [jid])) === 0, "refused outcomes wrote nothing");
  assert((await db.queryOne("SELECT status FROM callback_jobs WHERE id = ?", [jid])).status === "AMBER", "the record stays open after a refusal");
  // Other outcomes may have no comment at all.
  const optional = await cb.logCallbackOutcome(db, jid, "NOT_PICKING", "", "Mary Muriuki");
  assert(optional.status === "AMBER" && optional.latest_outcome === "NOT_PICKING", "Not Picking is accepted with no comment");
  const ok = await cb.logCallbackOutcome(db, jid, "DECLINED", "Customer refused the inspection.", "Mary Muriuki");
  assert(ok.status === "RED", "a real comment is accepted and closes the record");

  // ---- 6b. Callbacks conversion rate in the KPI: all GREEN callbacks over all callbacks ----
  const cbKpi0 = await kpi.getCallbackAgentKpis(db, Date.now());
  assert(cbKpi0.conversion.total === 1 && cbKpi0.conversion.green === 0 && cbKpi0.conversion.rate === 0, `callbacks conversion starts at 0 of 1 (got ${JSON.stringify(cbKpi0.conversion)})`);
  await cb.importCallbackJobs(db, { file_name: "conv.xlsx", imported_by: "Caroline", rows: [
    { vehicle_reg: "KDD 101A", client_name: "C1", client_phone: "0733200001", customer_email: "", channel_partner: "Partner", initiated_date: "2026-01-01", reason: "x" },
    { vehicle_reg: "KDD 102A", client_name: "C2", client_phone: "0733200002", customer_email: "", channel_partner: "Partner", initiated_date: "2026-01-01", reason: "x" },
    { vehicle_reg: "KDD 103A", client_name: "C3", client_phone: "0733200003", customer_email: "", channel_partner: "Partner", initiated_date: "2026-01-01", reason: "x" },
  ] });
  const kdd = await db.queryAll("SELECT id, vehicle_reg FROM callback_jobs WHERE vehicle_reg LIKE 'KDD%' ORDER BY vehicle_reg");
  await cb.logCallbackOutcome(db, Number(kdd[0].id), "SCHEDULED", "Booked for Monday", "Mary Muriuki"); // GREEN
  await db.execute("UPDATE callback_jobs SET closed_at = '2024-01-01T00:00:00Z' WHERE id = ?", [Number(kdd[0].id)]); // an old closure still counts
  await cb.logCallbackOutcome(db, Number(kdd[1].id), "WRONG_NUMBER", "", "Mary Muriuki"); // RED
  const cbKpi = await kpi.getCallbackAgentKpis(db, Date.now());
  assert(cbKpi.conversion.total === 4 && cbKpi.conversion.green === 1 && cbKpi.conversion.rate === 25, `callbacks conversion is 1 of 4 = 25% across all records (got ${JSON.stringify(cbKpi.conversion)})`);
  assert(cbKpi.agents.every((a: any) => a.conversion !== undefined), "every callback agent row carries a conversion");

  // ---- 7. Callbacks list: oldest first (partners by oldest job, then customers, then vehicles) ----
  await db.execute("DELETE FROM callback_job_logs");
  await db.execute("DELETE FROM callback_job_phones");
  await db.execute("DELETE FROM callback_jobs");
  const cbRow2 = (i: number, partner: string, phone: string, initiated: string) => ({
    vehicle_reg: `KCC ${String(100 + i)}A`, client_name: `Client ${i}`, client_phone: phone,
    customer_email: "", channel_partner: partner, initiated_date: initiated, reason: "x",
  });
  await cb.importCallbackJobs(db, { file_name: "order.xlsx", imported_by: "Caroline", rows: [
    cbRow2(1, "Alpha", "0733100001", "2026-10-05"),
    cbRow2(2, "Alpha", "0733100001", "2026-10-02"),
    cbRow2(3, "Alpha", "0733100002", "2026-09-30"),
    cbRow2(4, "Zulu", "0733100009", "2026-08-01"),
    cbRow2(5, "Mike", "0733100005", "2026-09-15"),
  ] });
  const ordered = await cb.getCallbackJobs(db, {});
  assert(ordered.map((j: any) => String(j.vehicle_reg_raw)).join("|") === ["KCC 104A", "KCC 105A", "KCC 103A", "KCC 102A", "KCC 101A"].join("|"), `callbacks are oldest first (got ${ordered.map((j: any) => j.vehicle_reg_raw).join("|")})`);

  console.log("All pending ownership DB tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
