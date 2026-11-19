// tests/channelPartnerAllocationDb.test.ts
// Channel partner agent allocations (Pending Scheduling team settings): a partner that has never been allocated
// can be given an agent, changed and cleared, and its open callbacks follow. The startup re-seed that overwrote
// the team's choices is gone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping channel partner allocation DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "cpa-test-")));
  const { initDatabase } = await import(pathToFileURL(path.join(root, "db.ts")).href);
  const cb = await import(pathToFileURL(path.join(root, "insuranceCallbacks.ts")).href);
  const db = await initDatabase();

  console.log("Running DB integration tests for channel partner allocations...");

  await db.execute("INSERT INTO agents (name, tag) VALUES ('Carol', 'Callback Team'), ('Mercy', 'Callback Team')");
  const idOf = async (name: string) => Number((await db.queryOne("SELECT id FROM agents WHERE name = ?", [name])).id);
  const carol = await idOf("Carol");
  const mercy = await idOf("Mercy");
  const addJob = (reg: string, status: string) =>
    db.execute(
      `INSERT INTO callback_jobs (vehicle_reg, vehicle_reg_raw, client_name, client_phone, client_phone_raw, channel_partner, status)
       VALUES (?, ?, 'Client', '722000001', '722000001', 'Bolttech Services Kenya', ?)`,
      [reg, reg, status]
    );
  await addJob("KAA001A", "AMBER");
  await addJob("KAA002A", "GREEN");

  const bolttech = async () =>
    (await cb.getChannelPartnerAllocations(db)).allocations.find((a: any) => a.channel_partner === "Bolttech Services Kenya");
  const jobAgent = async (reg: string) => {
    const row = await db.queryOne("SELECT assigned_agent_id FROM callback_jobs WHERE vehicle_reg = ?", [reg]);
    return row.assigned_agent_id === null ? null : Number(row.assigned_agent_id);
  };

  // 1. A partner seen only in uploads (never allocated) is listed as unallocated.
  const before = await cb.getChannelPartnerAllocations(db);
  assert(before.unallocated_partners.includes("Bolttech Services Kenya"), "the new partner is listed as unallocated");

  // 2. First allocation: this used to fail with "column id does not exist".
  await cb.setChannelPartnerAllocation(db, "Bolttech Services Kenya", carol);
  assert(Number((await bolttech()).assigned_agent_id) === carol, "the first allocation is saved");
  assert(!(await cb.getChannelPartnerAllocations(db)).unallocated_partners.includes("Bolttech Services Kenya"), "it is no longer unallocated");
  assert((await jobAgent("KAA001A")) === carol, "the open callback moves to the agent");
  assert((await jobAgent("KAA002A")) === null, "closed callbacks are not touched");

  // 3. Change and clear.
  await cb.setChannelPartnerAllocation(db, "Bolttech Services Kenya", mercy);
  assert(Number((await bolttech()).assigned_agent_id) === mercy && (await jobAgent("KAA001A")) === mercy, "changing the agent works");
  await cb.setChannelPartnerAllocation(db, "Bolttech Services Kenya", null);
  assert((await bolttech()).assigned_agent_id === null, "clearing the agent works");
  const count = await db.queryOne("SELECT COUNT(*) AS n FROM channel_partner_allocations WHERE channel_partner = 'Bolttech Services Kenya'");
  assert(Number(count.n) === 1, "one row per partner, never duplicated");

  // 4. The startup re-seed no longer exists, so nothing can overwrite these choices or create agents.
  assert(cb.seedChannelPartnerAllocations === undefined, "the startup re-seed is removed");

  console.log("All channel partner allocation DB tests passed!");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
