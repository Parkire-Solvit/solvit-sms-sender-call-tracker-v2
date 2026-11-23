// tests/pendingApprovalMail.test.ts
// Sending through Microsoft Graph, with a fake Microsoft in place of the real one: nothing is ever sent.
import { ApprovalMailer, approvalMailConfigFromEnv, explainRefusal, NOT_CONFIGURED, tokenRoles, type ApprovalMailConfig } from "../pendingApprovalMail";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
async function rejects(label: string, status: number, fn: () => Promise<unknown>, contains?: string) {
  try { await fn(); } catch (e: any) {
    assert(e.status === status, `${label}: expected HTTP ${status}, got ${e.status} (${e.message})`);
    if (contains) assert(String(e.message).includes(contains), `${label}: message should mention "${contains}" (got "${e.message}")`);
    return;
  }
  throw new Error(`Assertion failed: ${label}: nothing was thrown`);
}

console.log("Running tests for Pending Approval email sending...");

assert(approvalMailConfigFromEnv({}) === null, "no Microsoft settings: email is not configured");
assert(approvalMailConfigFromEnv({ MICROSOFT_TENANT_ID: "t", MICROSOFT_CLIENT_ID: "c" }) === null, "a partial configuration is not configured");
const fromEnv = approvalMailConfigFromEnv({ MICROSOFT_TENANT_ID: "t", MICROSOFT_CLIENT_ID: "c", MICROSOFT_CLIENT_SECRET: "s", PENDING_APPROVAL_ALLOWED_RECIPIENT_DOMAINS: "Solvit.co.ke, icea.example", PENDING_APPROVAL_MAIL_FROM: "cs@solvit.co.ke" });
assert(fromEnv!.allowedDomains.join() === "solvit.co.ke,icea.example" && fromEnv!.fallbackFrom === "cs@solvit.co.ke", "the Microsoft settings already used by the portal are reused");

const cfg: ApprovalMailConfig = { tenantId: "tenant", clientId: "client", clientSecret: "secret", allowedDomains: [], fallbackFrom: "" };
const mail = { from: "teresiah@solvit.co.ke", to: ["claims@icea.example"], cc: ["cs-team@solvit.co.ke"], subject: "Subject", html: "<p>Hi</p>" };

