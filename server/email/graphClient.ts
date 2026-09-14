// Microsoft Graph transport only. Business rules must not depend on Graph URLs.
export interface GraphMessage {
  id: string;
  conversationId: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
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
  mailbox: string;
}

export class GraphClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: GraphConfig, private readonly http: typeof fetch = fetch) {
    if (!config.tenantId || !config.clientId || !config.clientSecret || !config.mailbox) {
      throw new Error('Microsoft Graph configuration is incomplete');
    }
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

  async getDeltaPage(folder: 'inbox' | 'sentitems', deltaLink?: string): Promise<GraphDeltaPage> {
    const mailbox = encodeURIComponent(this.config.mailbox);
    const initialUrl = `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${folder}/messages/delta` +
      '?$select=id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime';
    const url = deltaLink || initialUrl;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'graph.microsoft.com' ||
        !parsed.pathname.startsWith(`/v1.0/users/${mailbox}/mailFolders/${folder}/messages/delta`)) {
      throw new Error('Invalid Graph delta link');
    }
    const response = await this.http(url, {
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Prefer: 'IdType="ImmutableId"',
      },
    });
    if (!response.ok) throw new Error(`Microsoft Graph delta request failed (${response.status})`);
    const page = await response.json() as GraphDeltaPage;
    if (!Array.isArray(page.value)) throw new Error('Invalid Graph delta response');
    return page;
  }
}
