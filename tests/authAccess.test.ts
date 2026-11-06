// tests/authAccess.test.ts
// Which sections an account may open (server rules) and which screens the interface offers (client rules).
import { sectionsFor, tagKey, normalizeRole, DEFAULT_CALLBACK_TAG, DEFAULT_PENDING_TAG } from "../server/auth/access";
import { allowedViews, resolveView, landingView, VIEW_LABELS } from "../src/lib/appViews";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("Running tests for authAccess...");

const base = { callbackTag: "Callback Team", pendingTag: "Callback Team(Submission)" };
const agentWith = (tag: string | null, archived = false) => ({ name: "Mary Muriuki", tag, archived });

// ---- tags ----
assert(tagKey("  Callback   Team ") === "callback team", "tags ignore case and spacing");
assert(tagKey(null) === "" && tagKey(undefined) === "", "a missing tag is empty");
assert(DEFAULT_CALLBACK_TAG === "Callback Team" && DEFAULT_PENDING_TAG === "Callback Team(Submission)", "defaults match the settings defaults");
assert(normalizeRole("agent") === "agent" && normalizeRole("admin") === "admin" && normalizeRole("callback_agent") === "admin" && normalizeRole(null) === "admin", "only 'agent' is restricted; anything unknown is treated as before (admin)");

// ---- administrators and inactive accounts ----
assert(eq(sectionsFor({ ...base, role: "admin", active: true, agent: null }), ["call_activity", "callbacks", "pending"]), "an administrator opens everything");
assert(eq(sectionsFor({ ...base, role: "admin", active: true, agent: agentWith("Anything", true) }), ["call_activity", "callbacks", "pending"]), "an administrator is not affected by a linked agent's tag or archive state");
assert(eq(sectionsFor({ ...base, role: "admin", active: false, agent: null }), []), "an inactive administrator opens nothing");
assert(eq(sectionsFor({ ...base, role: "agent", active: false, agent: agentWith("Callback Team") }), []), "an inactive agent opens nothing");

// ---- agents by tag ----
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: agentWith("Callback Team") }), ["callbacks"]), "the callback team tag opens Callbacks only");
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: agentWith("callback   team") }), ["callbacks"]), "tag matching ignores case and spacing");
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: agentWith("Callback Team(Submission)") }), ["pending"]), "the submission team tag opens the Pending screens (both tabs)");
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: agentWith("Uncategorised") }), ["call_activity"]), "an unmatched tag lands on Call Activity");
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: agentWith("") }), ["call_activity"]), "an empty tag lands on Call Activity");
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: agentWith(null) }), ["call_activity"]), "no tag lands on Call Activity");
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: null }), ["call_activity"]), "an agent login with no linked agent lands on Call Activity");
assert(eq(sectionsFor({ callbackTag: "Shared", pendingTag: "Shared", role: "agent", active: true, agent: agentWith("Shared") }), ["callbacks", "pending"]), "if both teams share a tag, both sections open");
assert(eq(sectionsFor({ callbackTag: "Insurance Team", pendingTag: "Callback Team(Submission)", role: "agent", active: true, agent: agentWith("Insurance Team") }), ["callbacks"]), "a renamed callback team tag is followed");
assert(eq(sectionsFor({ ...base, role: "agent", active: true, agent: agentWith("Callback Team", true) }), []), "a login whose agent is archived opens nothing");
// A tag that matches neither team must never open a team section by accident (for example an empty team setting).
assert(eq(sectionsFor({ callbackTag: "", pendingTag: "", role: "agent", active: true, agent: agentWith("") }), ["call_activity"]), "empty team tags never match an empty agent tag");

// ---- screens offered by the interface ----
assert(eq(allowedViews("admin", []), ["admin", "insurance-callbacks", "email", "pending-submissions"]), "an administrator is offered every screen");
assert(eq(allowedViews("cs_member", []), ["email"]), "an email member only has Email SLA");
assert(eq(allowedViews("agent", ["callbacks"]), ["insurance-callbacks"]), "a callback agent is offered Callbacks only");
assert(eq(allowedViews("agent", ["pending"]), ["pending-submissions"]), "a submission agent is offered the Pending screens only");
assert(eq(allowedViews("agent", ["call_activity"]), ["admin"]), "an untagged agent is offered Call Activity only");
assert(eq(allowedViews("agent", ["pending", "callbacks"]), ["insurance-callbacks", "pending-submissions"]), "an agent with two sections gets both in a fixed order");
assert(eq(allowedViews(null, []), []), "nobody signed in is offered nothing");
assert(!allowedViews("agent", ["callbacks"]).includes("email"), "an agent is never offered Email SLA");
assert(resolveView("pending-submissions", ["insurance-callbacks"]) === "insurance-callbacks", "a screen that is not allowed falls back to the first allowed one");
assert(resolveView("insurance-callbacks", ["insurance-callbacks", "pending-submissions"]) === "insurance-callbacks", "an allowed screen is kept");
assert(landingView("admin", []) === "admin", "administrators land on Call Activity");
assert(landingView("agent", ["pending"]) === "pending-submissions" && landingView("agent", ["call_activity"]) === "admin", "agents land on their first section");
assert(VIEW_LABELS.admin === "Call Activity", "the former Admin Dashboard is called Call Activity");

console.log("All authAccess tests passed!");
