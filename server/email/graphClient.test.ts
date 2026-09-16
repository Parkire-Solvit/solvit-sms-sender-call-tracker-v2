import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphClient } from './graphClient';

const config = {
  tenantId: 'tenant', clientId: 'client', clientSecret: 'secret',
  mailboxes: ['mercy@example.com', 'joyce@example.com'],
};

test('delta transport selects allowed mailbox, metadata and immutable IDs', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const http = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(calls.length === 1
      ? JSON.stringify({ access_token: 'mock-token', expires_in: 3600 })
      : JSON.stringify({ value: [{ id: 'immutable-id', internetMessageId: '<mail@example.com>' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new GraphClient(config, http as typeof fetch);
  const page = await client.getDeltaPage('mercy@example.com', 'inbox');
  assert.equal(page.value[0].id, 'immutable-id');
  assert.match(calls[1].url, /users\/mercy%40example\.com\/mailFolders\/inbox\/messages\/delta/);
  assert.match(calls[1].url, /internetMessageId/);
  assert.equal(new Headers(calls[1].init?.headers).get('Prefer'), 'IdType="ImmutableId"');
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), 'Bearer mock-token');
});

test('rejects mailboxes outside the allowlist before requesting a token', async () => {
  const client = new GraphClient(config, (async () => { throw new Error('must not fetch'); }) as typeof fetch);
  await assert.rejects(client.getDeltaPage('outsider@example.com', 'inbox'), /allowlist/);
  await assert.rejects(client.getMessageHeaders('outsider@example.com', 'abc'), /allowlist/);
});

test('rejects delta links for another mailbox, folder, host or path', async () => {
  const client = new GraphClient(config, (async () => { throw new Error('must not fetch'); }) as typeof fetch);
  const links = [
    'https://example.net/steal',
    'https://graph.microsoft.com/v1.0/users/joyce%40example.com/mailFolders/inbox/messages/delta',
    'https://graph.microsoft.com/v1.0/users/mercy%40example.com/mailFolders/sentitems/messages/delta',
    'https://graph.microsoft.com/v1.0/users/mercy%40example.com/mailFolders/inbox/messages/delta/extra',
  ];
  for (const link of links) {
    await assert.rejects(client.getDeltaPage('mercy@example.com', 'inbox', link), /Invalid Graph delta link/);
  }
});

test('accepts Graph canonical parenthesized folder continuation for the same mailbox', async () => {
  const calls: string[] = [];
  const http = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(calls.length === 1
      ? { access_token: 'mock-token', expires_in: 3600 }
      : { value: [], '@odata.deltaLink': String(input) }), { status: 200 });
  };
  const client = new GraphClient(config, http as typeof fetch);
  const link = "https://graph.microsoft.com/v1.0/users/mercy@example.com/mailfolders('inbox')/messages/delta?$skiptoken=opaque";
  await client.getDeltaPage('mercy@example.com', 'inbox', link);
  assert.equal(calls[1], link);
  await assert.rejects(client.getDeltaPage('joyce@example.com', 'inbox', link), /Invalid Graph delta link/);
});

