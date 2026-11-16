// tests/authAccountsDb.test.ts
// Login accounts against a real database: agent links, live access from the agent's tag, and the safety rules.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
async function statusOf(fn: () => Promise<unknown>): Promise<number> {
  try { await fn(); } catch (e: any) { return typeof e?.status === "number" ? e.status : -1; }
  return 0;
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping auth accounts DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-accounts-test-"));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.chdir(dir);
  const load = (f: string) => import(pathToFileURL(path.join(root, f)).href);
  const { initDatabase } = await load("db.ts");
  const accounts = await load("server/auth/userAccounts.ts");
  const { loadAuthContext } = await load("server/auth/accountLoader.ts");
  const { createAgent } = await load("agentManagement.ts");
  const { getCallbackSettings } = await load("insuranceCallbacks.ts");
  const { getPendingSubmissionSettings } = await load("pendingSubmissions.ts");
  const db = await initDatabase();

  console.log("Running DB integration tests for login accounts and access...");

  // Settings rows exist with their default team tags.
  const cbTag = (await getCallbackSettings(db)).callback_team_tag;
  const psTag = (await getPendingSubmissionSettings(db)).callback_team_tag;
  assert(cbTag === "Callback Team" && psTag === "Callback Team(Submission)", `default team tags (got ${cbTag} / ${psTag})`);

  const admin = await accounts.createUserAccount(db, { username: "boss", password: "pw-boss-1", display_name: "Boss", role: "admin" });
  assert(admin.role === "admin" && admin.agent_id === null, "an administrator can be created");
  const adminCtx = await loadAuthContext(db, admin.id);
  assert(adminCtx && adminCtx.role === "admin" && adminCtx.sections.length === 3, "an administrator opens everything");

  // New accounts default to the Agent level.
  const mary = await createAgent(db, { name: "Mary Muriuki", tag: "Callback Team" });
  const kev = await createAgent(db, { name: "Kelvin Kimathi", tag: "Callback Team(Submission)" });
  const zed = await createAgent(db, { name: "Zed Other", tag: "Uncategorised" });
  const maryLogin = await accounts.createUserAccount(db, { username: "mary", password: "pw-mary-1", display_name: "Mary Muriuki", agent_id: mary.id });
  assert(maryLogin.role === "agent", "a new account defaults to Agent");
  assert(maryLogin.agent_id === mary.id && maryLogin.agent_name === "Mary Muriuki" && maryLogin.agent_tag === "Callback Team", "the login is linked to the agent");

  const ctx = async (id: number) => loadAuthContext(db, id);
  assert(JSON.stringify((await ctx(maryLogin.id))!.sections) === JSON.stringify(["callbacks"]), "the callback team tag opens Callbacks");
  assert((await ctx(maryLogin.id))!.agentName === "Mary Muriuki", "the context names the agent (used for 'logged by')");

  const kevLogin = await accounts.createUserAccount(db, { username: "kelvin", password: "pw-kel-1", agent_id: kev.id });
  assert(kevLogin.display_name === "kelvin", "the display name defaults to the username");
  assert(JSON.stringify((await ctx(kevLogin.id))!.sections) === JSON.stringify(["pending"]), "the submission tag opens the Pending screens");
  const zedLogin = await accounts.createUserAccount(db, { username: "zed", password: "pw-zed-1", agent_id: zed.id });
  assert(JSON.stringify((await ctx(zedLogin.id))!.sections) === JSON.stringify(["call_activity"]), "an unmatched tag lands on Call Activity");
  const loose = await accounts.createUserAccount(db, { username: "loose", password: "pw-loose-1" });
  assert(loose.agent_id === null && JSON.stringify((await ctx(loose.id))!.sections) === JSON.stringify(["call_activity"]), "an agent login with no linked agent lands on Call Activity");

  // Access follows the agent's tag at once.
  await db.execute("UPDATE agents SET tag = 'Callback Team(Submission)' WHERE id = ?", [mary.id]);
  assert(JSON.stringify((await ctx(maryLogin.id))!.sections) === JSON.stringify(["pending"]), "re-tagging an agent changes the login's sections immediately");
  await db.execute("UPDATE agents SET tag = 'Callback Team' WHERE id = ?", [mary.id]);
  // ...and follows a renamed team tag in the settings.
  await db.execute("UPDATE callback_settings SET callback_team_tag = 'Insurance Callbacks' WHERE id = 1");
  assert(JSON.stringify((await ctx(maryLogin.id))!.sections) === JSON.stringify(["call_activity"]), "changing the callback team tag in settings is followed immediately");
  await db.execute("UPDATE callback_settings SET callback_team_tag = 'Callback Team' WHERE id = 1");

  // Archived agent or inactive account: no access at all.
  await db.execute("UPDATE agents SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", [mary.id]);
  assert((await ctx(maryLogin.id)) === null, "a login whose agent is archived has no access");
  await db.execute("UPDATE agents SET archived_at = NULL WHERE id = ?", [mary.id]);
  assert((await ctx(maryLogin.id)) !== null, "reactivating the agent restores it");
  await accounts.updateUserAccount(db, maryLogin.id, { active: false });
  assert((await ctx(maryLogin.id)) === null, "a deactivated account has no access");
  await accounts.updateUserAccount(db, maryLogin.id, { active: true });
  assert((await ctx(999999)) === null, "an unknown account has no access");

  // One login per agent; archived or unknown agents cannot be linked.
  assert((await statusOf(() => accounts.createUserAccount(db, { username: "mary2", password: "pw", agent_id: mary.id }))) === 409, "an agent can have only one login");
  assert((await statusOf(() => accounts.createUserAccount(db, { username: "ghost", password: "pw", agent_id: 987654 }))) === 404, "an unknown agent cannot be linked");
  const gone = await createAgent(db, { name: "Departed Agent", tag: "Callback Team" });
  await db.execute("UPDATE agents SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", [gone.id]);
  assert((await statusOf(() => accounts.createUserAccount(db, { username: "gone", password: "pw", agent_id: gone.id }))) === 400, "an archived agent cannot be linked");
  assert((await statusOf(() => accounts.createUserAccount(db, { username: "MARY", password: "pw" }))) === 409, "usernames are unique regardless of case");
  assert((await statusOf(() => accounts.createUserAccount(db, { username: "", password: "pw" }))) === 400, "a username is required");
  assert((await statusOf(() => accounts.createUserAccount(db, { username: "nopw", password: "  " }))) === 400, "a password is required");
  assert((await statusOf(() => accounts.updateUserAccount(db, loose.id, { agent_id: mary.id }))) === 409, "linking to an agent that already has a login is refused");
  const relinked = await accounts.updateUserAccount(db, loose.id, { agent_id: (await createAgent(db, { name: "Free Agent", tag: "Callback Team" })).id });
  assert(relinked.agent_name === "Free Agent", "an unlinked login can be linked later");
  const unlinked = await accounts.updateUserAccount(db, loose.id, { agent_id: null });
  assert(unlinked.agent_id === null, "a link can be removed");

  // Agent options list who is free and who already has a login; archived agents are not offered.
  const options = await accounts.listAgentOptions(db);
  assert(options.find((o: any) => o.name === "Mary Muriuki")?.linked_username === "mary", "options show which agent already has a login");
  assert(!options.some((o: any) => o.name === "Departed Agent"), "archived agents are not offered");

  // The last active administrator cannot be demoted or deactivated.
  assert((await statusOf(() => accounts.updateUserAccount(db, admin.id, { role: "agent" }))) === 409, "the only administrator cannot be demoted");
  assert((await statusOf(() => accounts.updateUserAccount(db, admin.id, { active: false }))) === 409, "the only administrator cannot be deactivated");
  const second = await accounts.createUserAccount(db, { username: "boss2", password: "pw-boss-2", role: "admin" });
  const demoted = await accounts.updateUserAccount(db, admin.id, { role: "agent" });
  assert(demoted.role === "agent", "with a second administrator, the first can be demoted");
  assert((await statusOf(() => accounts.updateUserAccount(db, second.id, { active: false }))) === 409, "the remaining administrator is now protected");
  const restored = await accounts.updateUserAccount(db, admin.id, { role: "admin" });
  assert(restored.role === "admin", "an agent can be made an administrator again");

  // Deleting an agent unlinks the login instead of deleting it.
  await db.execute("DELETE FROM agents WHERE id = ?", [zed.id]);
  const after = await accounts.getUserAccount(db, zedLogin.id);
  assert(after && after.agent_id === null, "deleting an agent keeps the login, unlinked");
  assert(JSON.stringify((await ctx(zedLogin.id))!.sections) === JSON.stringify(["call_activity"]), "an unlinked login lands on Call Activity");

  // Existing rows from the earlier draft ('callback_agent') become 'agent' through the migration.
  const listed = await accounts.listUserAccounts(db);
  assert(listed.every((u: any) => u.role === "admin" || u.role === "agent"), "every account is an administrator or an agent");

  console.log("All auth accounts DB tests passed!");
}

main().catch((err) => { console.error(err); process.exit(1); });