type Call = { url: string; init: any };
function fakeMicrosoft(opts: { tokenOk?: boolean; sendOk?: boolean } = {}) {
  const calls: Call[] = [];
  const http = (async (url: string, init: any) => {
    calls.push({ url, init });
    if (url.includes("login.microsoftonline.com")) {
      return opts.tokenOk === false
        ? { ok: false, status: 401, json: async () => ({ error_description: "bad secret" }) }
        : { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    }
    return opts.sendOk === false
      ? { ok: false, status: 403, json: async () => ({ error: { message: "Access is denied" } }) }
      : { ok: true, status: 202, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { calls, http };
}

await (async () => {
  await rejects("not configured", 501, () => new ApprovalMailer(null).send(mail), NOT_CONFIGURED);
  assert(new ApprovalMailer(null).configured === false && new ApprovalMailer(cfg).configured === true, "configured flag");

  const ms = fakeMicrosoft();
  const mailer = new ApprovalMailer(cfg, ms.http);
  await mailer.send({ ...mail, attachments: [{ name: "Pending/approvals:list.xlsx", contentType: "application/octet-stream", contentBytes: "QUJD" }] });
  const send = ms.calls.find((c) => c.url.includes("/sendMail"))!;
  assert(send.url === "https://graph.microsoft.com/v1.0/users/teresiah%40solvit.co.ke/sendMail", "sends from the sender's own mailbox");
  const body = JSON.parse(send.init.body);
  assert(body.saveToSentItems === true && body.message.toRecipients[0].emailAddress.address === "claims@icea.example" && body.message.ccRecipients[0].emailAddress.address === "cs-team@solvit.co.ke", "recipients, and the copy lands in Sent Items");
  assert(body.message.attachments[0].name === "Pending_approvals_list.xlsx" && body.message.attachments[0]["@odata.type"] === "#microsoft.graph.fileAttachment", "the Excel is attached with a safe file name");
  assert(send.init.headers.Authorization === "Bearer tok", "uses the Microsoft access token");
  await mailer.send(mail);
  assert(ms.calls.filter((c) => c.url.includes("login.microsoftonline.com")).length === 1, "the access token is reused, not requested again for every email");

  await rejects("no recipient", 400, () => mailer.send({ ...mail, to: [] }));
  await rejects("no subject", 400, () => mailer.send({ ...mail, subject: "" }));
  await rejects("bad address", 400, () => mailer.send({ ...mail, to: ["not-an-address"] }), "recipient");
  await rejects("too many recipients", 400, () => mailer.send({ ...mail, to: Array.from({ length: 51 }, (_, i) => `a${i}@x.com`) }));
  await rejects("too many attachments", 400, () => mailer.send({ ...mail, attachments: Array.from({ length: 6 }, () => ({ name: "a.xlsx", contentBytes: "QUJD" })) }), "attachments");
  await rejects("bad attachment", 400, () => mailer.send({ ...mail, attachments: [{ name: "a.xlsx", contentBytes: "<script>" }] }), "attachment");
  await rejects("huge attachment", 400, () => mailer.send({ ...mail, attachments: [{ name: "a.xlsx", contentBytes: "A".repeat(5 * 1024 * 1024) }] }), "too large");
  await rejects("no sender", 501, () => mailer.send({ ...mail, from: "" }), "sender mailbox");

  const limited = new ApprovalMailer({ ...cfg, allowedDomains: ["solvit.co.ke"] }, fakeMicrosoft().http);
  await rejects("domain not allowed", 400, () => limited.send(mail), "allowed domains: solvit.co.ke");
  await limited.send({ ...mail, to: ["a@solvit.co.ke"] });

  await rejects("sign-in fails", 502, () => new ApprovalMailer(cfg, fakeMicrosoft({ tokenOk: false }).http).send(mail), "bad secret");
  await rejects("Microsoft refuses", 502, () => new ApprovalMailer(cfg, fakeMicrosoft({ sendOk: false }).http).send(mail), "Access is denied");

  // ---------- The connection check ----------
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  assert(JSON.stringify(tokenRoles(jwt({ roles: ["Mail.Send", "Mail.Read"] }))) === '["Mail.Send","Mail.Read"]', "the permissions are read from the token");
  assert(JSON.stringify(tokenRoles(jwt({ aud: "x" }))) === "[]", "a token with no roles has none");
  assert(tokenRoles("garbage") === null && tokenRoles("a.@@@.c") === null, "an unreadable token gives null");
  const stepOf = (r: any, name: string) => r.steps.find((x: any) => x.name === name);
  const msFake = (opts: { roles?: string[]; tokenOk?: boolean; sendStatus?: number; network?: boolean } = {}) => {
    const calls: Call[] = [];
    const http = (async (url: string, init: any) => {
      calls.push({ url, init });
      if (opts.network) throw new TypeError("fetch failed");
      if (url.includes("login.microsoftonline.com")) {
        return opts.tokenOk === false
          ? { ok: false, status: 401, json: async () => ({ error_description: "AADSTS7000215: Invalid client secret" }) }
          : { ok: true, status: 200, json: async () => ({ access_token: jwt({ roles: opts.roles ?? ["Mail.Send"] }), expires_in: 3600 }) };
      }
      return (opts.sendStatus ?? 202) < 300 ? { ok: true, status: 202, json: async () => ({}) } : { ok: false, status: opts.sendStatus, json: async () => ({ error: { message: "Access is denied" } }) };
    }) as unknown as typeof fetch;
    return { calls, http };
  };

  const none = await new ApprovalMailer(null).checkConnection({ mailbox: "cs@solvit.co.ke", testTo: "me@solvit.co.ke" });
  assert(!none.ok && !none.attempted && stepOf(none, "Microsoft credentials on the server").ok === false && none.steps.length === 1, "no credentials: fails at the first step and nothing is remembered");

  const badSecret = await new ApprovalMailer(cfg, msFake({ tokenOk: false }).http).checkConnection({ mailbox: "cs@solvit.co.ke", testTo: "me@solvit.co.ke" });
  assert(!badSecret.ok && badSecret.attempted && stepOf(badSecret, "Sign in to Microsoft").ok === false && stepOf(badSecret, "Sign in to Microsoft").detail.includes("client secret has not expired"), "a bad secret fails at sign-in and says what to check");

  const offline = await new ApprovalMailer(cfg, msFake({ network: true }).http).checkConnection({ mailbox: "cs@solvit.co.ke", testTo: "me@solvit.co.ke" });
  const offlineDetail = stepOf(offline, "Sign in to Microsoft").detail;
  assert(!offline.ok && offlineDetail.includes("Could not reach Microsoft") && !offlineDetail.includes("client secret"), "a network failure is reported as one, not blamed on the secret");

  const noPerm = msFake({ roles: [] });
  const noPermRes = await new ApprovalMailer(cfg, noPerm.http).checkConnection({ mailbox: "cs@solvit.co.ke", testTo: "me@solvit.co.ke" });
  assert(stepOf(noPermRes, "Mail.Send permission").ok === null && stepOf(noPermRes, "Mail.Send permission").detail.includes("grant admin consent"), "a missing Mail.Send is flagged as not proven, with what to do");
  assert(noPermRes.ok && noPermRes.attempted, "an accepted test email still counts as proof (for example when sending is controlled by Exchange RBAC)");

  const noMailbox = await new ApprovalMailer(cfg, msFake().http).checkConnection({ mailbox: "", testTo: "me@solvit.co.ke" });
  assert(!noMailbox.ok && !noMailbox.attempted && stepOf(noMailbox, "Sender mailbox").ok === false, "no sender mailbox: reported, and nothing remembered");

  const noTest = msFake();
  const noTestRes = await new ApprovalMailer(cfg, noTest.http).checkConnection({ mailbox: "cs@solvit.co.ke" });
  assert(!noTestRes.ok && !noTestRes.attempted && stepOf(noTestRes, "Test email").ok === null && !noTest.calls.some((c) => c.url.includes("/sendMail")), "without a test address nothing is sent and nothing is verified");
  assert(stepOf(noTestRes, "Mail.Send permission").ok === true, "the permission step passes when the token carries Mail.Send");

  const badTo = await new ApprovalMailer(cfg, msFake().http).checkConnection({ mailbox: "cs@solvit.co.ke", testTo: "nope" });
  assert(!badTo.ok && !badTo.attempted && stepOf(badTo, "Test email").ok === false, "an invalid test address is rejected before anything is sent");

  const denied = await new ApprovalMailer(cfg, msFake({ sendStatus: 403 }).http).checkConnection({ mailbox: "cs@solvit.co.ke", testTo: "me@solvit.co.ke" });
  assert(!denied.ok && denied.attempted && stepOf(denied, "Test email").detail.includes("Access is denied") && stepOf(denied, "Test email").detail.includes("Exchange access policy"), "Microsoft refusing the mailbox is reported with the likely fix");

  const good = msFake();
  const goodRes = await new ApprovalMailer(cfg, good.http).checkConnection({ mailbox: "cs@solvit.co.ke", testTo: "me@solvit.co.ke", requestedBy: "Admin <b>" });
  assert(goodRes.ok && goodRes.attempted && goodRes.steps.every((x) => x.ok === true), "all steps pass and the test email is accepted: verified");
  const testBody = JSON.parse(good.calls.find((c) => c.url.includes("/sendMail"))!.init.body);
  assert(good.calls.find((c) => c.url.includes("/sendMail"))!.url.includes("cs%40solvit.co.ke") && testBody.message.toRecipients[0].emailAddress.address === "me@solvit.co.ke", "the test email goes from the chosen mailbox to the chosen address");
  assert(testBody.message.body.content.includes("Admin &lt;b&gt;") && !testBody.message.body.content.includes("Admin <b>"), "the requester's name is escaped in the test email");

  assert(explainRefusal(403, "a@b.co", "denied").includes("Mail.Send") && explainRefusal(404, "a@b.co", "gone").includes("not found as a mailbox") && explainRefusal(500, "a@b.co", "oops").endsWith("Microsoft said: oops"), "refusals explain what to fix");
  await rejects("a network failure while sending", 502, () => new ApprovalMailer(cfg, msFake({ network: true }).http).send(mail), "Could not reach Microsoft");

  console.log("All Pending Approval email tests passed!");
})();
