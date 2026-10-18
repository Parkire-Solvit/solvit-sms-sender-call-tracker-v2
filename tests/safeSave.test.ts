// V18 tests/safeSave.test.ts
import {
  configureSafeSave,
  saveOutcome,
  flushQueue,
  getSaveState,
  pingSession,
  reloadFromStorage,
} from "../src/lib/safeSave";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

function reply(status: number, body: string, contentType = "application/json") {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

async function main() {
  console.log("Running safe save tests...");
  const storage = new MemoryStorage();
  let clock = 1_000_000;
  let counter = 0;
  const sent: Array<{ url: string; body: any }> = [];
  let handler: (url: string, body: any) => Promise<Response> = async () => reply(200, JSON.stringify({ success: true }));
  const fetchFn = async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    sent.push({ url, body });
    return handler(url, body);
  };
  const setup = () => {
    storage.data.clear();
    sent.length = 0;
    counter = 0;
    configureSafeSave({ fetchFn, storage, now: () => clock, newId: () => `id${String(++counter).padStart(14, "0")}`, timeoutMs: 2000 });
  };
  const URL1 = "/api/pending-submissions/jobs/5/log";
  const body1 = { outcome: "CALL_BACK", comment: "", logged_by: "Mary" };

  // 1. Success: confirmed by the server, queue is empty, the id is sent.
  setup();
  let r = await saveOutcome(URL1, body1, "KAA 001A");
  assert(r.ok && !r.queued && r.error === null, "a confirmed save is ok");
  assert(sent.length === 1 && sent[0].body.client_request_id === "id00000000000001", "the request carries a client_request_id");
  assert(getSaveState().pending.length === 0 && storage.getItem("solvit_unsaved_outcomes_v1") === null, "nothing is left in the queue or in storage");

  // 2. Network failure: not saved, kept on the device, and the message says so.
  setup();
  handler = async () => {
    throw new Error("network down");
  };
  r = await saveOutcome(URL1, body1, "KAA 001A");
  assert(!r.ok && r.queued && !r.auth, "a network failure is reported as not saved and queued");
  assert(/Not saved yet/.test(r.error || "") && /kept on this device/.test(r.error || ""), "the message is honest");
  assert(getSaveState().pending.length === 1 && storage.getItem("solvit_unsaved_outcomes_v1") !== null, "the outcome is stored in the browser");

  // 3. Retry of the same form reuses the same id and does not add a second entry.
  handler = async () => {
    throw new Error("still down");
  };
  await saveOutcome(URL1, body1, "KAA 001A");
  assert(getSaveState().pending.length === 1, "retry does not duplicate the queue entry");
  assert(sent[sent.length - 1].body.client_request_id === sent[sent.length - 2].body.client_request_id, "retry reuses the same id");

  // 4. A different body is a different outcome.
  await saveOutcome(URL1, { ...body1, comment: "Asked to call tomorrow" }, "KAA 001A");
  assert(getSaveState().pending.length === 2, "a changed outcome is a separate entry");

  // 5. Reload: the queue is restored from storage and flushed with the SAME ids.
  const idsBefore = getSaveState().pending.map((e) => e.id).sort();
  reloadFromStorage();
  assert(getSaveState().pending.length === 2, "the queue survives a page reload");
  sent.length = 0;
  handler = async () => reply(200, JSON.stringify({ success: true }));
  await flushQueue();
  assert(getSaveState().pending.length === 0, "flush empties the queue after the server confirms");
  assert(sent.map((s) => s.body.client_request_id).sort().join() === idsBefore.join(), "the saved copies are sent with their original ids");

  // 6. Sign-in problems: 401, the exact external banner text, and an HTML page that answers 200.
  for (const [label, make] of [
    ["401 json", () => reply(401, JSON.stringify({ error: "Authentication required" }))],
    ["403", () => reply(403, "Forbidden", "text/plain")],
    ["authentication text on a 200", () => reply(200, "<html>Authentication required</html>", "text/html")],
    ["html page on a 200", () => reply(200, "<html><body>Please sign in</body></html>", "text/html")],
  ] as Array<[string, () => Response]>) {
    setup();
    handler = async () => make();
    r = await saveOutcome(URL1, body1, "KAA 001A");
    assert(!r.ok && r.queued && r.auth, `${label}: reported as signed out and queued`);
    assert(getSaveState().authProblem === true, `${label}: the signed-out state is raised`);
  }

  // 7. Permanent refusals are not queued (the agent sees the real reason and can fix it).
  for (const status of [400, 404, 409]) {
    setup();
    handler = async () => reply(status, JSON.stringify({ error: `refused ${status}` }));
    r = await saveOutcome(URL1, body1, "KAA 001A");
    assert(!r.ok && !r.queued && r.error === `refused ${status}`, `${status} is permanent with the server's reason`);
    assert(getSaveState().pending.length === 0, `${status} leaves nothing queued`);
  }

  // 8. Server errors are temporary.
  setup();
  handler = async () => reply(502, "Bad gateway", "text/plain");
  r = await saveOutcome(URL1, body1, "KAA 001A");
  assert(!r.ok && r.queued && !r.auth, "502 is temporary and queued");

  // 9. A duplicate answer from the server counts as saved.
  setup();
  handler = async () => reply(200, JSON.stringify({ success: true, duplicate: true }));
  r = await saveOutcome(URL1, body1, "KAA 001A");
  assert(r.ok && r.duplicate, "a duplicate confirmation is a success");

  // 10. Background flush wins the race, then the screen retries the same form: same id, within 15 minutes.
  setup();
  handler = async () => {
    throw new Error("down");
  };
  await saveOutcome(URL1, body1, "KAA 001A");
  const firstId = getSaveState().pending[0].id;
  handler = async () => reply(200, JSON.stringify({ success: true }));
  await flushQueue();
  assert(getSaveState().pending.length === 0, "flushed");
  sent.length = 0;
  clock += 5 * 60 * 1000;
  await saveOutcome(URL1, body1, "KAA 001A");
  assert(sent[0].body.client_request_id === firstId, "the screen retry reuses the flushed id so the server treats it as a duplicate");
  setup();
  handler = async () => {
    throw new Error("down");
  };
  await saveOutcome(URL1, body1, "KAA 001A");
  const id2 = getSaveState().pending[0].id;
  handler = async () => reply(200, JSON.stringify({ success: true }));
  await flushQueue();
  sent.length = 0;
  clock += 16 * 60 * 1000;
  await saveOutcome(URL1, body1, "KAA 001A");
  assert(sent[0].body.client_request_id !== id2, "after 15 minutes an identical outcome is a new one");


  // 10c. A batch retried after part of it already saved: the saved part is recognised (same id), not saved twice.
  setup();
  handler = async () => reply(200, JSON.stringify({ success: true }));
  await saveOutcome(URL1, body1, "KAA 001A");
  const savedId = sent[0].body.client_request_id;
  sent.length = 0;
  clock += 60 * 1000;
  await saveOutcome(URL1, body1, "KAA 001A");
  assert(sent[0].body.client_request_id === savedId, "an identical retry within two minutes reuses the id so the server answers duplicate");
  sent.length = 0;
  clock += 3 * 60 * 1000;
  await saveOutcome(URL1, body1, "KAA 001A");
  assert(sent[0].body.client_request_id !== savedId, "after two minutes an identical outcome is a new one");

  // 11. Flush stops at the first temporary failure.
  setup();
  handler = async () => {
    throw new Error("down");
  };
  await saveOutcome(URL1, body1, "A");
  await saveOutcome("/api/pending-submissions/jobs/6/log", body1, "B");
  await saveOutcome("/api/pending-submissions/jobs/7/log", body1, "C");
  sent.length = 0;
  await flushQueue();
  assert(sent.length === 1, "only one request is made while the server is unreachable");
  assert(getSaveState().pending.length === 3, "all three are still safe");

  // 12. Session ping raises and clears the signed-out state.
  setup();
  handler = async () => reply(401, "Authentication required", "text/plain");
  assert((await pingSession()) === false && getSaveState().sessionProblem === true, "a 401 ping raises the signed-out state");
  handler = async () => {
    throw new Error("offline");
  };
  await pingSession();
  assert(getSaveState().sessionProblem === true, "being offline does not clear or change the state");
  handler = async () => reply(200, JSON.stringify({ ok: true }));
  assert((await pingSession()) === true && getSaveState().sessionProblem === false, "a good ping clears it");
  handler = async () => reply(200, "<html>login</html>", "text/html");
  await pingSession();
  assert(getSaveState().sessionProblem === true, "an HTML page instead of our API counts as signed out");

  // 13. Corrupt storage never breaks the page.
  setup();
  storage.setItem("solvit_unsaved_outcomes_v1", "{not json");
  reloadFromStorage();
  assert(getSaveState().pending.length === 0, "corrupt storage is ignored");

  console.log("All safe save tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// V18 END tests/safeSave.test.ts

