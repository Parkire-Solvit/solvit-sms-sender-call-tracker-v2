// pendingApprovalMail.ts
// Sends Pending Approval emails through Microsoft Graph (application permission Mail.Send), so each email comes from a
// real Solvit mailbox, lands in that mailbox's Sent Items, and can carry the Excel list.
//
// Until the Microsoft credentials are set the rest of the section works and sending reports "Email is not configured".
// Mail.Send as an application permission can send as any mailbox unless it is limited with an Exchange Application
// Access Policy (or RBAC for Applications): see the README before enabling it.
import { HttpError } from "./httpError";
import { okMail } from "./shared/pendingApproval";

export interface ApprovalMailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Optional allow-list of recipient domains (blank: any, as insurers are external). */
  allowedDomains: string[];
  /** Used when neither the login nor the settings name a sender. */
  fallbackFrom: string;
}

export interface MailAttachment { name: string; contentType?: string; contentBytes: string }
export interface OutgoingMail {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

export const NOT_CONFIGURED = "Email is not configured on the server (Microsoft tenant, client and secret).";
const MAX_RECIPIENTS = 50;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export function approvalMailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApprovalMailConfig | null {
  const tenantId = (env.MICROSOFT_TENANT_ID || "").trim(), clientId = (env.MICROSOFT_CLIENT_ID || "").trim(), clientSecret = (env.MICROSOFT_CLIENT_SECRET || "").trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return {
    tenantId, clientId, clientSecret,
    allowedDomains: (env.PENDING_APPROVAL_ALLOWED_RECIPIENT_DOMAINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    fallbackFrom: (env.PENDING_APPROVAL_MAIL_FROM || "").trim(),
  };
}

export class ApprovalMailer {
  private token = { value: "", exp: 0 };

  constructor(private readonly cfg: ApprovalMailConfig | null, private readonly http: typeof fetch = fetch) {}

  get configured(): boolean { return this.cfg !== null; }
  get fallbackFrom(): string { return this.cfg?.fallbackFrom || ""; }

  private async accessToken(): Promise<string> {
    const cfg = this.cfg;
    if (!cfg) throw new HttpError(501, NOT_CONFIGURED);
    if (this.token.value && Date.now() < this.token.exp - 60_000) return this.token.value;
    const r = await this.http(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new HttpError(502, "Microsoft sign-in failed: " + (j.error_description || j.error || r.status));
    this.token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 0) * 1000 };
    return j.access_token;
  }

  /** Throws an HttpError with a message that is safe to show. Returns when Microsoft has accepted the email. */
  async send(mail: OutgoingMail): Promise<void> {
    const cfg = this.cfg;
    if (!cfg) throw new HttpError(501, NOT_CONFIGURED);
    const to = mail.to || [], cc = mail.cc || [], all = [...to, ...cc];
    if (!to.length || !mail.subject || !mail.html) throw new HttpError(400, "To, subject and body are required.");
    const allowed = (a: string) => okMail(a) && (!cfg.allowedDomains.length || cfg.allowedDomains.includes(a.split("@")[1].toLowerCase()));
    if (all.length > MAX_RECIPIENTS || !all.every(allowed)) {
      throw new HttpError(400, "Invalid or not-allowed recipient address" + (cfg.allowedDomains.length ? ` (allowed domains: ${cfg.allowedDomains.join(", ")})` : "") + ".");
    }
    const attachments = mail.attachments || [];
    if (attachments.length > MAX_ATTACHMENTS) throw new HttpError(400, "Too many attachments.");
    for (const a of attachments) {
      if (!a?.name || typeof a.contentBytes !== "string" || !/^[A-Za-z0-9+/=\s]*$/.test(a.contentBytes)) throw new HttpError(400, "An attachment is not valid.");
      if (a.contentBytes.length * 0.75 > MAX_ATTACHMENT_BYTES) throw new HttpError(400, "An attachment is too large.");
    }
    if (!okMail(mail.from)) throw new HttpError(501, "No sender mailbox is set for you. Ask an administrator to set one in Pending Approval settings.");

    const message = {
      subject: String(mail.subject).slice(0, 255),
      body: { contentType: "HTML", content: mail.html },
      toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
      ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
      attachments: attachments.map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: String(a.name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 150),
        contentType: a.contentType || "application/octet-stream",
        contentBytes: a.contentBytes,
      })),
    };
    const r = await this.http(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mail.from)}/sendMail`, {
      method: "POST",
      headers: { Authorization: "Bearer " + (await this.accessToken()), "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (!r.ok) {
      let m: string | number = r.status;
      try { m = ((await r.json()) as any).error.message; } catch { /* keep the status */ }
      throw new HttpError(502, "Microsoft Graph refused the email: " + m);
    }
  }
}