test('fetches only reply-linking headers and never the message body', async () => {
  const calls: string[] = [];
  const http = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(calls.length === 1
      ? JSON.stringify({ access_token: 'mock-token', expires_in: 3600 })
      : JSON.stringify({ id: 'abc', internetMessageHeaders: [{ name: 'In-Reply-To', value: '<parent@example.com>' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new GraphClient(config, http as typeof fetch);
  const message = await client.getMessageHeaders('joyce@example.com', 'abc');
  assert.equal(message.internetMessageHeaders?.[0].value, '<parent@example.com>');
  assert.match(calls[1], /\$select=id,internetMessageId,internetMessageHeaders/);
  assert.doesNotMatch(calls[1], /body|attachments/i);
});

test('accepts messages with no Internet headers', async () => {
  const http = async (_input: string | URL | Request) => new Response(JSON.stringify(
    String(_input).includes('/token') ? { access_token: 'mock-token', expires_in: 3600 } : { id: 'automated-message' },
  ), { status: 200 });
  const client = new GraphClient(config, http as typeof fetch);
  assert.deepEqual((await client.getMessageHeaders('mercy@example.com', 'automated-message')).internetMessageHeaders, []);
});

test('rejects duplicate or malformed mailbox configuration', () => {
  assert.throws(() => new GraphClient({ ...config, mailboxes: ['mercy@example.com', 'MERCY@example.com'] }), /allowlist/);
  assert.throws(() => new GraphClient({ ...config, mailboxes: ['not-an-email'] }), /allowlist/);
});

test('discovers the CS Team folder within an allowed personal mailbox', async () => {
  const calls: string[] = [];
  const http = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(calls.length === 1
      ? { access_token: 'mock-token', expires_in: 3600 }
      : { value: [{ id: 'team-folder-id', displayName: 'Team' }] }), { status: 200 });
  };
  const client = new GraphClient(config, http as typeof fetch);
  assert.deepEqual(await client.getMailFolders('mercy@example.com'), [{ id: 'team-folder-id', displayName: 'Team' }]);
  assert.match(calls[1], /users\/mercy%40example\.com\/mailFolders/);
  assert.doesNotMatch(calls[1], /body|attachments/i);
});

test('reconciles recent Inbox messages without requesting bodies or attachments', async () => {
  const calls: string[] = [];
  const http = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(calls.length === 1
      ? { access_token: 'mock-token', expires_in: 3600 }
      : { value: [{ id: 'recent-id', subject: 'Direct message' }] }), { status: 200 });
  };
  const client = new GraphClient(config, http as typeof fetch);
  const messages = await client.getRecentFolderMessages('mercy@example.com', 'inbox', new Date('2026-09-15T12:00:00Z'));
  assert.equal(messages[0].id, 'recent-id');
  assert.match(calls[1], /mailFolders\/inbox\/messages\?/);
  assert.equal(new URL(calls[1]).searchParams.get('$filter'), 'receivedDateTime ge 2026-09-15T12:00:00.000Z');
  assert.doesNotMatch(calls[1], /attachments/i);
  assert.doesNotMatch(calls[1], /body,/i);
});

test('recent recovery follows canonical Graph links but rejects other resources', async () => {
  const canonical = "https://graph.microsoft.com/v1.0/users('mercy@example.com')/mailfolders('inbox')/messages?$skiptoken=opaque";
  for (const next of [canonical, canonical.replace('mercy@example.com', 'joyce@example.com'),
    canonical.replace("('inbox')", "('sentitems')"), canonical.replace('graph.microsoft.com', 'example.net')]) {
    let requests = 0;
    const client = new GraphClient(config, (async (input) => {
      if (String(input).includes('/token')) return new Response(JSON.stringify({ access_token: 'mock', expires_in: 3600 }));
      requests++;
      return new Response(JSON.stringify(requests === 1 ? { value: [{ id: 'first' }], '@odata.nextLink': next } : { value: [{ id: 'second' }] }));
    }) as typeof fetch);
    const result = client.getRecentFolderMessages('mercy@example.com', 'inbox', new Date('2026-09-16T00:00:00Z'));
    if (next === canonical) assert.equal((await result).length, 2);
    else { await assert.rejects(result, /Invalid Graph recent-message continuation/); assert.equal(requests, 1); }
  }
});

test('Sent Items recovery queries original sent timestamps', async () => {
  let requested = '';
  const client = new GraphClient(config, (async (input) => {
    if (String(input).includes('/token')) return new Response(JSON.stringify({ access_token: 'mock', expires_in: 3600 }));
    requested = String(input);
    return new Response(JSON.stringify({ value: [] }));
  }) as typeof fetch);
  await client.getRecentFolderMessages('mercy@example.com', 'sentitems', new Date('2026-09-16T00:00:00Z'));
  assert.equal(new URL(requested).searchParams.get('$filter'), 'sentDateTime ge 2026-09-16T00:00:00.000Z');
  assert.equal(new URL(requested).searchParams.get('$orderby'), 'sentDateTime asc');
});
