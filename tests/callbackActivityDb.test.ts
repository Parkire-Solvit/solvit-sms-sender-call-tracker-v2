// tests/callbackActivityDb.test.ts
// Callback call and SMS counting against a real database: the matching rules, single-record recounts that agree with
// the full list, and a guard against the "every event checked against every job" slowdown that stalled saves.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping callback activity DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "cb-activity-test-")));
  const load = (f: string) => import(pathToFileURL(path.join(root, f)).href);
  const { initDatabase } = await load("db.ts");
  const cb = await load("insuranceCallbacks.ts");
  const db = await initDatabase();
  console.log("Running DB integration tests for callback activity counting...");

  await db.execute("INSERT INTO agents (name, tag) VALUES ('Mercy', 'Callback Team'), ('Carol', 'Callback Team'), ('Other', 'Sales')");
  const id = async (name: string) => Number((await db.queryOne("SELECT id FROM agents WHERE name = ?", [name])).id);
  const mercy = await id("Mercy"), carol = await id("Carol"), other = await id("Other");
  await cb.importCallbackJobs(db, { file_name: "a.xlsx", imported_by: "T", confirmed: true, rows: [
    { vehicle_reg: "KAA 001A", client_name: "A", client_phone: "0722000001", customer_email: "", channel_partner: "P", initiated_date: "2026-09-01", reason: "x" },
    { vehicle_reg: "KAA 002A", client_name: "B", client_phone: "0722000002 / 0733000002", customer_email: "", channel_partner: "P", initiated_date: "2026-09-01", reason: "x" },
    { vehicle_reg: "KAA 003A", client_name: "A", client_phone: "0722000001", customer_email: "", channel_partner: "P", initiated_date: "2026-09-01", reason: "x" }, // same customer as job 1
  ] });
  const job = async (reg: string) => db.queryOne("SELECT id, vehicle_reg, client_phone, assigned_agent_id FROM callback_jobs WHERE vehicle_reg = ?", [reg]);
  const j1 = await job("KAA001A"), j2 = await job("KAA002A"), j3 = await job("KAA003A");
  const t = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const ev = (agent: number, type: string, status: string | null, phone: string, m: number, reg: string | null = null) =>
    db.execute("INSERT INTO events (agent_id, type, target_phone, status, timestamp, reg_no) VALUES (?, ?, ?, ?, ?, ?)", [agent, type, phone, status, t(m), reg]);

  await ev(mercy, "CALL", "OUTGOING", "+254722000001", 50);       // job 1 and job 3 (same number)
  await ev(carol, "Phone Call", "dialled", "0722000001", 40);      // another team agent, mixed-case labels: still counts
  await ev(mercy, "CALL", "INCOMING", "0722000001", 30);           // incoming: never counts
  await ev(other, "CALL", "OUTGOING", "0722000001", 20);           // not on the callback team: never counts
  await ev(mercy, "CALL", "OUTGOING", "0733000002", 45);           // job 2's second number
  await ev(mercy, "SMS", "SENT", "0799999999", 44, "KAA-002A");    // SMS matched by registration only
  await ev(mercy, "sms", "Sent", "0722000002", 43, "KAA 002A");    // phone AND registration: counted once
  await ev(mercy, "SMS", "SENT", "0722000001", 42);                // job 1 and job 3
  await ev(mercy, "CALL", "OUTGOING", "0700000000", 41);           // unrelated number
  await db.execute("UPDATE callback_jobs SET assigned_agent_id = ? WHERE id = ?", [carol, j1.id]); // reassignment keeps history

  const all = await cb.computeCallbackJobsActivity(db, [j1, j2, j3]);
  const a1 = all.get(j1.id), a2 = all.get(j2.id), a3 = all.get(j3.id);
  assert(a1.attempt_count === 2 && a1.sms_count === 1, `job 1: two team calls, one SMS (got ${a1.attempt_count}/${a1.sms_count})`);
  assert(a3.attempt_count === 2 && a3.sms_count === 1, `job 3 shares the number: same counts (got ${a3.attempt_count}/${a3.sms_count})`);
  assert(a2.attempt_count === 1 && a2.sms_count === 2, `job 2: call to its second number, SMS by registration and by phone (got ${a2.attempt_count}/${a2.sms_count})`);
  assert(a1.last_attempt_at !== null, "the last attempt time is recorded");

  // A recount of one record (as after a save) agrees with the full list.
  for (const j of [j1, j2, j3]) {
    const one = (await cb.computeCallbackJobsActivity(db, [j])).get(j.id);
    const full = all.get(j.id);
    assert(one.attempt_count === full.attempt_count && one.sms_count === full.sms_count && String(one.last_attempt_at) === String(full.last_attempt_at), `single-record recount of ${j.vehicle_reg} matches the full list`);
  }

  // A saved outcome returns only that record, with the same counts the list shows.
  const saved = await cb.logCallbackOutcome(db, Number(j2.id), "NOT_PICKING", "", "Mercy");
  assert(Number(saved.id) === Number(j2.id), "the save returns the saved record");
  const listed = (await cb.getCallbackJobs(db, {})).find((x: any) => Number(x.id) === Number(j2.id));
  assert(saved.attempt_count === listed.attempt_count && saved.sms_count === listed.sms_count, "the save and the list agree on the counts");
  assert((await cb.getCallbackJobs(db, { id: Number(j1.id) })).length === 1, "the list can return a single record");

  // Speed guard: 3,000 jobs and 30,000 events must be counted quickly. Checking every event against every job
  // (the slowdown that stalled saves) takes several seconds here.
  await db.execute(`INSERT INTO callback_jobs (vehicle_reg, vehicle_reg_raw, client_name, client_phone, client_phone_raw, channel_partner, status)
                    SELECT 'KZZ' || g, 'KZZ ' || g, 'C', '7' || LPAD((10000000 + g)::text, 8, '0'), '07' || LPAD((10000000 + g)::text, 8, '0'), 'P', 'AMBER'
                    FROM generate_series(1, 3000) g`);
  await db.execute(`INSERT INTO events (agent_id, type, target_phone, status, timestamp)
                    SELECT ?, CASE WHEN g % 3 = 0 THEN 'SMS' ELSE 'CALL' END, '07' || LPAD((10000000 + g % 3000)::text, 8, '0'),
                           CASE WHEN g % 3 = 0 THEN 'SENT' ELSE 'OUTGOING' END, NOW() - g * INTERVAL '1 second'
                    FROM generate_series(1, 30000) g`, [mercy]);
  const many = await db.queryAll("SELECT id, vehicle_reg, client_phone, assigned_agent_id FROM callback_jobs");
  const started = performance.now();
  const big = await cb.computeCallbackJobsActivity(db, many);
  const ms = performance.now() - started;
  const sample = big.get(many.find((m: any) => m.vehicle_reg === "KZZ1").id);
  assert(sample.attempt_count + sample.sms_count === 10, `each bulk job gets its 10 events (got ${sample.attempt_count + sample.sms_count})`);
  assert(ms < 3000, `3,000 jobs and 30,000 events are counted in under 3 seconds (took ${ms.toFixed(0)} ms)`);

  console.log(`All callback activity DB tests passed! (bulk count ${ms.toFixed(0)} ms)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
