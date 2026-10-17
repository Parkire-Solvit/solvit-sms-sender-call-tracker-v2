// FIXPASS tests/solverNotificationsDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
async function expectHttp(status: number, label: string, fn: () => Promise<unknown>, HttpError: any) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof HttpError && (e as any).status === status, `${label}: expected HTTP ${status}, got ${(e as any)?.status ?? e}`);
    return;
  }
  throw new Error(`Assertion failed: ${label}: expected HTTP ${status} but nothing was thrown`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping solver notifications DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sn-db-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  for (const k of ["HOST_PINNACLE_API_KEY", "HOST_PINNACLE_USER_ID", "HOST_PINNACLE_PASSWORD", "HOST_PINNACLE_SENDER_ID", "HOST_PINNACLE_COUNTRY_CODE"]) delete process.env[k];
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const is = await import(path.join(root, "integrationSettings.ts"));
  const sn = await import(path.join(root, "solverNotifications.ts"));
  const { HttpError } = await import(path.join(root, "httpError.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for solver notifications and integrations...");

  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Alice", "Callback Team(Submission)"]);
  const mk = (id: number, client: string, solver: string, reg: string) => ({
    external_id: id, solver_name: "Sol " + id, solver_contact: solver, solver_email: "", vehicle_reg: reg,
    insurance_company: "Fidelity", client_phone: client, customer_email: "", schedule_date: "2026-01-01T00:00:00.000Z", latest_pending_reason: "x",
  });
  await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [
    mk(1, "0722111001", "0700000001", "KAA 001A"),
    mk(2, "0722111002", "0700000002", "KAA 002A"),
    mk(3, "0722111003", "0700000003", "KAA 003A"),
    mk(4, "0722111004", "0700000004", "KAA 004A"),
    mk(5, "0722111005", "123", "KAA 005A"), // invalid solver number
    mk(6, "0722111006", "0700000006", "KAA 006A"), // stays AMBER
  ]);
  const idOf = async (ext: number) => Number((await db.queryOne("SELECT id FROM pending_submission_jobs WHERE external_id = ?", [ext])).id);
  const schedule = async (ext: number) =>
    ps.logPendingSubmissionOutcome(db, await idOf(ext), { outcome: "SCHEDULED", comment: "Agreed with client", logged_by: "Mary", scheduled_at: "2026-10-14T10:30:00+03:00", scheduled_place: "Westlands" });
  for (const e of [1, 2, 3, 4, 5]) await schedule(e);
  const view = async (ext: number) => ps.getPendingSubmissionJobById(db, await idOf(ext));

  // ---------- integrations ----------
  let pub: any = await is.getIntegrationPublicView(db, "host_pinnacle");
  assert(pub.ready === false && pub.fields.enabled.value === false, "starts disabled");
  assert(pub.fields.api_key.configured === false, "api key not configured");
  assert(pub.fields.country_code.value === "254", "country code default");

  await expectHttp(400, "unknown key", () => is.updateIntegrationSettings(db, "host_pinnacle", { bogus: 1 }), HttpError);
  await expectHttp(400, "bad country code", () => is.updateIntegrationSettings(db, "host_pinnacle", { country_code: "+254" }), HttpError);
  await expectHttp(400, "bad auth mode", () => is.updateIntegrationSettings(db, "host_pinnacle", { auth_mode: "magic" }), HttpError);
  await expectHttp(400, "enabled must be boolean", () => is.updateIntegrationSettings(db, "host_pinnacle", { enabled: "yes" }), HttpError);
  await expectHttp(400, "cannot clear enabled", () => is.updateIntegrationSettings(db, "host_pinnacle", { clear: ["enabled"] }), HttpError);
  await expectHttp(404, "unknown integration", () => is.updateIntegrationSettings(db, "nope", {}), HttpError);

  const SECRET = "KEY-abcdef-1234567890";
  pub = await is.updateIntegrationSettings(db, "host_pinnacle", { api_key: SECRET, sender_id: "SOLVIT", enabled: true });
  assert(pub.ready === true && pub.fields.api_key.configured === true, "ready after configuring");
  assert(!JSON.stringify(pub).includes(SECRET), "secret never returned");

  pub = await is.updateIntegrationSettings(db, "host_pinnacle", { api_key: "   ", sender_id: "SOLVIT" });
  assert(pub.fields.api_key.configured === true, "blank secret keeps the stored value");

  let logs = await db.queryAll("SELECT setting_key, old_value, new_value FROM settings_change_log WHERE setting_key LIKE 'integration.%'");
  assert(logs.length >= 3, "changes logged");
  assert(!JSON.stringify(logs).includes(SECRET), "secret never in the change log");
  assert(logs.some((l: any) => l.setting_key === "integration.host_pinnacle.api_key" && l.new_value === "[CONFIGURED]"), "[CONFIGURED] marker");

  const raw = await db.queryOne("SELECT setting_value FROM integration_settings WHERE integration = 'host_pinnacle' AND setting_key = 'api_key'");
  assert(raw.setting_value === SECRET, "stored in plaintext when no encryption key is set (documented)");

  // ---------- encryption at rest ----------
  process.env.SETTINGS_ENCRYPTION_KEY = "x".repeat(40);
  await is.updateIntegrationSettings(db, "host_pinnacle", { api_key: SECRET });
  const enc = await db.queryOne("SELECT setting_value FROM integration_settings WHERE integration = 'host_pinnacle' AND setting_key = 'api_key'");
  assert(String(enc.setting_value).startsWith("enc:v1:") && !String(enc.setting_value).includes(SECRET), "encrypted at rest");
  const resolved = await is.getHostPinnacleConfig(db);
  assert(resolved.config.apiKey === SECRET, "decrypts back to the original");
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  let threw = false;
  try { await is.getHostPinnacleConfig(db); } catch { threw = true; }
  assert(threw, "reading an encrypted secret without the key fails loudly");
  process.env.SETTINGS_ENCRYPTION_KEY = "x".repeat(40);
  await is.updateIntegrationSettings(db, "host_pinnacle", { api_key: SECRET }); // keep ready for next tests
  process.env.SETTINGS_ENCRYPTION_KEY = "x".repeat(40);

  // ---------- notify: success, skip, resend, cap ----------
  const calls: Array<{ number: string; message: string }> = [];
  const okSend = async (_c: any, number: string, message: string) => { calls.push({ number, message }); return { ok: true, transactionId: "TX" + calls.length, error: null, deliveryUnknown: false }; };

  let r = await sn.notifySolver(db, await idOf(1), "auto", okSend);
  assert(r.status === "SENT", "auto send succeeds");
  assert(calls.length === 1 && calls[0].number === "700000001", "sent to the solver number");
  assert(calls[0].message.includes("Wed 14 Oct 2026, 10:30 AM") && calls[0].message.includes("KAA 001A") && calls[0].message.includes("Westlands"), "message rendered in Nairobi time");
  let v: any = await view(1);
  assert(v.solver_notification_status === "SENT" && Number(v.solver_notification_attempts) === 1 && v.solver_notification_transaction_id === "TX1", "job shows SENT, attempt 1, transaction id");
  assert(v.solver_notification_error === null && !!v.solver_notified_at, "error cleared, notified_at set");

  r = await sn.notifySolver(db, await idOf(1), "auto", okSend);
  assert(r.status === "SKIPPED" && calls.length === 1, "auto never sends twice");

  r = await sn.notifySolver(db, await idOf(1), "manual", okSend);
  assert(r.status === "SENT" && calls.length === 2, "manual resend works");

  await ps.updatePendingSubmissionSettings(db, { solver_sms_max_resends: 1 });
  await expectHttp(409, "resend cap reached", async () => sn.notifySolver(db, await idOf(1), "manual", okSend), HttpError);
  await ps.updatePendingSubmissionSettings(db, { solver_sms_max_resends: 3 });

  // ---------- failure, retry, thrown error ----------
  const failSend = async () => ({ ok: false, transactionId: null, error: "Insufficient balance", deliveryUnknown: false });
  r = await sn.notifySolver(db, await idOf(2), "auto", failSend);
  assert(r.status === "FAILED", "provider failure -> FAILED");
  v = await view(2);
  assert(v.solver_notification_status === "FAILED" && v.solver_notification_error === "Insufficient balance" && Number(v.solver_notification_attempts) === 1, "failure stored");
  r = await sn.notifySolver(db, await idOf(2), "manual", okSend);
  assert(r.status === "SENT", "retry after failure succeeds");

  const boom = async () => { throw new Error("kaboom SECRET"); };
  r = await sn.notifySolver(db, await idOf(3), "auto", boom);
  v = await view(3);
  assert(r.status === "FAILED" && v.solver_notification_status === "FAILED", "thrown error ends FAILED, never stuck in SENDING");
  assert(!String(v.solver_notification_error).includes("kaboom"), "internal error text not stored");

  // ---------- concurrency ----------
  let slowCalls = 0;
  const slowSend = async () => { slowCalls++; await new Promise((res) => setTimeout(res, 150)); return { ok: true, transactionId: "SLOW", error: null, deliveryUnknown: false }; };
  const id4 = await idOf(4);
  const results = await Promise.allSettled([sn.notifySolver(db, id4, "manual", slowSend), sn.notifySolver(db, id4, "manual", slowSend)]);
  const okCount = results.filter((x) => x.status === "fulfilled").length;
  const conflict = results.filter((x) => x.status === "rejected" && (x as any).reason?.status === 409).length;
  assert(okCount === 1 && conflict === 1 && slowCalls === 1, `exactly one concurrent send (ok=${okCount}, conflict=${conflict}, calls=${slowCalls})`);

  // ---------- stale claim ----------
  await db.execute("UPDATE pending_submission_jobs SET solver_notification_status = 'SENDING', solver_notification_attempted_at = ?, solver_notification_attempts = 1 WHERE external_id = 4", [new Date().toISOString()]);
  await expectHttp(409, "fresh SENDING blocks", async () => sn.notifySolver(db, id4, "manual", okSend), HttpError);
  await db.execute("UPDATE pending_submission_jobs SET solver_notification_attempted_at = ? WHERE external_id = 4", [new Date(Date.now() - 10 * 60 * 1000).toISOString()]);
  r = await sn.notifySolver(db, id4, "manual", okSend);
  assert(r.status === "SENT", "stale SENDING (10 min) can be taken over");

  // ---------- guard rails ----------
  await expectHttp(404, "unknown job", async () => sn.notifySolver(db, 999999, "manual", okSend), HttpError);
  await expectHttp(409, "AMBER job cannot be notified", async () => sn.notifySolver(db, await idOf(6), "manual", okSend), HttpError);
  const before = calls.length;
  r = await sn.notifySolver(db, await idOf(5), "manual", okSend);
  assert(r.status === "FAILED" && calls.length === before, "invalid solver number fails without calling the provider");
  v = await view(5);
  assert(Number(v.solver_notification_attempts) === 0, "invalid number does not consume an attempt");

  // ---------- integration not ready ----------
  await is.updateIntegrationSettings(db, "host_pinnacle", { enabled: false });
  await db.execute("UPDATE pending_submission_jobs SET solver_notification_status = NULL, solver_notification_attempts = 0, solver_notification_error = NULL WHERE external_id = 5");
  await db.execute("UPDATE pending_submission_jobs SET solver_contact = '0700000005' WHERE external_id = 5");
  const calls0 = calls.length;
  r = await sn.notifySolver(db, await idOf(5), "auto", okSend);
  v = await view(5);
  assert(r.status === "FAILED" && /not enabled/i.test(r.message) && calls.length === calls0, "disabled integration: FAILED, provider not called");
  assert(v.solver_notification_status === "FAILED" && Number(v.solver_notification_attempts) === 0, "visible as FAILED, attempts untouched");
  await is.updateIntegrationSettings(db, "host_pinnacle", { enabled: true });
  r = await sn.notifySolver(db, await idOf(5), "manual", okSend);
  assert(r.status === "SENT", "after enabling, manual send works");

  // ---------- auto-send switch ----------
  await ps.updatePendingSubmissionSettings(db, { solver_sms_auto_send: false });
  await db.execute("UPDATE pending_submission_jobs SET solver_notification_status = NULL WHERE external_id = 3");
  r = await sn.notifySolver(db, await idOf(3), "auto", okSend);
  assert(r.status === "SKIPPED", "auto-send off -> skipped");

  // ---------- clear ----------
  pub = await is.updateIntegrationSettings(db, "host_pinnacle", { clear: ["api_key"] });
  assert(pub.fields.api_key.configured === false && pub.ready === false && pub.missing.includes("api_key"), "clear removes the secret");
  logs = await db.queryAll("SELECT new_value FROM settings_change_log WHERE setting_key = 'integration.host_pinnacle.api_key'");
  assert(logs.some((l: any) => l.new_value === "[CLEARED]"), "[CLEARED] marker");

  // ---------- environment fallback ----------
  process.env.HOST_PINNACLE_API_KEY = "ENV-KEY-123456";
  pub = await is.getIntegrationPublicView(db, "host_pinnacle");
  assert(pub.fields.api_key.configured === true && pub.fields.api_key.source === "environment", "env fallback is honoured");
  assert(!JSON.stringify(pub).includes("ENV-KEY-123456"), "env secret never returned");
  delete process.env.HOST_PINNACLE_API_KEY;

  console.log("All solver notification and integration DB tests passed!");
}
main().catch((e) => { console.error(e); process.exit(1); });
// FIXPASS END tests/solverNotificationsDb.test.ts

