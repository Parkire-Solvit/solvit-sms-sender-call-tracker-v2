import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphClient } from './graphClient';

const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', mailbox: 'cs@example.com' };

test('delta transport uses app token and requests immutable message IDs', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const http = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(calls.length === 1
      ? JSON.stringify({ access_token: 'mock-token', expires_in: 3600 })
      : JSON.stringify({ value: [{ id: 'immutable-id', conversationId: 'conversation' }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/users/cs%40example.com/mailFolders/inbox/messages/delta?$deltatoken=abc' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new GraphClient(config, http as typeof fetch);
  const page = await client.getDeltaPage('inbox');
  assert.equal(page.value[0].id, 'immutable-id');
  assert.equal(new Headers(calls[1].init?.headers).get('Prefer'), 'IdType="ImmutableId"');
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), 'Bearer mock-token');
});

test('rejects delta links outside the configured Graph mailbox', async () => {
  const client = new GraphClient(config, (async () => { throw new Error('must not fetch'); }) as typeof fetch);
  await assert.rejects(client.getDeltaPage('inbox', 'https://example.net/steal'), /Invalid Graph delta link/);
});
