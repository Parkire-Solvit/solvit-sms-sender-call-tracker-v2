import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { emailLoginUrl, emailUser, finishEmailLogin, verifyIdToken } from './emailUserSession';

const tenant = '6f5568c4-377f-4e52-9347-c4208a79e2a9';
const client = 'ed059a0c-44ae-4a09-bd50-4c4ac657e589';

test('Microsoft employee ID token requires trusted signature, tenant, audience and nonce', async () => {
  process.env.MICROSOFT_TENANT_ID = tenant;
  process.env.MICROSOFT_CLIENT_ID = client;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const http = (async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] }), { status: 200 })) as typeof fetch;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const makeToken = (overrides: Record<string, unknown> = {}) => {
    const claims = Buffer.from(JSON.stringify({ aud: client, tid: tenant,
      iss: `https://login.microsoftonline.com/${tenant}/v2.0`, nonce: 'expected',
      preferred_username: 'modondi@solvit.co.ke', exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides })).toString('base64url');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
    return `${header}.${claims}.${signature}`;
  };
  assert.equal((await verifyIdToken(makeToken(), 'expected', http)).preferred_username, 'modondi@solvit.co.ke');
  await assert.rejects(verifyIdToken(makeToken({ nonce: 'wrong' }), 'expected', http), /claims/);
  await assert.rejects(verifyIdToken(makeToken({ aud: 'another-app' }), 'expected', http), /claims/);
  await assert.rejects(verifyIdToken(makeToken({ tid: 'another-tenant' }), 'expected', http), /claims/);
  const tampered = makeToken().split('.');
  tampered[2] = Buffer.from('invalid').toString('base64url');
  await assert.rejects(verifyIdToken(tampered.join('.'), 'expected', http), /signature/);
});

test('employee sign-in is scoped to approved CS mailboxes and issues a signed session', async () => {
  Object.assign(process.env, {
    EMAIL_SLA_ENABLED: 'true', MICROSOFT_EMPLOYEE_LOGIN_ENABLED: 'true',
    SESSION_SECRET: 'a-stable-test-session-secret-with-at-least-32-characters',
    MICROSOFT_TENANT_ID: tenant, MICROSOFT_CLIENT_ID: client,
    MICROSOFT_CLIENT_SECRET: 'test-only',
    MICROSOFT_REDIRECT_URI: 'https://example.com/api/email-auth/callback',
  });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const cookies: string[] = [];
  const fakeResponse = { append: (_name: string, value: string) => { cookies.push(value); } } as any;
  const url = new URL(emailLoginUrl(fakeResponse));
  const flow = cookies[0].split(';')[0];
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ aud: client, tid: tenant,
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`, nonce: url.searchParams.get('nonce'),
    preferred_username: 'modondi@solvit.co.ke', exp: Math.floor(Date.now() / 1000) + 300,
  })).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
  const http = (async (input: string | URL | Request) => new Response(JSON.stringify(String(input).endsWith('/token')
    ? { id_token: `${header}.${claims}.${signature}` }
    : { keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] }), { status: 200 })) as typeof fetch;
  const request = { headers: { cookie: flow }, query: { state: url.searchParams.get('state'), code: 'mock-code' } } as any;
  assert.equal(await finishEmailLogin(request, fakeResponse, ['modondi@solvit.co.ke'], http), 'modondi@solvit.co.ke');
  const session = cookies.find((item) => item.startsWith('solvit_email_user='))!.split(';')[0];
  assert.equal(emailUser({ headers: { cookie: session } } as any, ['modondi@solvit.co.ke']), 'modondi@solvit.co.ke');
  assert.equal(emailUser({ headers: { cookie: session } } as any, ['jmining@solvit.co.ke']), null);
  await assert.rejects(finishEmailLogin(request, fakeResponse, ['jmining@solvit.co.ke'], http), /approved CS team/);
});
