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
    const r = await this.reach("sign in", () => this.http(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    }));
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new HttpError(502, "Microsoft sign-in failed: " + (j.error_description || j.error || r.status));
    this.token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 0) * 1000 };
    return j.access_token;
  }

  /** A network failure (firewall, DNS, Microsoft unreachable) is reported as that, not as a bad credential. */
  private async reach(what: string, call: () => Promise<Response>): Promise<Response> {
    try {
      return await call();
    } catch (e) {
      throw new HttpError(502, `Could not reach Microsoft to ${what} (${(e as Error).message}). Check the server's network access to login.microsoftonline.com and graph.microsoft.com.`);
    }
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
    const bearer = await this.accessToken();
    const r = await this.reach("send the email", () => this.http(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mail.from)}/sendMail`, {
      method: "POST",
      headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    }));
    if (!r.ok) {
      let m: string | number = r.status;
      try { m = ((await r.json()) as any).error.message; } catch { /* keep the status */ }
      throw new HttpError(502, explainRefusal(r.status, mail.from, String(m)));
    }
  }

  /**
   * Checks, step by step, whether emails can really be sent as `mailbox`, and (when `testTo` is given) sends a test email.
   * Only a test email that Microsoft accepted counts as proof: the permission and the mailbox policy cannot be seen
   * without trying to send. Never throws: every problem is reported as a failed step with what to do about it.
   */
  async checkConnection(opts: { mailbox: string; testTo?: string; requestedBy?: string }): Promise<MailCheckResult> {
    const steps: MailCheckStep[] = [];
    const finish = (message: string, ok = false, attempted = true): MailCheckResult => ({ ok, attempted, message, steps });
    const cfg = this.cfg;
    if (!cfg) {
      steps.push({ name: "Microsoft credentials on the server", ok: false, detail: "MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are not all set in the server environment. Set them, redeploy, and check again." });
      return finish("The Microsoft credentials are missing on the server.", false, false);
    }
    steps.push({ name: "Microsoft credentials on the server", ok: true, detail: "Tenant, client ID and client secret are set." });

    let token = "";
    try {
      token = await this.accessToken();
      steps.push({ name: "Sign in to Microsoft", ok: true, detail: "Microsoft accepted the app's credentials." });
    } catch (e) {
      const msg = (e as Error).message;
      steps.push({ name: "Sign in to Microsoft", ok: false, detail: msg.startsWith("Microsoft sign-in failed") ? `${msg}. Check that the client secret has not expired or been replaced, and that the tenant and client IDs belong to the same app.` : msg });
      return finish("Microsoft refused to sign the app in.");
    }

    const roles = tokenRoles(token);
    if (roles === null) {
      steps.push({ name: "Mail.Send permission", ok: null, detail: "The permissions could not be read from Microsoft's token. The test email below is the real proof." });
    } else if (roles.includes("Mail.Send")) {
      steps.push({ name: "Mail.Send permission", ok: true, detail: "The app has the Mail.Send application permission with admin consent." });
    } else {
      steps.push({
        name: "Mail.Send permission", ok: null,
        detail: `Mail.Send was not found among the app's permissions (${roles.length ? roles.join(", ") : "none"}). Add the Microsoft Graph application permission Mail.Send and grant admin consent. If you control sending only with Exchange RBAC for Applications this can be expected, and the test email is the real proof.`,
      });
    }

    const mailbox = (opts.mailbox || "").trim();
    if (!okMail(mailbox)) {
      steps.push({ name: "Sender mailbox", ok: false, detail: "No valid sender mailbox is set. Enter a default sender mailbox below (an Exchange mailbox, for example cs-team@solvit.co.ke), save, and check again." });
      return finish("There is no sender mailbox to send from.", false, false);
    }
    steps.push({ name: "Sender mailbox", ok: true, detail: `Emails will be sent as ${mailbox}.` });

    const testTo = (opts.testTo || "").trim();
    if (!testTo) {
      steps.push({ name: "Test email", ok: null, detail: "Not sent. Enter your own email address and run the check again: only a delivered test email proves this mailbox is allowed to send." });
      return finish("Credentials are fine, but sending has not been proven. Send a test email.", false, false);
    }
    if (!okMail(testTo)) {
      steps.push({ name: "Test email", ok: false, detail: "That is not a valid email address." });
      return finish("The test address is not valid.", false, false);
    }
    try {
      await this.send({
        from: mailbox, to: [testTo], subject: "Solvit Pending Approval: email test",
        html: `<p>This is a test email from the Solvit portal${opts.requestedBy ? `, requested by ${escapeHtml(opts.requestedBy)}` : ""}.</p><p>It confirms that Pending Approval can send email as <b>${escapeHtml(mailbox)}</b>. No action is needed.</p>`,
      });
    } catch (e) {
      steps.push({ name: "Test email", ok: false, detail: (e as Error).message });
      return finish(`Microsoft would not send as ${mailbox}.`);
    }
    steps.push({ name: "Test email", ok: true, detail: `Microsoft accepted a test email from ${mailbox} to ${testTo}. Confirm it arrived (check junk too).` });
    return finish(`Verified: emails can be sent as ${mailbox}.`, true);
  }
}

export interface MailCheckStep { name: string; ok: boolean | null; detail: string }
export interface MailCheckResult {
  /** True only when a test email was accepted by Microsoft. */
  ok: boolean;
  /** Whether the check reached a conclusion that should be remembered (a test email was tried, or a hard failure found). */
  attempted: boolean;
  message: string;
  steps: MailCheckStep[];
}

const escapeHtml = (v: string): string => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);

/** The application permissions in a Microsoft access token (its `roles` claim), or null when they cannot be read. */
export function tokenRoles(jwt: string): string[] | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return Array.isArray(claims.roles) ? claims.roles.map(String) : [];
  } catch {
    return null;
  }
}

/** A refusal from Microsoft in words that say what to fix. */
export function explainRefusal(status: number, from: string, microsoft: string): string {
  const said = `Microsoft said: ${microsoft}`;
  if (status === 401 || status === 403) {
    return `Microsoft Graph refused the email: it will not let the app send as ${from}. The app needs the Mail.Send application permission with admin consent, and ${from} must be allowed by the Exchange access policy. An administrator can run the check in Pending Approval, Import & Settings. ${said}`;
  }
  if (status === 404) {
    return `Microsoft Graph refused the email: ${from} was not found as a mailbox. Use a real Exchange mailbox (a shared mailbox works), not a group or alias. ${said}`;
  }
  return `Microsoft Graph refused the email: ${said}`;
}
