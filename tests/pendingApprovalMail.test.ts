// tests/pendingApprovalMail.test.ts
// Sending through Microsoft Graph, with a fake Microsoft in place of the real one: nothing is ever sent.
import { ApprovalMailer, approvalMailConfigFromEnv, NOT_CONFIGURED, type ApprovalMailConfig } from "../pendingApprovalMail";

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

  console.log("All Pending Approval email tests passed!");
})();
