// tests/routeGuards.test.ts
// Audit of server.ts: every API route has the access rule we intend. A route that is added without a rule, or whose
// rule is loosened by accident, fails here. To add or change a route, update the policy table below on purpose.
import fs from "node:fs";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const ADMIN = "admin";
const AUTH = "any signed-in account";
const PUBLIC = "public";
const CA = "section: call_activity";
const CB = "section: callbacks";
const PS = "section: pending";

// method + path -> rule
const POLICY: Record<string, string> = {
  // Sign-in and the Android app (no login by design)
  "GET /api/email-auth/start": PUBLIC, "GET /api/email-auth/callback": PUBLIC, "GET /api/db-status": PUBLIC,
  "POST /api/login": PUBLIC, "GET /api/session": PUBLIC, "POST /api/logout": PUBLIC,
  "POST /api/log-agent": PUBLIC, "POST /api/log-event": PUBLIC, "GET /api/agent-updates/:id": PUBLIC, "GET /api/app-config/:id": PUBLIC,
  "GET /api/session-ping": AUTH,

  // Administration
  "POST /api/daily-summary/send-test": ADMIN,
  "GET /api/users": ADMIN, "GET /api/users/agent-options": ADMIN, "POST /api/users": ADMIN, "PATCH /api/users/:id": ADMIN, "POST /api/users/:id/reset-password": ADMIN,
  "GET /api/agents/needs-review": ADMIN, "POST /api/agents/:id/keep-separate": ADMIN, "POST /api/agents/:id/merge-into/:targetId": ADMIN,
  "POST /api/update-agent-tag": ADMIN, "POST /api/update-agent-name": ADMIN, "POST /api/agents/:id/archive": ADMIN, "POST /api/agents/:id/reactivate": ADMIN,
  "POST /api/agents": ADMIN, "DELETE /api/agents/:id": ADMIN, "GET /api/archived-agents": ADMIN,
  "GET /api/settings": ADMIN, "POST /api/settings": ADMIN, "GET /api/events-detail": ADMIN,
  "GET /api/internal-contacts": ADMIN, "POST /api/internal-contacts": ADMIN, "DELETE /api/internal-contacts/:id": ADMIN, "GET /api/export-full-data": ADMIN,
  "GET /api/data-reset/:section/preview": ADMIN, "POST /api/data-reset/:section/backup": ADMIN,
  "POST /api/data-reset/:section/delete-all": ADMIN, "POST /api/data-reset/:section/undo-last-upload": ADMIN,

  // Call Activity (read only for agents)
  "GET /api/stats": CA, "GET /api/compliance-stats": CA, "GET /api/search-contacts": CA, "GET /api/contact-history": CA,

  // Callbacks: agents with the callback team tag read and log outcomes; everything that changes the work is admin only
  "GET /api/channel-partner-allocations": CB, "GET /api/callback-settings": CB, "GET /api/callback-jobs": CB,
  "POST /api/callback-jobs/:id/outcome": CB, "POST /api/callback-jobs/:id/log": CB, "GET /api/callback-jobs/:id/logs": CB, "GET /api/agent-kpi/callbacks": CB,
  "POST /api/channel-partner-allocations": ADMIN, "POST /api/callback-settings": ADMIN, "POST /api/callback-jobs/import": ADMIN,
  "PATCH /api/callback-jobs/:id/assign": ADMIN, "POST /api/callback-jobs/assign-bulk": ADMIN, "POST /api/callback-jobs/:id/add-phone": ADMIN,
  "GET /api/callback-jobs/unmatched-activity": ADMIN, "PATCH /api/callback-jobs/:id/status": ADMIN,
  "GET /api/callback-jobs/max-attempts-report": ADMIN, "GET /api/callback-jobs/max-attempts-report/excel": ADMIN,
  "GET /api/callback-jobs/max-attempts-report/csv": ADMIN, "GET /api/callback-jobs/one-time-reopen/report": ADMIN,

  // Pending Inspection and Pending Submission
  "GET pendingSettingsPaths": PS, "PUT pendingSettingsPaths": ADMIN, "POST pendingSettingsPaths": ADMIN,
  "GET /api/pending-submissions/outcomes": PS, "GET /api/pending-submissions/agents": PS, "GET /api/pending-submissions/jobs": PS,
  "POST /api/pending-submissions/jobs/:id/log": PS, "GET /api/pending-submissions/jobs/:id/logs": PS, "GET /api/agent-kpi/pending-submissions": PS,
  "POST /api/pending-submissions/import": ADMIN, "GET /api/pending-submissions/max-attempts-report": ADMIN,
  "GET /api/pending-submissions/max-attempts-report/excel": ADMIN, "POST /api/pending-submissions/jobs/:id/resend-notification": ADMIN,
  "GET /api/pending-submissions/team": ADMIN, "POST /api/pending-submissions/reassign-open": ADMIN,
  "GET /api/pending-submissions/integrations": ADMIN, "PUT /api/pending-submissions/integrations/:integration": ADMIN,
  "POST /api/pending-submissions/integrations/host_pinnacle/test-sms": ADMIN,
};

