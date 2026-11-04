import assert from "node:assert/strict";
import test from "node:test";
import { createAgent } from "../agentManagement";
import { HttpError } from "../httpError";

function fakeDb(existing: any = null) {
  const inserts: any[] = [];
  return {
    inserts,
    db: {
      async queryOne() { return existing; },
      async queryAll() { return []; },
      async execute(_sql: string, params: any[]) { inserts.push(params); return { lastInsertId: 12, affectedRows: 1 }; },
      async transaction(work: any) { return work(this); },
    } as any,
  };
}

test("creates a callback agent with a cleaned phone number", async () => {
  const f = fakeDb();
  const created = await createAgent(f.db, { name: "  Martin  N. ", phone_number: "+254 712 345 678", tag: "Callback Team" });
  assert.deepEqual(created, { id: 12, name: "Martin N.", phone_number: "+254712345678", tag: "Callback Team" });
  assert.deepEqual(f.inserts[0], ["Martin N.", "+254712345678", "Callback Team"]);
});

test("rejects duplicate names regardless of casing", async () => {
  const f = fakeDb({ id: 4, archived_at: null });
  await assert.rejects(() => createAgent(f.db, { name: "martin" }), (err: any) => err instanceof HttpError && err.status === 409);
});

test("rejects short phone numbers", async () => {
  const f = fakeDb();
  await assert.rejects(() => createAgent(f.db, { name: "Martin", phone_number: "123" }), (err: any) => err instanceof HttpError && err.status === 400);
});
