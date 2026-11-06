// tests/authSession.test.ts
// The signed session cookie and the route guards, exercised over real HTTP against a small Express app.
import express from "express";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import {
  attachAuth, authContext, clearAdminSession, isAdminRequest, readSession, requireAdmin, requireAuth, requireSection,
  setUserSession, type AuthContext,
} from "../server/auth/adminSession";
import { sectionsFor } from "../server/auth/access";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function cookieFor(userId: number): string {
  const headers = new Map<string, string>();
  const request = { headers: {}, secure: false } as Request;
  const response = { setHeader: (k: string, v: string) => { headers.set(k, v); } } as Response;
  setUserSession(request, response, userId);
  const cookie = headers.get("Set-Cookie")!;
  assert(/HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie), "the cookie is HttpOnly and SameSite=Strict");
  return cookie.split(";")[0];
}

// A stand-in for the database: accounts that can be changed while the server runs.
const accounts = new Map<number, { role: "admin" | "agent"; active: boolean; tag: string | null; archived: boolean; hasAgent: boolean }>([
  [1, { role: "admin", active: true, tag: null, archived: false, hasAgent: false }],
  [2, { role: "agent", active: true, tag: "Callback Team", archived: false, hasAgent: true }],
  [3, { role: "agent", active: true, tag: "Callback Team(Submission)", archived: false, hasAgent: true }],
  [4, { role: "agent", active: true, tag: "Uncategorised", archived: false, hasAgent: true }],
  [5, { role: "agent", active: true, tag: "Callback Team", archived: true, hasAgent: true }],
]);
let loaderShouldFail = false;
async function loader(userId: number): Promise<AuthContext | null> {
  if (loaderShouldFail) throw new Error("database down");
  const a = accounts.get(userId);
  if (!a) return null;
  const sections = sectionsFor({
    role: a.role, active: a.active,
    agent: a.hasAgent ? { name: `Agent ${userId}`, tag: a.tag, archived: a.archived } : null,
    callbackTag: "Callback Team", pendingTag: "Callback Team(Submission)",
  });
  if (sections.length === 0) return null;
  return { userId, username: `user${userId}`, displayName: `User ${userId}`, role: a.role, agentId: a.hasAgent ? userId : null, agentName: a.hasAgent ? `Agent ${userId}` : null, sections };
}

