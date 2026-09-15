// Microsoft Graph transport only. No mailbox may be accessed unless it is
// explicitly listed in configuration. Only Graph's short bodyPreview is used
// transiently for approved CS-name routing; complete bodies are never fetched.
export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  bodyPreview?: string;
  webLink?: string;
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

export interface GraphMailFolder { id: string; displayName: string }

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

  async getMailFolders(mailbox: string): Promise<GraphMailFolder[]> {
    const base = `${graphOrigin}${this.mailboxPath(mailbox)}/mailFolders`;
    let url: string | undefined = `${base}?$select=id,displayName&$top=100`;
    const folders: GraphMailFolder[] = [];
    while (url) {
      const parsed = new URL(url);
      if (parsed.origin !== graphOrigin || parsed.pathname !== new URL(base).pathname) throw new Error('Invalid Graph folder continuation');
      const page: { value: GraphMailFolder[]; '@odata.nextLink'?: string } = await this.getJson(url);
      if (!Array.isArray(page.value)) throw new Error('Invalid Graph folder response');
      folders.push(...page.value.filter((folder) => folder.id && folder.displayName));
      url = page['@odata.nextLink'];
    }
    return folders;
  }

  async getDeltaPage(mailbox: string, folder: string, deltaLink?: string): Promise<GraphDeltaPage> {
    if (!folder || folder.includes('/')) throw new Error('Invalid Graph folder ID');
    const path = `${this.mailboxPath(mailbox)}/mailFolders/${encodeURIComponent(folder)}/messages/delta`;
    const initialUrl = `${graphOrigin}${path}` +
      '?$select=id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,bodyPreview,webLink,receivedDateTime,sentDateTime';
    const url = deltaLink || initialUrl;
    const parsed = new URL(url);
    // Graph may rewrite a continuation from /mailFolders/{id} to
    // /mailfolders('{id}'). Its state token is opaque, so compare the
    // resource identities rather than requiring the original URL spelling.
    const match = /^\/v1\.0\/users(?:\/([^/]+)|\('([^']+)'\))\/mailfolders(?:\/([^/]+)|\('([^']+)'\))\/messages\/delta$/i.exec(parsed.pathname);
    const linkMailbox = match ? decodeURIComponent(match[1] || match[2]) : '';
    const linkFolder = match ? decodeURIComponent(match[3] || match[4]) : '';
    const sameFolder = ['inbox', 'sentitems'].includes(folder.toLowerCase())
      ? linkFolder.toLowerCase() === folder.toLowerCase() : linkFolder === folder;
    if (parsed.origin !== graphOrigin || parsed.username || parsed.password || parsed.hash ||
        linkMailbox.toLowerCase() !== mailbox.trim().toLowerCase() || !sameFolder) {
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
    if (!message.id) {
      throw new Error('Invalid Graph message headers response');
    }
    // Graph can omit this optional property when a message has no stored
    // Internet headers (for example, some automated or sent messages).
    return { ...message, internetMessageHeaders: Array.isArray(message.internetMessageHeaders)
      ? message.internetMessageHeaders : [] };
  }
}
