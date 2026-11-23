// tests/pendingApproval.test.ts
// Pending Approval business rules: routing, follow-up status, emails, reading the export, and the report maths.
import {
  ACTION_LABEL, DOC_NEEDED, NONACT_AT, OUTCOMES, actionOf, buildAM, buildInsurer, buildReceived, buildSolver, computeApprovalReport, excelRows, isValidOutcome,
  nAtt, nextStep, nairobiYmd, normPhone, outText, parseApprovalExportRows, parseSolverSheet, parseTeamRows, parseValDate, routeOf,
  type ApprovalAttempt, type ApprovalContext, type ApprovalDirectory, type ApprovalJob,
} from "../shared/pendingApproval";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("Running tests for Pending Approval rules...");

const DAY = 86_400_000;
// Wednesday 25 November 2026, 11:00 Nairobi (08:00 UTC)
const NOW = Date.parse("2026-11-25T08:00:00.000Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

const dir: ApprovalDirectory = {
  am: [{ name: "Joyce Mungasi", email: "jmungasi@solvit.co.ke" }, { name: "Irene Odago", email: "iodago@solvit.co.ke" }],
  val: [{ name: "Benson Kinyua", email: "bkinyua@solvit.co.ke" }],
  valGroup: "valuations@solvit.co.ke",
  csGroup: "cs-team@solvit.co.ke",
};
const ctx: ApprovalContext = {
  dir, senderName: "Teresiah Wangui",
  solvers: { "dennis githinji": { name: "Dennis Githinji", phone: "0712000111", email: "dennis@example.com" }, "no email": { name: "No Email", phone: "0700" } },
};

let n = 0;
const job = (p: Partial<ApprovalJob> = {}): ApprovalJob => ({
  id: String(1000 + ++n), allocated_to: "Benson Kinyua", reg: `KAA ${100 + n}A`, val_date: ago(6), policy_holder: "JOHN NDUNGU", initiated_by: "Dennis Githinji",
  source_raw: "Solver", fleet: "Non-fleet", client_cell: "0722000000", insurer: "Sanlam Allianz", insurer_email: "claims@sanlam.example", request_type: "Non-fleet",
  solver: "Dennis Githinji", solver_email: "", solver_phone: "", reason: "No Logbook", comment: "", status: "open", route_override: null, nofu_reason: null,
  reactivated_at: null, closed_at: null, closed_by: null, closed_via: null, attempts: [], ...p,
});
const att = (daysAgo: number, p: Partial<ApprovalAttempt> = {}): ApprovalAttempt => ({ at: ago(daysAgo), by: "Teresiah Wangui", type: "call", party: "Solver", outcome: "no_answer", ...p });

// ---------- Routing ----------
assert(routeOf(job({ source_raw: "Solver" }), dir) === "solver", "Solver jobs are phoned");
assert(routeOf(job({ source_raw: "Broker" }), dir) === "solver", "Broker jobs follow the solver steps");
assert(routeOf(job({ source_raw: "Ref Agent" }), dir) === "ref", "Ref Agent jobs go to the AM team");
assert(routeOf(job({ source_raw: "Channel Partner" }), dir) === "cp", "Channel Partner jobs go to the insurer");
assert(routeOf(job({ source_raw: "Not recorded" }), dir) === "cp", "Not recorded jobs go to the insurer");
assert(routeOf(job({ source_raw: "Not found", initiated_by: "joyce mungasi" }), dir) === "ref", "Not found: an AM team initiator makes it a Ref Agent job (any letter case)");
assert(routeOf(job({ source_raw: "Not found", initiated_by: "Dennis Githinji", solver: "dennis githinji" }), dir) === "solver", "Not found: the solver as initiator makes it a Solver job");
assert(routeOf(job({ source_raw: "Not found", initiated_by: "Someone Else" }), dir) === "unresolved", "Not found with anyone else needs the source set by hand");
assert(routeOf(job({ source_raw: "Not found", initiated_by: "" }), dir) === "unresolved", "Not found with no initiator needs the source set by hand");
assert(routeOf(job({ source_raw: "Solver", route_override: "cp" }), dir) === "cp", "a source set by hand wins");

// ---------- Follow-up status ----------
assert(actionOf(job(), NOW) === "none", "no follow-up: not actioned");
assert(actionOf(job({ attempts: [att(0)] }), NOW) === "waiting", "a follow-up today: waiting");
assert(actionOf(job({ attempts: [att(1)] }), NOW) === "waiting", "a follow-up yesterday: still waiting");
assert(actionOf(job({ attempts: [att(2)] }), NOW) === "due", "a follow-up two days ago: due");
assert(actionOf(job({ attempts: [att(9), att(5), att(3)] }), NOW) === "nonact", "three follow-ups and no approval: non-actionable");
assert(NONACT_AT === 3, "non-actionable at 3");
assert(actionOf(job({ attempts: [att(5), att(3)] }), NOW) === "due", "two follow-ups: not yet non-actionable");
assert(actionOf(job({ status: "closed", attempts: [att(1)] }), NOW) === "closed", "a closed job is closed");
assert(nAtt(job({ attempts: [att(1), att(1, { type: "update" }), att(1, { type: "receipt", outcome: "received" })] })) === 1, "updates and receipts are not follow-ups");
assert(actionOf(job({ attempts: [att(1, { type: "update" })] }), NOW) === "none", "an outcome update alone does not count as actioned");
const reactivated = job({ attempts: [att(9), att(7), att(5)], reactivated_at: ago(4) });
assert(actionOf(reactivated, NOW) === "due", "a reactivated job counts follow-ups again from the reactivation");
assert(actionOf({ ...reactivated, attempts: [...reactivated.attempts, att(3), att(2), att(1)] }, NOW) === "nonact", "three new follow-ups after reactivation make it non-actionable again");
assert(ACTION_LABEL.none[0] === "Not actioned" && ACTION_LABEL.nonact[0] === "Non-actionable", "status labels");

// ---------- Next step ----------
assert(nextStep(job(), dir, NOW).t === "Call solver", "next step for a solver job");
assert(nextStep(job({ source_raw: "Ref Agent" }), dir, NOW).t === "Email AM team", "next step for a ref agent job");
assert(nextStep(job({ source_raw: "Channel Partner" }), dir, NOW).t === "Email insurer", "next step for a channel partner job");
assert(nextStep(job({ source_raw: "Not found", initiated_by: "X" }), dir, NOW).t === "Set the source first", "next step when the source is unknown");
assert(nextStep(job({ attempts: [att(0, { outcome: "gave_contact", contact: "Peter 0711" })] }), dir, NOW).t === "Call broker/agent: Peter 0711", "after the solver gives a contact, call the broker/agent");
assert(nextStep(job({ attempts: [att(2, { outcome: "gave_contact", contact: "Peter 0711" }), att(1, { party: "Broker/Agent" })] }), dir, NOW).t === "Waiting for documents", "once the broker/agent was called, wait");
assert(nextStep(job({ attempts: [att(3)] }), dir, NOW).t === "Follow up (3d since last attempt)", "a stale follow-up is chased");
assert(nextStep(job({ attempts: [att(0)] }), dir, NOW).t === "Waiting for documents", "a fresh follow-up waits");
assert(nextStep(job({ attempts: [att(9), att(5), att(3)] }), dir, NOW).t === "3+ follow-ups without approval", "non-actionable next step");
assert(nextStep(job({ status: "closed" }), dir, NOW).t === "Closed", "closed next step");

// ---------- Outcomes ----------
assert(OUTCOMES.length === 21 && OUTCOMES[OUTCOMES.length - 1][0] === "custom", "21 outcomes, the last lets the user type their own");
assert(outText(att(0, { outcome: "custom", outcome_text: "Bank holds the logbook" })) === "Bank holds the logbook", "a custom outcome shows the typed text");
assert(outText(att(0, { outcome: "custom" })) === "Other", "an empty custom outcome shows Other");
assert(outText(att(0, { outcome: "sent" })) === "Email sent" && outText(att(0, { outcome: "received" })) === "Document received", "system outcomes read naturally");
assert(isValidOutcome("has_docs") && isValidOutcome("sent") && !isValidOutcome("made_up"), "outcome codes are checked");

// ---------- Emails ----------
const j1 = job({ source_raw: "Ref Agent", initiated_by: "Joyce Mungasi", insurer: "ICEA Lion", reg: "KAA 111A" });
const j2 = job({ source_raw: "Ref Agent", initiated_by: "Joyce Mungasi", insurer: "Sanlam Allianz", reg: "KBB 222B", comment: "<b>x</b>" });
const am = buildAM("Joyce Mungasi", [j1, j2], ctx);
assert(eq(am.to, ["jmungasi@solvit.co.ke"]) && eq(am.cc, ["cs-team@solvit.co.ke"]), "AM email goes to the AM member with the CS group in copy");
assert(am.subject === "Pending approvals: documents needed for 2 job(s)", "first AM email subject");
assert(am.html.includes("<b>ICEA Lion</b> (1)") && am.html.includes("<b>Sanlam Allianz</b> (1)"), "AM email is grouped by insurer");
assert(am.html.indexOf("ICEA Lion") < am.html.indexOf("Sanlam Allianz"), "insurers are listed alphabetically");
assert(am.html.includes("&lt;b&gt;x&lt;/b&gt;") && !am.html.includes("<b>x</b>"), "job text is escaped in emails");
assert(am.html.includes("Hi Joyce,") && am.html.includes("Teresiah Wangui<br>Customer Service, Solvit"), "greeting and signature");
const amUnknown = buildAM("Nobody Known", [j1], ctx);
assert(eq(amUnknown.to, ["cs-team@solvit.co.ke"]) && amUnknown.cc.length === 0, "an AM person with no address goes to the CS group");
const followed = { ...j1, attempts: [att(3, { type: "email", party: "AM team", outcome: "sent" })] };
assert(buildAM("Joyce Mungasi", [followed], ctx).subject.endsWith("(follow-up 1)"), "a second email says it is follow-up 1");
const ins = buildInsurer("Sanlam Allianz", [job({ insurer_email: "x@sanlam.example" })], ctx);
assert(eq(ins.to, ["x@sanlam.example"]) && eq(ins.cc, ["cs-team@solvit.co.ke"]), "insurer email goes to the insurer with the CS group in copy");
assert(ins.subject === "Solvit valuations awaiting documents: Sanlam Allianz (1 job(s))" && ins.html.includes("Dear Sanlam Allianz team,"), "insurer email wording");
assert(!ins.html.includes("Initiated by"), "insurer emails have no 'initiated by' column");
assert(buildInsurer("Sanlam Allianz", [{ ...job(), attempts: [att(3, { type: "email", outcome: "sent" })] }], ctx).subject.endsWith(" - follow-up"), "insurer follow-up subject");
const rec = buildReceived("Benson Kinyua", [j1], "Logbook came by email", ctx);
assert(eq(rec.to, ["bkinyua@solvit.co.ke"]) && eq(rec.cc, ["valuations@solvit.co.ke"]), "received email goes to the valuer with the valuation group in copy");
assert(rec.html.includes("Note: Logbook came by email") && rec.subject === "Documents received: 1 job(s) ready for approval", "received email content");
assert(eq(buildReceived("Unallocated", [j1], "", ctx).to, ["valuations@solvit.co.ke"]) && !buildReceived("Unallocated", [j1], "", ctx).html.includes("Note:"), "an unknown valuer goes to the valuation group; no note, no note line");
const sol = buildSolver("Dennis Githinji", [job({ reg: "KAA 1A" }), job({ reg: "KAA 2B" })], ctx);
assert(eq(sol.to, ["dennis@example.com"]) && sol.subject === "Documents received for your job(s): KAA 1A, KAA 2B", "solver email");
assert(buildSolver("No Email", [job({ solver: "No Email" })], ctx).to[0] === "", "a solver with no email has no recipient");
assert(buildSolver("X", [job({ solver: "X", solver_email: "job@example.com" })], ctx).to[0] === "job@example.com", "a solver email on the job is used when the contact list has none");

const rows = excelRows([j1], "am");
assert(rows[0]["Initiated by"] === "Joyce Mungasi" && rows[0].Source === "Ref Agent", "AM Excel has initiator and source");
assert(!("Initiated by" in excelRows([j1], "ins")[0]), "insurer Excel has no initiator");
assert(rows[0]["Document needed"] === DOC_NEEDED["No Logbook"], "Excel shows the document needed in words");

// ---------- Reading the export ----------
assert(parseValDate("2026-11-16T18:12:29") === "2026-11-16T15:12:29.000Z", "a time with no zone is Nairobi time");
assert(parseValDate("2026-11-16 18:12:29") === "2026-11-16T15:12:29.000Z", "a space-separated time works");
assert(parseValDate("2026-11-16T15:12:29Z") === "2026-11-16T15:12:29.000Z", "a time with a zone is kept");
assert(parseValDate("2026-11-16") === "2026-11-15T21:00:00.000Z", "a date alone is midnight in Nairobi");
assert(parseValDate(new Date("2026-11-16T15:12:29Z")) === "2026-11-16T15:12:29.000Z", "a Date is kept");
assert(parseValDate(46342.75) === "2026-11-16T15:00:00.000Z", "an Excel serial number is read as Nairobi time");
assert(parseValDate("") === null && parseValDate("garbage") === null && parseValDate(undefined) === null, "bad dates are rejected");
assert(nairobiYmd("2026-11-16T21:30:00Z") === "2026-11-17", "dates are bucketed in Nairobi time");

const parsed = parseApprovalExportRows([
  { Request_id: " 501 ", Vehicle_reg: "KAA 1A", "Awaiting Document Reason": "No Logbook", Valuation_date: "2026-11-16T18:12:29", Insurance_company: "ICEA Lion", Solver_name: "Dennis", Solver_email: "d@example.com", Solver_contact: "712345678", Initiator_Source: "Solver" },
  { Request_id: "502", Vehicle_reg: "KAA 2B", "Awaiting Document Reason": "Test", Valuation_date: "2026-11-16T18:12:29" },
  { Request_id: "503", Vehicle_reg: "TEST 1", "Awaiting Document Reason": "No Logbook", Valuation_date: "2026-11-16T18:12:29" },
  { Request_id: "504", Vehicle_reg: "KAA 4D", "Awaiting Document Reason": "No Logbook", Insurance_company: "Test Test", Valuation_date: "2026-11-16T18:12:29" },
  { Request_id: "505", Vehicle_reg: "KAA 5E", "Awaiting Document Reason": "No Logbook", Valuation_date: "not a date" },
  { Request_id: "", Vehicle_reg: "KAA 6F" },
  { "request id": "506", vehicle_reg: "KAA 7G", "awaiting document reason": "Other", valuation_date: "2026-11-17T09:00:00", "Awaiting Document Reason Comment": "see agent" },
]);
assert(parsed.rows.length === 2 && parsed.rows[0].id === "501" && parsed.rows[1].id === "506", `two usable rows (got ${parsed.rows.map((r) => r.id)})`);
assert(parsed.skippedTest === 3, "test rows are skipped (by reason, registration and insurer)");
assert(parsed.skippedInvalid.length === 1 && parsed.skippedInvalid[0].id === "505", "a row with no usable date is reported, not imported");
assert(eq(parsed.seen.sort(), ["501", "502", "503", "504", "505", "506"]), "skipped rows still count as seen, so their jobs are never treated as approved");
assert(parsed.rows[0].solver_phone === "712345678" && parsed.rows[0].solver === "Dennis" && parsed.rows[0].val_date === "2026-11-16T15:12:29.000Z", "columns are mapped");
assert(parsed.rows[1].comment === "see agent" && parsed.rows[1].reason === "Other", "headers match regardless of case and punctuation");

const sheet = parseSolverSheet([["Solver Name", "Phone", "Email", "Region", "Location"], ["Ben Mwaura", "712767890", "b@example.com", "South Nairobi", "Langata"], ["", "070", "", "", ""]]);
assert(sheet.length === 1 && sheet[0].phone === "0712767890" && sheet[0].region === "South Nairobi", "solver sheet with headers; a missing leading 0 is restored");
const regional = parseSolverSheet([["South Nairobi", "Location", "Phone"], ["Kenneth Achieng", "Langata, Bomas", "0723956281"], ["Listing of solvers", "", "0700"]]);
assert(regional.length === 1 && regional[0].region === "South Nairobi" && regional[0].location === "Langata, Bomas", "the regional contact list layout is read");
assert(normPhone("712 345 678") === "0712345678" && normPhone("0712345678") === "0712345678", "phone numbers are normalised");
const team = parseTeamRows([{ Name: "A One", Email: "a@x.com", Team: "AM" }, { Name: "V Two", Email: "v@x.com", Team: "Valuation" }, { Name: "Bad", Email: "nope", Team: "AM" }, { Name: "A One", Email: "a2@x.com", Team: "account management" }]);
assert(team.am.length === 1 && team.am[0].email === "a2@x.com" && team.val.length === 1 && team.bad === 1, "team upload: AM and valuation, a repeat updates the address, a bad row is counted");

// ---------- Report ----------
const closedAt = (d: number) => ago(d);
const jobs: ApprovalJob[] = [
  job({ id: "A1", status: "closed", closed_via: "received", closed_at: closedAt(1), closed_by: "Teresiah Wangui", val_date: ago(8), attempts: [att(5), att(4, { type: "receipt", outcome: "received" })] }), // followed, approved after 1
  job({ id: "A2", status: "closed", closed_via: "received", closed_at: closedAt(1), closed_by: "Brian", val_date: ago(8), attempts: [att(6), att(5), att(4, { type: "receipt", outcome: "received" })] }), // approved after 2
  job({ id: "A3", status: "closed", closed_via: "export", closed_at: closedAt(2), val_date: ago(8) }), // dropped off on its own, never followed up
  job({ id: "P1", attempts: [att(1, { outcome: "has_docs" })], reason: "No Insurance Sticker", source_raw: "Ref Agent", initiated_by: "Joyce Mungasi", insurer: "ICEA Lion" }), // followed, pending
  job({ id: "P2", attempts: [att(9), att(7), att(5, { outcome: "no_docs" })], insurer: "ICEA Lion" }), // non-actionable
  job({ id: "N1", nofu_reason: "Job too new, not yet due for follow-up" }), // not followed up
  job({ id: "N2" }), // not followed up, no reason
];
const rep = computeApprovalReport(jobs, { grain: "week", target: 0.99, now: NOW, dir });
assert(rep.info.length === 7, "all jobs are in the pipeline");
assert(rep.F.length === 4 && rep.N.length === 3, `followed up: A1, A2, P1, P2 (got ${rep.F.length}); not followed up: A3, N1, N2 (got ${rep.N.length})`);
assert(rep.A.length === 2 && rep.P.length === 1 && rep.NA.length === 1 && rep.NOT.length === 2, "approved 2, pending 1, non-actionable 1");
assert(rep.conv === 0.5 && rep.gap === "-49.0", `conversion 50% and a 49 point gap to the 99% target (got ${rep.conv}, ${rep.gap})`);
const seg1 = rep.tables[0].rows;
assert(seg1[0][1] === 7 && seg1[1][1] === 4 && seg1[2][1] === 2 && seg1[3][1] === 1 && seg1[4][1] === 1 && seg1[5][1] === 2, "Segment 1 table");
const seg2 = rep.tables.find((t) => t.t.startsWith("Segment 2"))!.rows;
assert(seg2.some((r) => r[0] === "Approved on its own before any follow-up" && r[1] === 1) && seg2.some((r) => r[0] === "Job too new, not yet due for follow-up" && r[1] === 1) && seg2.some((r) => r[0] === "Reason not captured" && r[1] === 1), "Segment 2 explains every job that was not followed up");
const lastRow = seg2[seg2.length - 1];
assert(lastRow[0] === "Total pending jobs not followed up" && lastRow[1] === 3, "Segment 2 total");
const byPeriod = rep.tables.find((t) => t.t.startsWith("Conversion by follow-up period"))!.rows;
const totalRow = byPeriod[byPeriod.length - 1];
assert(totalRow[1] === 4 && totalRow[2] === 1 && totalRow[3] === 1 && totalRow[4] === 0 && totalRow[5] === 2 && totalRow[6] === "50%", "approved after the 1st / 2nd / 3rd or more follow-up");
assert(rep.activity.total === 7 && rep.activity.calls === 7, "follow-up activity counts every follow-up");
assert(rep.activity.avgFollowUpsBeforeApproval === 1.5, "average follow-ups before approval");
assert(rep.activity.perDay.length === 14 && rep.activity.perDay[13].ymd === "2026-11-25", "14 days of activity ending today in Nairobi");
assert(rep.team.find((t) => t.name === "Teresiah Wangui")!.closed === 1 && rep.team.find((t) => t.name === "Brian")!.closed === 1, "who closed the jobs as received");
assert(rep.bySource.some((s) => s.label === "Ref agent (AM team)" && s.pipeline === 1), "by source");
assert(rep.byInsurer.find((s) => s.label === "ICEA Lion")!.pipeline === 2, "by insurer");
assert(rep.notApprovedRows.length === 2 && rep.notFollowedRows.length === 3, "the two detail lists");
const filtered = computeApprovalReport(jobs, { grain: "month", target: 0.9, now: NOW, dir, insurer: "ICEA Lion" });
assert(filtered.info.length === 2 && filtered.F.length === 2, "the insurer filter narrows the report");
assert(computeApprovalReport(jobs, { grain: "day", target: 0.99, now: NOW, dir, from: nairobiYmd(NOW), to: nairobiYmd(NOW) }).info.length === 0, "the valuation-date filter narrows the report");
assert(computeApprovalReport([], { grain: "week", target: 0.99, now: NOW, dir }).conv === 0, "an empty report does not divide by zero");

console.log("All Pending Approval rule tests passed!");
