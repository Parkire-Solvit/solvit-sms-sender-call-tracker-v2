// V18 tests/dataResetDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping data reset DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-reset-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.env.DATA_RESET_KEY = "test-reset-key-123456";
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const cb = await import(path.join(root, "insuranceCallbacks.ts"));
  const dr = await import(path.join(root, "dataReset.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for data reset...");

  const KEY = process.env.DATA_RESET_KEY;
  const count = async (sql: string, params: unknown[] = []) => Number((await db.queryOne(sql, params)).n);
  const statusOf = async (fn: () => Promise<unknown>): Promise<number> => {
    try {
      await fn();
    } catch (e: any) {
      return typeof e?.status === "number" ? e.status : -1;
    }
    return 0;
  };
  const backup = async (section: string) => dr.buildDataBackup(db, section);

  // Things that must survive every reset: an agent, an Android event, a setting.
  await db.execute("INSERT INTO agents (name, tag) VALUES ('Kelvin', 'Callback Team')");
  const kelvin = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Kelvin'")).id);
  await db.execute("INSERT INTO events (agent_id, type, target_phone, status, reg_no, timestamp) VALUES (?, 'CALL', '0722000001', 'OUTGOING', NULL, ?)", [kelvin, new Date().toISOString()]);
  const eventsBefore = await count("SELECT COUNT(*) AS n FROM events");
  const agentsBefore = await count("SELECT COUNT(*) AS n FROM agents");

  // ===================== CALLBACKS =====================
  const cbRow = (i: number) => ({
    vehicle_reg: `KBB ${String(100 + i)}A`,
    client_name: `Client ${i}`,
    client_phone: `0733${String(100000 + i).padStart(6, "0")}`,
    customer_email: "",
    channel_partner: "Partner",
    initiated_date: "2026-01-01",
    reason: "x",
  });
  const cbRows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => cbRow(from + k));

  // Upload A creates 10 records.
  await cb.importCallbackJobs(db, { file_name: "a.xlsx", imported_by: "Caroline", rows: cbRows(1, 10) });
  const importA = Number((await db.queryOne("SELECT MAX(id) AS id FROM callback_imports")).id);
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 10, "10 callback jobs after upload A");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs WHERE created_by_import_id = ?", [importA])) === 10, "upload A is recorded as the creator of all 10");
  assert((await count("SELECT COUNT(*) AS n FROM callback_job_phones")) >= 10, "phone numbers were stored");

  // Record 9 had an earlier outcome and stays open. Record 1 has been worked by an agent.
  const jobOf = async (i: number) => Number((await db.queryOne("SELECT id FROM callback_jobs WHERE vehicle_reg = ?", [cb.normalizeVehicleReg ? cb.normalizeVehicleReg(cbRow(i).vehicle_reg) : cbRow(i).vehicle_reg.replace(/\s+/g, "")])).id);
  const j9 = await jobOf(9);
  await db.execute("INSERT INTO callback_job_logs (callback_job_id, outcome, comment, logged_by, resulting_status) VALUES (?, 'NOT_PICKING', 'x', 'Kelvin', 'AMBER')", [j9]);
  await db.execute("UPDATE callback_jobs SET latest_outcome = 'NOT_PICKING' WHERE id = ?", [j9]);
  const j1 = await jobOf(1);
  await db.execute("INSERT INTO callback_job_logs (callback_job_id, outcome, comment, logged_by, resulting_status) VALUES (?, 'NOT_PICKING', 'x', 'Kelvin', 'AMBER')", [j1]);

  // Upload B: records 1 to 8 again, two new (11, 12); 9 and 10 are absent and get closed.
  await cb.importCallbackJobs(db, { file_name: "b.xlsx", imported_by: "Caroline", rows: [...cbRows(1, 8), ...cbRows(11, 12)] });
  const importB = Number((await db.queryOne("SELECT MAX(id) AS id FROM callback_imports")).id);
  assert(importB !== importA, "upload B has its own id");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs WHERE created_by_import_id = ?", [importB])) === 2, "upload B created two records");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs WHERE closed_by_import_id = ? AND status = 'GREEN'", [importB])) === 2, "upload B closed two records as absent");

  // Preview
  let pv = await dr.getDataResetPreview(db, "callbacks");
  assert(pv.totals.jobs === 12 && pv.totals.open === 10 && pv.totals.closed === 2, "preview totals are right");
  assert(pv.last_upload.id === importB && pv.last_upload.created_count === 2 && pv.last_upload.closed_absent_count === 2 && pv.last_upload.can_undo === true, "preview describes upload B");
  assert(pv.reset_key_configured === true, "key configured is reported");
  assert(!JSON.stringify(pv).includes(KEY), "preview never contains the key");
  assert((await dr.getDataResetPreview(db, "pending-submissions")).last_upload === null, "pending has no uploads yet");

  // Backup workbook
  const bk = await backup("callbacks");
  const wb = XLSX.read(bk.buffer, { type: "buffer" });
  for (const sheet of ["Records", "Outcome history", "Phone numbers", "Uploads", "About"]) assert(wb.SheetNames.includes(sheet), `backup has the ${sheet} sheet`);
  assert(XLSX.utils.sheet_to_json(wb.Sheets["Records"]).length === 12, "backup lists all 12 records");
  assert(/^callbacks-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.xlsx$/.test(bk.filename), "backup file name is dated");

  // Undo safeguards
  assert((await statusOf(() => dr.undoLastUpload(db, "callbacks", { reset_key: "wrong", confirm_phrase: "REMOVE LAST UPLOAD", backup_token: bk.token }))) === 403, "undo refuses a wrong key");
  assert((await statusOf(() => dr.undoLastUpload(db, "callbacks", { reset_key: KEY, confirm_phrase: "remove last upload", backup_token: bk.token }))) === 400, "undo needs the exact phrase");
  assert((await statusOf(() => dr.undoLastUpload(db, "callbacks", { reset_key: KEY, confirm_phrase: "REMOVE LAST UPLOAD" }))) === 409, "undo needs a backup");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 12, "nothing changed after the refusals");
  dr.resetThrottleForTests();

  // Undo upload B
  const bk2 = await backup("callbacks");
  const undoB = await dr.undoLastUpload(db, "callbacks", { reset_key: KEY, confirm_phrase: "REMOVE LAST UPLOAD", backup_token: bk2.token });
  assert(undoB.success && undoB.removed_records === 2 && undoB.restored_records === 2, "undo B removed 2 and restored 2");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 10, "back to 10 records");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs WHERE status = 'AMBER'")) === 10, "records 9 and 10 are open again");
  const r9 = await db.queryOne("SELECT status, closed_at, latest_outcome, closed_by_import_id FROM callback_jobs WHERE id = ?", [j9]);
  assert(r9.status === "AMBER" && r9.closed_at === null && r9.latest_outcome === "NOT_PICKING" && r9.closed_by_import_id === null, "record 9 is restored with its earlier outcome");
  const j10 = await jobOf(10);
  assert((await db.queryOne("SELECT latest_outcome AS o FROM callback_jobs WHERE id = ?", [j10])).o === null, "record 10 had no earlier outcome");
  assert((await count("SELECT COUNT(*) AS n FROM callback_job_logs WHERE outcome = 'ABSENT_FROM_LATEST_EXPORT'")) === 0, "the absent log rows are gone");
  assert((await count("SELECT COUNT(*) AS n FROM callback_job_logs WHERE callback_job_id = ?", [j9])) === 1, "record 9 keeps its own history");
  assert((await count("SELECT COUNT(*) AS n FROM callback_job_phones WHERE callback_job_id NOT IN (SELECT id FROM callback_jobs)")) === 0, "no orphaned phone rows");
  assert((await count("SELECT COUNT(*) AS n FROM callback_imports WHERE id = ? AND reverted_at IS NOT NULL", [importB])) === 1, "upload B is flagged reverted but kept");
  assert((await count("SELECT COUNT(*) AS n FROM callback_imports")) === 2, "upload history rows are kept");
  assert((await count("SELECT COUNT(*) AS n FROM settings_change_log WHERE setting_key = 'data_reset.callbacks.undo_last_upload'")) === 1, "undo is audited");
  pv = await dr.getDataResetPreview(db, "callbacks");
  assert(pv.last_upload.id === importA, "upload A is now the latest");

  // The backup token is single use
  assert((await statusOf(() => dr.undoLastUpload(db, "callbacks", { reset_key: KEY, confirm_phrase: "REMOVE LAST UPLOAD", backup_token: bk2.token }))) === 409, "a used backup token is refused");

  // Upload A has a worked record (record 1 has an agent outcome): needs explicit consent
  assert(pv.last_upload.worked_created_count >= 1, "worked records are counted");
  const bk3 = await backup("callbacks");
  const blocked = await statusOf(() => dr.undoLastUpload(db, "callbacks", { reset_key: KEY, confirm_phrase: "REMOVE LAST UPLOAD", backup_token: bk3.token }));
  assert(blocked === 409, "worked records block the undo until confirmed");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 10, "nothing was deleted");
  const bk4 = await backup("callbacks");
  const undoA = await dr.undoLastUpload(db, "callbacks", { reset_key: KEY, confirm_phrase: "REMOVE LAST UPLOAD", backup_token: bk4.token, allow_worked: true });
  assert(undoA.removed_records === 10, "undo A removed all 10");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 0 && (await count("SELECT COUNT(*) AS n FROM callback_job_logs")) === 0 && (await count("SELECT COUNT(*) AS n FROM callback_job_phones")) === 0, "callbacks is empty");
  assert((await statusOf(() => dr.undoLastUpload(db, "callbacks", { reset_key: KEY, confirm_phrase: "REMOVE LAST UPLOAD", backup_token: "x" }))) === 409, "nothing left to undo");

  // Delete all (callbacks): safeguards first
  await cb.importCallbackJobs(db, { file_name: "c.xlsx", imported_by: "Caroline", rows: cbRows(1, 6) });
  const total = await count("SELECT COUNT(*) AS n FROM callback_jobs");
  assert(total === 6, "six records to delete");
  const phrase = "DELETE ALL CALLBACKS";
  const bkd = await backup("callbacks");
  const base = { reset_key: KEY, confirm_phrase: phrase, confirm_count: String(total), backup_token: bkd.token };
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { ...base, reset_key: "nope" }))) === 403, "delete refuses a wrong key");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { ...base, confirm_phrase: "DELETE ALL" }))) === 400, "delete needs the exact phrase");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { ...base, confirm_phrase: "DELETE ALL PENDING SUBMISSIONS" }))) === 400, "the other section's phrase does not work");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { ...base, confirm_count: "5" }))) === 400, "delete needs the exact record count");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { ...base, backup_token: "" }))) === 409, "delete needs a backup");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 6, "nothing deleted after refusals");
  // Data changes after the backup: the backup no longer matches
  await db.execute("INSERT INTO callback_job_logs (callback_job_id, outcome, comment, logged_by, resulting_status) SELECT id, 'NOT_PICKING', 'x', 'Kelvin', 'AMBER' FROM callback_jobs LIMIT 1");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", base))) === 409, "a stale backup is refused");
  dr.resetThrottleForTests();
  const bkd2 = await backup("callbacks");
  // A pending backup cannot be used for callbacks
  const bkPending = await backup("pending-submissions");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { ...base, backup_token: bkPending.token }))) === 409, "another section's backup is refused");
  const del = await dr.deleteAllRecords(db, "callbacks", { ...base, backup_token: bkd2.token });
  assert(del.success && del.deleted_records === 6 && del.deleted_history_rows === 1, "delete all removed 6 records and 1 history row");
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 0 && (await count("SELECT COUNT(*) AS n FROM callback_job_phones")) === 0 && (await count("SELECT COUNT(*) AS n FROM callback_job_logs")) === 0, "all callback data is gone");
  assert((await count("SELECT COUNT(*) AS n FROM callback_imports")) >= 1, "callback upload history is kept");
  assert((await count("SELECT COUNT(*) AS n FROM callback_imports WHERE reverted_at IS NULL")) === 0, "no upload remains undoable");
  assert((await dr.getDataResetPreview(db, "callbacks")).last_upload === null, "no last upload after delete all");
  assert((await count("SELECT COUNT(*) AS n FROM settings_change_log WHERE setting_key = 'data_reset.callbacks.delete_all'")) === 1, "delete all is audited");
  const bkEmpty = await backup("callbacks");
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { ...base, confirm_count: "0", backup_token: bkEmpty.token }))) === 409, "nothing to delete is a 409");

  // Re-upload after a reset works and is undoable again
  await cb.importCallbackJobs(db, { file_name: "d.xlsx", imported_by: "Caroline", rows: cbRows(1, 3) });
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 3, "upload after reset creates records");
  assert((await dr.getDataResetPreview(db, "callbacks")).last_upload.can_undo === true, "the new upload can be undone");
  await db.execute("DELETE FROM callback_job_phones"); await db.execute("DELETE FROM callback_job_logs"); await db.execute("DELETE FROM callback_jobs");

  // ===================== PENDING SUBMISSIONS =====================
  const mk = (id: number) => ({
    external_id: id, solver_name: "Sol", solver_contact: "0700000001", solver_email: "", vehicle_reg: `KAA ${String(1000 + id)}A`,
    insurance_company: "Fidelity", client_phone: `0722${String(100000 + id).padStart(6, "0")}`, customer_email: "", schedule_date: "2026-01-01T00:00:00.000Z", latest_pending_reason: "x",
  });
  const rowsP = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => mk(from + k));

  await ps.importPendingSubmissions(db, "p1.xlsx", "Mary", rowsP(1, 20));
  const p1 = Number((await db.queryOne("SELECT MAX(id) AS id FROM pending_submission_imports")).id);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE created_by_import_id = ?", [p1])) === 20, "pending upload 1 created 20");

  // Upload 2: 1 to 18 plus a new one (21). Records 19 and 20 are absent and closed.
  await ps.importPendingSubmissions(db, "p2.xlsx", "Mary", [...rowsP(1, 18), ...rowsP(21, 21)]);
  const p2 = Number((await db.queryOne("SELECT MAX(id) AS id FROM pending_submission_imports")).id);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE created_by_import_id = ?", [p2])) === 1, "pending upload 2 created 1");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE closed_by_import_id = ? AND status = 'GREEN'", [p2])) === 2, "pending upload 2 closed 2 as absent");
  // Record 19 had been worked before it closed: its earlier outcome must come back.
  const pj19 = Number((await db.queryOne("SELECT id FROM pending_submission_jobs WHERE external_id = 19")).id);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_logs WHERE pending_submission_job_id = ?", [pj19])) >= 1, "record 19 has its absent log");

  let ppv = await dr.getDataResetPreview(db, "pending-submissions");
  assert(ppv.last_upload.id === p2 && ppv.last_upload.created_count === 1 && ppv.last_upload.closed_absent_count === 2, "pending preview describes upload 2");
  assert(ppv.totals.jobs === 21, "21 pending records");

  const pb = await backup("pending-submissions");
  const pwb = XLSX.read(pb.buffer, { type: "buffer" });
  assert(!pwb.SheetNames.includes("Phone numbers"), "pending backup has no phone sheet");
  assert(XLSX.utils.sheet_to_json(pwb.Sheets["Records"]).length === 21, "pending backup lists 21 records");

  const pu = await dr.undoLastUpload(db, "pending-submissions", { reset_key: KEY, confirm_phrase: "REMOVE LAST UPLOAD", backup_token: pb.token });
  assert(pu.removed_records === 1 && pu.restored_records === 2, "pending undo removed 1 and restored 2");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE status = 'AMBER'")) === 20, "20 open pending records again");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE external_id = 21")) === 0, "the new record is gone");

  // Re-uploading the same sheet closes them again, so the undo is repeatable
  await ps.importPendingSubmissions(db, "p3.xlsx", "Mary", [...rowsP(1, 18)]);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE status = 'GREEN'")) === 2, "records 19 and 20 are closed again by a later upload");

  // The user's question: absent, deleted, then present in a later sheet.
  // Delete all, then upload a sheet that contains the records again: they are simply created fresh.
  const pb2 = await backup("pending-submissions");
  const total2 = await count("SELECT COUNT(*) AS n FROM pending_submission_jobs");
  const pdel = await dr.deleteAllRecords(db, "pending-submissions", {
    reset_key: KEY, confirm_phrase: "DELETE ALL PENDING SUBMISSIONS", confirm_count: String(total2), backup_token: pb2.token,
  });
  assert(pdel.deleted_records === total2, "pending delete all removed everything");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_logs")) === 0, "pending history is gone");
  await ps.importPendingSubmissions(db, "p4.xlsx", "Mary", rowsP(1, 20));
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE status = 'AMBER'")) === 20, "the sheet recreates all 20 as open records");

  // Callbacks data was not touched by any pending reset
  await cb.importCallbackJobs(db, { file_name: "e.xlsx", imported_by: "Caroline", rows: cbRows(1, 4) });
  const pb3 = await backup("pending-submissions");
  const t3 = await count("SELECT COUNT(*) AS n FROM pending_submission_jobs");
  await dr.deleteAllRecords(db, "pending-submissions", { reset_key: KEY, confirm_phrase: "DELETE ALL PENDING SUBMISSIONS", confirm_count: String(t3), backup_token: pb3.token });
  assert((await count("SELECT COUNT(*) AS n FROM callback_jobs")) === 4, "a pending reset never touches callbacks");

  // Android events and agents survive everything
  assert((await count("SELECT COUNT(*) AS n FROM events")) === eventsBefore, "Android events are untouched");
  assert((await count("SELECT COUNT(*) AS n FROM agents")) === agentsBefore, "agents are untouched");

  // Feature off without a key
  delete process.env.DATA_RESET_KEY;
  assert((await statusOf(() => dr.deleteAllRecords(db, "callbacks", { reset_key: "anything", confirm_phrase: "DELETE ALL CALLBACKS", confirm_count: "4", backup_token: "x" }))) === 403, "without a configured key the feature refuses");
  assert((await dr.getDataResetPreview(db, "callbacks")).reset_key_configured === false, "preview reports the feature as off");

  console.log("All data reset DB tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// V18 END tests/dataResetDb.test.ts

