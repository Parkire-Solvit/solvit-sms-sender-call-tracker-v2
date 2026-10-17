// V16 tests/pendingAutoAssignDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping pending auto-assignment DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-autoassign-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for automatic assignment and rebalance...");

  const TAG = "Callback Team(Submission)";
  const phoneOf = (i: number) => `0722${String(100000 + i).padStart(6, "0")}`;
  const storedPhoneOf = (i: number) => phoneOf(i).slice(-9); // stored phones keep the last nine digits
  const mk = (id: number, client: string, reg: string) => ({
    external_id: id, solver_name: "Sol", solver_contact: "0700000001", solver_email: "", vehicle_reg: reg,
    insurance_company: "Fidelity", client_phone: client, customer_email: "", schedule_date: "2026-01-01T00:00:00.000Z", latest_pending_reason: "x",
  });

  // 439 customers, the first 20 with two vehicles: 459 open records, and nobody carries the team tag yet.
  const rows: any[] = [];
  let ext = 1;
  const customers = 439;
  for (let c = 1; c <= customers; c++) {
    rows.push(mk(ext++, phoneOf(c), `KAA ${String(c).padStart(4, "0")}A`));
    if (c <= 20) rows.push(mk(ext++, phoneOf(c), `KAA ${String(c).padStart(4, "0")}B`));
  }
  assert(rows.length === 459, "459 rows prepared");
  await ps.importPendingSubmissions(db, "f.xlsx", "Mary", rows);

  const count = async (sql: string, params: unknown[] = []) => Number((await db.queryOne(sql, params)).n);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id IS NULL AND status = 'AMBER'")) === 459, "all 459 start unassigned");

  // With nobody tagged, the sync does nothing and does not fail.
  let r = await ps.syncPendingSubmissionAssignments(db);
  assert(r.assigned === 0 && r.rebalanced === 0 && !r.baseline_set, "no team means no work and no baseline");

  // Kelvin gets the tag. The next sync gives him all 459 and only records the baseline (no rebalance).
  await db.execute("INSERT INTO agents (name, tag) VALUES ('Kelvin', ?)", [TAG]);
  const kelvin = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Kelvin'")).id);
  r = await ps.syncPendingSubmissionAssignments(db);
  assert(r.assigned === 459, `all 459 assigned to the only agent (got ${r.assigned})`);
  assert(r.baseline_set === true && r.team_changed === false && r.rebalanced === 0, "first run records the baseline only");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id = ?", [kelvin])) === 459, "Kelvin holds all 459");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_logs WHERE outcome = 'REASSIGNED_BY_SYSTEM'")) === 459, "each assignment is logged");

  // Running again changes nothing.
  r = await ps.syncPendingSubmissionAssignments(db);
  assert(r.assigned === 0 && r.rebalanced === 0 && !r.team_changed && !r.baseline_set, "second run is a no-op");

  // A re-upload also repairs records that lost their agent.
  await db.execute("UPDATE pending_submission_jobs SET assigned_agent_id = NULL WHERE external_id IN (3, 4, 5)");
  await ps.importPendingSubmissions(db, "f2.xlsx", "Mary", rows);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id IS NULL AND status = 'AMBER'")) === 0, "upload assigns records that had no agent");

  // Make customers 1 to 5 touched by a logged outcome, and customers 6 to 10 touched by a counted outgoing call.
  const jobIdOfCustomer = async (c: number) => Number((await db.queryOne("SELECT id FROM pending_submission_jobs WHERE client_phone = ? ORDER BY id ASC LIMIT 1", [storedPhoneOf(c)])).id);
  for (let c = 1; c <= 5; c++) {
    await ps.logPendingSubmissionOutcome(db, await jobIdOfCustomer(c), { outcome: "CALL_BACK", comment: "Asked to call tomorrow", logged_by: "Kelvin" });
  }
  await new Promise((resolve) => setTimeout(resolve, 1200)); // first_imported_at has one-second resolution
  for (let c = 6; c <= 10; c++) {
    await db.execute("INSERT INTO events (agent_id, type, target_phone, status, reg_no, timestamp) VALUES (?, 'CALL', ?, 'OUTGOING', NULL, ?)",
      [kelvin, phoneOf(c), new Date(Date.now() - 500).toISOString()]);
  }
  // A closed record must never move either.
  const closedJob = await jobIdOfCustomer(400);
  await ps.logPendingSubmissionOutcome(db, closedJob, { outcome: "WITHDRAWN", comment: "Invalid", logged_by: "Kelvin" });

  // Mary joins the team. The next sync rebalances the untouched work.
  await db.execute("INSERT INTO agents (name, tag) VALUES ('Mary', ?)", [TAG]);
  const mary = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Mary'")).id);
  r = await ps.syncPendingSubmissionAssignments(db);
  assert(r.team_changed === true && r.assigned === 0, "team change detected, nothing was orphaned");
  const kOpen = await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id = ? AND status = 'AMBER'", [kelvin]);
  const mOpen = await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id = ? AND status = 'AMBER'", [mary]);
  assert(kOpen + mOpen === 458, `458 records are open (one was closed), got ${kOpen + mOpen}`);
  assert(Math.abs(kOpen - mOpen) <= 2, `loads are within one customer of equal (${kOpen} vs ${mOpen})`);
  assert(mOpen === r.rebalanced, "the number moved equals Mary's load");
  for (let c = 1; c <= 10; c++) {
    const holder = Number((await db.queryOne("SELECT assigned_agent_id AS a FROM pending_submission_jobs WHERE id = ?", [await jobIdOfCustomer(c)])).a);
    assert(holder === kelvin, `touched customer ${c} stays with Kelvin`);
  }
  assert(Number((await db.queryOne("SELECT assigned_agent_id AS a FROM pending_submission_jobs WHERE id = ?", [closedJob])).a) === kelvin, "a closed record is not moved");
  const split = await count(
    `SELECT COUNT(*) AS n FROM (SELECT client_phone FROM pending_submission_jobs WHERE status = 'AMBER' GROUP BY client_phone HAVING COUNT(DISTINCT assigned_agent_id) > 1) t`
  );
  assert(split === 0, "no customer is split across agents");
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_logs WHERE outcome = 'REASSIGNED_BY_SYSTEM' AND comment LIKE 'Moved automatically%'")) === r.rebalanced, "every move is logged");

  // Idempotent: the same team does not trigger another rebalance.
  r = await ps.syncPendingSubmissionAssignments(db);
  assert(r.rebalanced === 0 && !r.team_changed, "no rebalance while the team is unchanged");

  // Work done after the rebalance never triggers a rebalance on its own.
  await ps.importPendingSubmissions(db, "f3.xlsx", "Mary", rows);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id = ? AND status = 'AMBER'", [mary])) === mOpen, "an upload with the same team does not shuffle work");

  // Mary leaves the team. Her records go back to Kelvin, the only active agent. No rebalance with one agent.
  await db.execute("UPDATE agents SET tag = 'Someone Else' WHERE id = ?", [mary]);
  r = await ps.syncPendingSubmissionAssignments(db);
  assert(r.assigned === mOpen && r.rebalanced === 0 && r.team_changed === true, `Mary's ${mOpen} records return to Kelvin`);
  assert((await count("SELECT COUNT(*) AS n FROM pending_submission_jobs WHERE assigned_agent_id = ? AND status = 'AMBER'", [kelvin])) === 458, "Kelvin holds all 458 open records again");

  // The overview shows a healthy team afterwards.
  const team = await ps.getPendingSubmissionTeam(db);
  assert(team.unassigned_open_count === 0 && team.orphaned_open_count === 0, "no record is left without an active agent");

  console.log("All automatic assignment and rebalance DB integration tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// V16 END tests/pendingAutoAssignDb.test.ts

