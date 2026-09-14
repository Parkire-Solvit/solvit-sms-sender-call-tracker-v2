// Microsoft Graph transport only. No mailbox may be accessed unless it is
// explicitly listed in configuration. This module never fetches mail bodies.
export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  '@removed'?: { reason?: string };
}

export interface GraphDeltaPage {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailboxes: readonly string[];
}

const graphOrigin = 'https://graph.microsoft.com';
const emailPattern = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

export class GraphClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private readonly allowedMailboxes: ReadonlySet<string>;

  constructor(private readonly config: GraphConfig, private readonly http: typeof fetch = fetch) {
    if (!config.tenantId || !config.clientId || !config.clientSecret || !config.mailboxes?.length) {
      throw new Error('Microsoft Graph configuration is incomplete');
    }
    const normalized = config.mailboxes.map((value) => value.trim().toLowerCase());
    if (normalized.some((value) => !emailPattern.test(value)) || new Set(normalized).size !== normalized.length) {
      throw new Error('Microsoft Graph mailbox allowlist must contain unique email addresses');
    }
    this.allowedMailboxes = new Set(normalized);
  }

  private mailboxPath(mailbox: string): string {
    const normalized = mailbox.trim().toLowerCase();
    if (!this.allowedMailboxes.has(normalized)) throw new Error('Mailbox is not in the Microsoft Graph allowlist');
    return `/v1.0/users/${encodeURIComponent(normalized)}`;
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    const form = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const response = await this.http(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form },
    );
    if (!response.ok) throw new Error(`Microsoft token request failed (${response.status})`);
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('Microsoft token response contained no access token');
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(0, Number(data.expires_in) || 0) * 1000;
    return data.access_token;
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.http(url, {
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Prefer: 'IdType="ImmutableId"',
      },
    });
    if (!response.ok) throw new Error(`Microsoft Graph request failed (${response.status})`);
    return response.json() as Promise<T>;
  }

  async getDeltaPage(mailbox: string, folder: 'inbox' | 'sentitems', deltaLink?: string): Promise<GraphDeltaPage> {
    const path = `${this.mailboxPath(mailbox)}/mailFolders/${folder}/messages/delta`;
    const initialUrl = `${graphOrigin}${path}` +
      '?$select=id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime';
    const url = deltaLink || initialUrl;
    const parsed = new URL(url);
    if (parsed.origin !== graphOrigin || parsed.pathname !== path || parsed.username || parsed.password || parsed.hash) {
      throw new Error('Invalid Graph delta link');
    }
    const page = await this.getJson<GraphDeltaPage>(url);
    if (!Array.isArray(page.value)) throw new Error('Invalid Graph delta response');
    return page;
  }

  async getMessageHeaders(mailbox: string, messageId: string): Promise<GraphMessage> {
    if (!messageId || messageId.includes('/')) throw new Error('Invalid Graph message ID');
    const path = `${this.mailboxPath(mailbox)}/messages/${encodeURIComponent(messageId)}`;
    const url = `${graphOrigin}${path}?$select=id,internetMessageId,internetMessageHeaders`;
    const message = await this.getJson<GraphMessage>(url);
    if (!message.id || !Array.isArray(message.internetMessageHeaders)) {
      throw new Error('Invalid Graph message headers response');
    }
    return message;
  }
}