function ruleOf(guard: string | undefined): string {
  if (!guard) return PUBLIC;
  if (guard === "requireAdmin") return ADMIN;
  if (guard === "requireAuth") return AUTH;
  const m = guard.match(/^requireSection\('(\w+)'\)$/);
  return m ? `section: ${m[1]}` : `UNKNOWN GUARD ${guard}`;
}

console.log("Running route guard audit...");

const source = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
const found = new Map<string, string>();
const pattern = /^\s*app\.(get|post|put|patch|delete)\(\s*([^,]+?),\s*(?:(requireAdmin|requireAuth|requireSection\([^)]*\))\s*,)?/gm;
for (const m of source.matchAll(pattern)) {
  const route = m[2].trim();
  if (!(route.startsWith('"/api') || route.startsWith("'/api") || route === "pendingSettingsPaths")) continue;
  const key = `${m[1].toUpperCase()} ${route.replace(/^["']|["']$/g, "")}`;
  assert(!found.has(key), `${key} is declared twice`);
  found.set(key, ruleOf(m[3]));
}

assert(found.size > 70, `the audit found the routes (found ${found.size})`);
const problems: string[] = [];
for (const [key, rule] of found) {
  if (!(key in POLICY)) problems.push(`NEW ROUTE with no policy: ${key} (currently ${rule})`);
  else if (POLICY[key] !== rule) problems.push(`CHANGED: ${key} is "${rule}" but the policy says "${POLICY[key]}"`);
}
for (const key of Object.keys(POLICY)) if (!found.has(key)) problems.push(`MISSING route: ${key} is in the policy but not in server.ts`);
assert(problems.length === 0, `route guard problems:\n  ${problems.join("\n  ")}`);

// Nothing that changes data or reads admin-only information may be public, apart from sign-in and the Android app.
const publicRoutes = [...found].filter(([, r]) => r === PUBLIC).map(([k]) => k).sort();
assert(
  publicRoutes.join(",") === [
    "GET /api/agent-updates/:id", "GET /api/app-config/:id", "GET /api/db-status", "GET /api/email-auth/callback", "GET /api/email-auth/start",
    "GET /api/session", "POST /api/log-agent", "POST /api/log-event", "POST /api/login", "POST /api/logout",
  ].sort().join(","),
  `only sign-in and the Android app routes are public (got ${publicRoutes.join(", ")})`
);

// The access check must be installed before any guarded route and before the Email SLA router.
const attachAt = source.indexOf("app.use('/api', attachAuth(");
const emailAt = source.indexOf("app.use('/api/email'");
const firstGuardedAt = source.search(/app\.(get|post|put|patch|delete)\([^)]*require(Admin|Auth|Section)/);
assert(attachAt > 0 && attachAt < emailAt && attachAt < firstGuardedAt, "the access check is mounted before the Email SLA router and every guarded route");

console.log("All route guard audit checks passed!");