async function main() {
  console.log("Running tests for the session cookie and route guards...");

  // ---- cookie ----
  const c1 = cookieFor(1);
  const fake = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as Request;
  assert(readSession(fake(c1))?.userId === 1, "a valid cookie names its account");
  assert(readSession(fake(`${c1}x`)) === null, "a tampered signature is rejected");
  assert(readSession(fake(c1.replace(/=\d+\./, "=99999999999999."))) === null, "a changed expiry is rejected");
  assert(readSession(fake(c1.replace(/\.1\./, ".2."))) === null, "a changed account id is rejected (cannot become another user)");
  assert(readSession(fake()) === null, "no cookie is no session");
  const old = "solvit_admin_session=" + (Date.now() + 1000) + ".abc"; // the earlier two-part format
  assert(readSession(fake(old)) === null, "cookies from the earlier format simply require a new login");
  const expired = (() => { const h = new Map<string, string>(); const realNow = Date.now; Date.now = () => realNow() - 9 * 3600 * 1000; setUserSession({ headers: {} } as Request, { setHeader: (k: string, v: string) => h.set(k, v) } as unknown as Response, 1); Date.now = realNow; return h.get("Set-Cookie")!.split(";")[0]; })();
  assert(readSession(fake(expired)) === null, "an expired cookie is rejected");
  const cleared = new Map<string, string>();
  clearAdminSession({ headers: {}, secure: false } as Request, { setHeader: (k: string, v: string) => cleared.set(k, v) } as unknown as Response);
  assert(/Max-Age=0/.test(cleared.get("Set-Cookie")!), "logout clears the cookie");
  assert(!/admin|role/i.test(c1.split("=")[1]), "the cookie carries no role: access is looked up in the database");

  // ---- guards over HTTP ----
  const app = express();
  app.use("/api", attachAuth(loader));
  const ok = (_req: Request, res: Response) => { res.json({ ok: true, auth: authContext(_req)?.userId ?? null, admin: isAdminRequest(_req) }); };
  app.get("/api/any", requireAuth, ok);
  app.get("/api/admin-only", requireAdmin, ok);
  app.get("/api/callbacks", requireSection("callbacks"), ok);
  app.get("/api/pending", requireSection("pending"), ok);
  app.get("/api/activity", requireSection("call_activity"), ok);
  app.get("/api/open", ok);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const status = async (path: string, cookie?: string) => (await fetch(base + path, { headers: cookie ? { cookie } : {} })).status;

  try {
    const [admin, cb, ps, plain, archived, ghost] = [cookieFor(1), cookieFor(2), cookieFor(3), cookieFor(4), cookieFor(5), cookieFor(404)];
    const matrix: Array<[string, string, Array<[string | undefined, number]>]> = [
      ["/api/any", "any signed-in account", [[undefined, 401], [admin, 200], [cb, 200], [ps, 200], [plain, 200], [archived, 401], [ghost, 401]]],
      ["/api/admin-only", "administrators only", [[undefined, 401], [admin, 200], [cb, 403], [ps, 403], [plain, 403], [archived, 401]]],
      ["/api/callbacks", "callbacks section", [[undefined, 401], [admin, 200], [cb, 200], [ps, 403], [plain, 403], [archived, 401]]],
      ["/api/pending", "pending section", [[undefined, 401], [admin, 200], [cb, 403], [ps, 200], [plain, 403], [archived, 401]]],
      ["/api/activity", "call activity", [[undefined, 401], [admin, 200], [cb, 403], [ps, 403], [plain, 200], [archived, 401]]],
    ];
    const names = new Map<string | undefined, string>([[undefined, "no login"], [admin, "admin"], [cb, "callback agent"], [ps, "submission agent"], [plain, "untagged agent"], [archived, "archived agent"], [ghost, "unknown account"]]);
    for (const [path, label, rows] of matrix) {
      for (const [cookie, expected] of rows) {
        const got = await status(path, cookie);
        assert(got === expected, `${label}: ${names.get(cookie)} should get ${expected} on ${path}, got ${got}`);
      }
    }
    assert((await status("/api/open", `${admin}x`)) === 200, "a route with no guard stays open and a bad cookie does not break it");
    assert((await status("/api/any", `${admin}x`)) === 401, "a tampered cookie is not a session");

    // Access follows the database at once (no waiting for the cookie to expire).
    assert((await status("/api/callbacks", cb)) === 200, "before: the callback agent is in");
    accounts.get(2)!.tag = "Uncategorised"; // re-tagged
    assert((await status("/api/callbacks", cb)) === 403, "re-tagging removes Callbacks immediately");
    assert((await status("/api/activity", cb)) === 200, "and the agent now lands on Call Activity");
    accounts.get(2)!.tag = "Callback Team";
    assert((await status("/api/callbacks", cb)) === 200, "tagging back restores it immediately");
    accounts.get(2)!.active = false;
    assert((await status("/api/any", cb)) === 401, "deactivating an account ends its access immediately");
    accounts.get(2)!.active = true;
    accounts.get(2)!.archived = true;
    assert((await status("/api/callbacks", cb)) === 401, "archiving the agent ends the login's access immediately");
    accounts.get(2)!.archived = false;
    assert((await status("/api/admin-only", admin)) === 200, "before: the administrator is in");
    accounts.get(1)!.role = "agent";
    assert((await status("/api/admin-only", admin)) === 403, "demoting an administrator takes effect immediately, even with an old cookie");
    accounts.get(1)!.role = "admin";

    // The identity is the verified one, never the cookie's say-so.
    const body = await (await fetch(base + "/api/any", { headers: { cookie: cb } })).json();
    assert(body.auth === 2 && body.admin === false, "the request carries the verified account");

    // If the database cannot be read, the request is refused, not guessed.
    loaderShouldFail = true;
    assert((await status("/api/any", admin)) === 503, "a database failure refuses the request");
    assert((await status("/api/open")) === 200, "requests with no cookie never touch the database");
    loaderShouldFail = false;
  } finally {
    server.close();
  }

  console.log("All session and guard tests passed!");
}

main().catch((err) => { console.error(err); process.exit(1); });
