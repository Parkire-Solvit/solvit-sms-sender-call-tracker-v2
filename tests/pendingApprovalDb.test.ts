// tests/pendingApprovalDb.test.ts
// Pending Approval against a real PostgreSQL: the carried-over starter data, the weekly export, follow-ups, closing, the
// team lists, and who may open the section. Skipped when TEST_DATABASE_URL is not set (the schema must be migrated).
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
    console.log("Skipping Pending Approval DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-test-"));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const pa = await import(path.join(root, "pendingApprovals.ts"));
  const rules = await import(path.join(root, "shared", "pendingApproval.ts"));
  const { loadAuthContext } = await import(path.join(root, "server", "auth", "accountLoader.ts"));
  const { HttpError } = await import(path.join(root, "httpError.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for Pending Approval...");

  // ---------- Starter data carried over from the Pending Approvals Desk ----------
  const state0 = await pa.getApprovalState(db);
  assert(state0.jobs.length === 63 && state0.jobs.every((j: any) => j.status === "open" && j.attempts.length === 0), "the 63 sample jobs are there, open, with no follow-ups");
  assert(state0.solvers.length === 111, `111 solver contacts (got ${state0.solvers.length})`);
  assert(state0.directory.am.length === 6 && state0.directory.val.length === 6, "6 AM and 6 valuation team members");
  assert(state0.directory.valGroup === "valuations@solvit.co.ke" && state0.directory.csGroup === "cs-team@solvit.co.ke", "group addresses");
  assert(state0.settings.target_conversion === 0.99, "the report target defaults to 99%");
  const first = state0.jobs.find((j: any) => j.id === "358207");
  assert(first && first.reg === "KBJ 292E" && first.insurer === "Sanlam Allianz" && first.val_date === "2026-11-16T15:12:29.000Z", "a sample job keeps its details, its valuation time read as Nairobi time");
  const routes = state0.jobs.reduce((m: any, j: any) => { const r = rules.routeOf(j, state0.directory); m[r] = (m[r] || 0) + 1; return m; }, {});
  assert(routes.solver === 17 && routes.ref === 27 && routes.cp === 19 && !routes.unresolved, `sample jobs route as the source says (got ${JSON.stringify(routes)})`);

  // ---------- Follow-ups ----------
  const id = "358207";
  assert((await pa.logApprovalAttempt(db, id, { type: "call", party: "Solver", outcome: "has_docs", note: "Will send tomorrow", client_request_id: "form-1" }, "Teresiah Wangui")).saved === true, "a follow-up is saved");
  assert((await pa.logApprovalAttempt(db, id, { type: "call", party: "Solver", outcome: "has_docs", note: "Will send tomorrow", client_request_id: "form-1" }, "Teresiah Wangui")).saved === false, "the same save sent twice is stored once");
  await pa.logApprovalAttempt(db, id, { type: "call", party: "Solver", outcome: "has_docs" }, "Brian");
  let job = (await pa.listApprovalJobs(db, [id]))[0];
  assert(job.attempts.length === 2, `two follow-ups from two people both kept (got ${job.attempts.length})`);
  assert(job.attempts[0].by === "Teresiah Wangui" && job.attempts[0].note === "Will send tomorrow", "who and what is kept");
  await pa.logApprovalAttempt(db, id, { type: "update", party: "Solver", outcome: "gave_contact", contact: "Peter 0711000222" }, "Teresiah Wangui");
  job = (await pa.listApprovalJobs(db, [id]))[0];
  assert(rules.nAtt(job) === 2 && job.attempts[2].contact === "Peter 0711000222", "an update does not count as a follow-up and keeps the broker/agent contact");
  await expectHttp(400, "unknown outcome", () => pa.logApprovalAttempt(db, id, { type: "call", party: "Solver", outcome: "made_up" }, "T"), HttpError);
  await expectHttp(400, "receipt cannot be logged by hand", () => pa.logApprovalAttempt(db, id, { type: "receipt", party: "Solver", outcome: "received" }, "T"), HttpError);
  await expectHttp(400, "custom outcome needs text", () => pa.logApprovalAttempt(db, id, { type: "call", party: "Solver", outcome: "custom" }, "T"), HttpError);
  await expectHttp(400, "bad party", () => pa.logApprovalAttempt(db, id, { type: "call", party: "Nobody", outcome: "other" }, "T"), HttpError);
  await expectHttp(404, "unknown job", () => pa.logApprovalAttempt(db, "nope", { type: "call", party: "Solver", outcome: "other" }, "T"), HttpError);
  await pa.logApprovalAttempt(db, id, { type: "call", party: "Solver", outcome: "no_answer", solver_phone: "712 000 999", solver_email: "dennis.new@example.com" }, "T");
  const dennis = (await pa.listApprovalSolvers(db)).find((s: any) => s.name === "Dennis Githinji");
  assert(dennis && dennis.phone === "0712000999" && dennis.email === "dennis.new@example.com", "a phone and email entered while logging update the solver contact");
  await expectHttp(400, "bad solver email", () => pa.logApprovalAttempt(db, id, { type: "call", party: "Solver", outcome: "other", solver_email: "bad" }, "T"), HttpError);

  // ---------- Source, reactivation, reasons ----------
  const overridden = state0.jobs.find((j: any) => j.source_raw === "Not found");
  await pa.setApprovalRoute(db, overridden.id, "cp");
  const overriddenAfter = (await pa.listApprovalJobs(db, [overridden.id]))[0];
  assert(overriddenAfter.route_override === "cp" && rules.routeOf(overriddenAfter, state0.directory) === "cp", "a source set by hand is kept and wins");
  await expectHttp(400, "bad source", () => pa.setApprovalRoute(db, id, "unresolved"), HttpError);
  await pa.reactivateApprovalJob(db, id);
  assert((await pa.listApprovalJobs(db, [id]))[0].reactivated_at !== null, "reactivation is stamped");
  const noFollowUp = state0.jobs.filter((j: any) => j.id !== id).slice(0, 3).map((j: any) => j.id);
  assert(await pa.setApprovalNoFollowUpReason(db, [...noFollowUp, id], "Waiting on another team") === 3, "the reason is set only on jobs with no follow-up (the followed-up one is left alone)");
  assert((await pa.listApprovalJobs(db, [id]))[0].nofu_reason === null, "a followed-up job gets no 'why no follow-up' reason");
  await expectHttp(400, "reason must be from the list", () => pa.setApprovalNoFollowUpReason(db, noFollowUp, "Because"), HttpError);

  // ---------- Closing ----------
  const [a, b] = noFollowUp;
  const closedNow = await Promise.all([
    pa.closeApprovalJobs(db, [a], { actor: "Teresiah Wangui", via: "received", note: "Logbook by email" }),
    pa.closeApprovalJobs(db, [a], { actor: "Brian", via: "received", note: "Same job, same moment" }),
  ]);
  assert(closedNow.flat().length === 1 && closedNow.flat()[0] === a, "two people closing the same job at once: it is closed once");
  const closedJob = (await pa.listApprovalJobs(db, [a]))[0];
  assert(closedJob.status === "closed" && closedJob.closed_via === "received" && closedJob.attempts.filter((x: any) => x.type === "receipt").length === 1, "closed with a single receipt");
  await expectHttp(409, "logging on a closed job", () => pa.logApprovalAttempt(db, a, { type: "call", party: "Solver", outcome: "other" }, "T"), HttpError);
  assert((await pa.closeApprovalJobs(db, [a, "missing-id"], { actor: "T", via: "received" })).length === 0, "closing a closed or unknown job does nothing");

  // ---------- Follow-up emails and the log ----------
  const sent = await pa.recordSentFollowUp(db, { by: "Teresiah Wangui", kind: "am", key: "Joyce Mungasi", to: ["jmungasi@solvit.co.ke"], cc: ["cs-team@solvit.co.ke"], subject: "Pending approvals", jobIds: [b, a, "missing-id"], party: "AM team" });
  assert(sent === 1, "an email records one follow-up on each job still open (not the closed or unknown ones)");
  const bJob = (await pa.listApprovalJobs(db, [b]))[0];
  assert(bJob.attempts.length === 1 && bJob.attempts[0].type === "email" && bJob.attempts[0].outcome === "sent" && bJob.attempts[0].party === "AM team", "the email shows as an email follow-up");
  const log = await pa.listApprovalEmails(db);
  assert(log.length === 1 && log[0].kind === "am" && log[0].to[0] === "jmungasi@solvit.co.ke" && log[0].jobs.length === 3, "the email log keeps recipients and jobs");

  // ---------- Weekly export ----------
  const row = (rid: string, extra: Record<string, unknown> = {}) => ({
    Request_id: rid, Vehicle_reg: `KZZ ${rid}`, "Awaiting Document Reason": "No Logbook", Valuation_date: "2026-11-23T09:00:00", Insurance_company: "ICEA Lion",
    Insurance_company_email: "claims@icea.example", Initiator_Source: "Solver", Initiated_by: "Dennis Githinji", Solver_name: "Dennis Githinji", Allocated_to: "Benson Kinyua", ...extra,
  });
  await expectHttp(400, "empty file", () => pa.importApprovalExport(db, "f.xlsx", "T", []), HttpError);
  await expectHttp(400, "no request ids", () => pa.importApprovalExport(db, "f.xlsx", "T", [{ foo: "bar" }]), HttpError);
  const openBefore = (await pa.listApprovalJobs(db)).filter((j: any) => j.status === "open");
  const keep = openBefore.slice(0, 5).map((j: any) => j.id);
  const upload = [
    ...keep.map((k: string) => row(k, { Policy_holder: "REFRESHED NAME", Solver_email: "" })),
    row("900001"), row("900002", { "Awaiting Document Reason": "Test" }), row("900003", { Valuation_date: "garbage" }), row(a),
  ];
  const res1 = await pa.importApprovalExport(db, "week1.xlsx", "Teresiah Wangui", upload);
  assert(res1.added === 1 && res1.refreshed === 6 && res1.skipped_test === 1 && res1.skipped_invalid.length === 1, `new 1, refreshed 6 (5 open + 1 closed), 1 test row and 1 bad date skipped (got ${JSON.stringify({ a: res1.added, r: res1.refreshed, t: res1.skipped_test, i: res1.skipped_invalid.length })})`);
  assert(res1.already_closed_in_file === 1, "a closed job that is in the file again is reported, and stays closed");
  assert((await pa.listApprovalJobs(db, [a]))[0].status === "closed", "a refreshed closed job stays closed");
  assert(res1.missing.length === openBefore.length - 5 - (keep.includes(b) ? 0 : 0) && !res1.missing.some((m: any) => keep.includes(m.id) || m.id === "900001"), "every open job that is not in the file is reported missing, none that is in it");
  const refreshed = (await pa.listApprovalJobs(db, [keep[0]]))[0];
  assert(refreshed.policy_holder === "REFRESHED NAME", "an existing job's details refresh");
  const dennisAfter = (await pa.listApprovalSolvers(db)).find((s: any) => s.name === "Dennis Githinji");
  assert(dennisAfter.email === "dennis.new@example.com", "a blank solver email in the export never erases a saved one");
  const kept = (await pa.listApprovalJobs(db, [id]))[0];
  assert(kept.attempts.length >= 4 && kept.status === "open", "a job keeps its follow-ups and status when refreshed");
  assert((await pa.listApprovalJobs(db, ["900002"])).length === 0 && (await pa.listApprovalJobs(db, ["900003"])).length === 0, "skipped rows are not imported");
  const stillOpen = (await pa.listApprovalJobs(db)).filter((j: any) => j.status === "open").length;
  assert(res1.open_after === stillOpen, "open_after counts the open jobs after the upload");

  // Closing the missing jobs needs the latest upload, and works once.
  const res2 = await pa.importApprovalExport(db, "week1-again.xlsx", "T", upload);
  await expectHttp(409, "an older upload cannot be confirmed", () => pa.closeMissingFromImport(db, res1.import_id, "T"), HttpError);
  const closedMissing = await pa.closeMissingFromImport(db, res2.import_id, "Teresiah Wangui");
  assert(closedMissing.closed === res2.missing.length && closedMissing.closed > 0, "the missing jobs are closed as approved");
  const exportClosed = (await pa.listApprovalJobs(db, [res2.missing[0].id]))[0];
  assert(exportClosed.status === "closed" && exportClosed.closed_via === "export" && exportClosed.attempts[0].outcome === "approved", "a job that dropped off the export is closed as approved, with a receipt");
  await expectHttp(409, "confirming twice", () => pa.closeMissingFromImport(db, res2.import_id, "T"), HttpError);
  await expectHttp(404, "unknown upload", () => pa.closeMissingFromImport(db, 999999, "T"), HttpError);

  // ---------- Team lists, groups, solvers ----------
  await expectHttp(400, "bad team email", () => pa.saveApprovalDirectory(db, { am: [{ name: "X", email: "bad" }], val: [], valGroup: "v@solvit.co.ke", csGroup: "c@solvit.co.ke" }), HttpError);
  await expectHttp(400, "duplicate person", () => pa.saveApprovalDirectory(db, { am: [{ name: "X", email: "x@s.co" }, { name: "x", email: "y@s.co" }], val: [], valGroup: "v@solvit.co.ke", csGroup: "c@solvit.co.ke" }), HttpError);
  await expectHttp(400, "bad group", () => pa.saveApprovalDirectory(db, { am: [], val: [], valGroup: "nope", csGroup: "c@solvit.co.ke" }), HttpError);
  assert((await pa.getApprovalDirectory(db)).am.length === 6, "a rejected save changes nothing");
  const saved = await pa.saveApprovalDirectory(db, { am: [{ name: "New AM", email: "nam@solvit.co.ke" }], val: [{ name: "Benson Kinyua", email: "bk@solvit.co.ke" }], valGroup: "val2@solvit.co.ke", csGroup: "cs2@solvit.co.ke" });
  assert(saved.am.length === 1 && saved.val[0].email === "bk@solvit.co.ke" && saved.valGroup === "val2@solvit.co.ke" && saved.csGroup === "cs2@solvit.co.ke", "team lists and group addresses are replaced");
  assert(await pa.upsertApprovalSolvers(db, [{ name: "Ben Mwaura", phone: "", email: "ben@new.example" }, { name: "Brand New", phone: "712 111 222", email: "not-an-email" }, { name: "" }]) === 2, "solvers are added or updated");
  const sol = await pa.listApprovalSolvers(db);
  const ben = sol.find((s: any) => s.name === "Ben Mwaura"), fresh = sol.find((s: any) => s.name === "Brand New");
  assert(ben.email === "ben@new.example" && ben.phone === "0712767890" && ben.region === "South Nairobi", "an upload fills blanks and never erases saved contact details");
  assert(fresh.phone === "0712111222" && fresh.email === "", "a new solver is added; an invalid email is ignored");
  await pa.setApprovalSolverContact(db, "Ben Mwaura", "email", "");
  assert((await pa.listApprovalSolvers(db)).find((s: any) => s.name === "Ben Mwaura").email === "", "editing a cell to empty clears it");
  await expectHttp(400, "bad solver cell", () => pa.setApprovalSolverContact(db, "Ben Mwaura", "email", "bad"), HttpError);
  assert((await pa.updateApprovalWorkingSettings(db, { target_conversion: 0.95 })).target_conversion === 0.95, "the report target is saved");
  await expectHttp(400, "target out of range", () => pa.updateApprovalWorkingSettings(db, { target_conversion: 1.5 }), HttpError);

  // ---------- Administration ----------
  await expectHttp(400, "empty tag", () => pa.updateApprovalAdminSettings(db, { team_tag: "  " }), HttpError);
  await expectHttp(400, "bad sender", () => pa.updateApprovalAdminSettings(db, { senders: [{ username: "teresiah", mailbox: "bad" }] }), HttpError);
  await expectHttp(400, "duplicate sender", () => pa.updateApprovalAdminSettings(db, { senders: [{ username: "teresiah", mailbox: "t@solvit.co.ke" }, { username: "Teresiah", mailbox: "t2@solvit.co.ke" }] }), HttpError);
  const adm = await pa.updateApprovalAdminSettings(db, { default_sender_mailbox: "cs-team@solvit.co.ke", senders: [{ username: "Teresiah", mailbox: "teresiah@solvit.co.ke" }] });
  assert(adm.senders.length === 1 && adm.senders[0].username === "teresiah", "sender mailboxes are saved (usernames in lower case)");
  assert(await pa.senderMailboxFor(db, "TERESIAH") === "teresiah@solvit.co.ke", "a login sends from its own mailbox");
  assert(await pa.senderMailboxFor(db, "someone.else") === "cs-team@solvit.co.ke", "any other login sends from the default mailbox");
  await pa.updateApprovalAdminSettings(db, { default_sender_mailbox: "" });
  assert(await pa.senderMailboxFor(db, "someone.else", "env@solvit.co.ke") === "env@solvit.co.ke" && await pa.senderMailboxFor(db, "someone.else") === "", "the environment mailbox is the last fallback; with none, nothing is sent");

  // ---------- Who may open the section ----------
  await db.execute("INSERT INTO agents (name, tag) VALUES ('Terry Approvals', 'Approvals Team')");
  await db.execute("INSERT INTO agents (name, tag) VALUES ('Other Agent', 'Callback Team')");
  const agentId = async (n: string) => Number((await db.queryOne("SELECT id FROM agents WHERE name = ?", [n])).id);
  const mkUser = async (u: string, role: string, agent: number | null) =>
    Number((await db.execute("INSERT INTO users (username, password_hash, display_name, role, agent_id) VALUES (?, 'x', ?, ?, ?)", [u, u, role, agent])).lastInsertId);
  const terry = await mkUser("terry", "agent", await agentId("Terry Approvals"));
  const other = await mkUser("other", "agent", await agentId("Other Agent"));
  const boss = await mkUser("boss", "admin", null);
  assert(JSON.stringify((await loadAuthContext(db, terry))?.sections) === JSON.stringify(["approvals"]), "an agent tagged Approvals Team opens Pending Approval only");
  assert(JSON.stringify((await loadAuthContext(db, other))?.sections) === JSON.stringify(["callbacks"]), "an agent with another team tag does not get Pending Approval");
  assert((await loadAuthContext(db, boss))?.sections.includes("approvals") === true, "administrators open Pending Approval");
  await pa.updateApprovalAdminSettings(db, { team_tag: "Doc Desk" });
  assert((await loadAuthContext(db, terry))?.sections.includes("approvals") === false, "renaming the team tag takes access away from the old tag at once");
  await db.execute("UPDATE agents SET tag = 'Doc Desk' WHERE name = 'Other Agent'");
  assert(JSON.stringify((await loadAuthContext(db, other))?.sections) === JSON.stringify(["approvals"]), "re-tagging an agent to the new tag gives access at once");

  // ---------- Polling revision ----------
  const rev1 = await pa.getApprovalRevision(db);
  assert(rev1 === await pa.getApprovalRevision(db), "the revision is stable while nothing changes");
  await pa.logApprovalAttempt(db, keep[1], { type: "call", party: "Solver", outcome: "other" }, "T");
  assert(rev1 !== await pa.getApprovalRevision(db), "the revision changes when a follow-up is logged");
  const rev2 = await pa.getApprovalRevision(db);
  await pa.setApprovalSolverContact(db, "Brand New", "phone", "0799000111");
  assert(rev2 !== await pa.getApprovalRevision(db), "the revision changes when a solver contact changes");

  console.log("All Pending Approval DB integration tests passed!");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
