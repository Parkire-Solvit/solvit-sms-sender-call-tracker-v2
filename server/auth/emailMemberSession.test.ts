import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { clearEmailMemberSession, consumeEmailLoginFlow, emailMember, setEmailLoginFlow, setEmailMemberSession } from './emailMemberSession';

function pair(cookieHeader = '') {
  const headers = new Map<string, string | string[]>();
  const request = { headers: { cookie: cookieHeader }, secure: false } as Request;
  const response = {
    setHeader(name: string, value: string | string[]) { headers.set(name, value); },
    getHeader(name: string) { return headers.get(name); },
  } as Response;
  return { request, response, headers };
}

test('CS member session is signed, scoped and can be cleared', () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-secret-is-long-enough-for-hmac-123456789';
  try {
    const first = pair();
    setEmailMemberSession(first.request, first.response, 'Iodago@solvit.co.ke');
    const issued = first.headers.get('Set-Cookie') as string[];
    assert.match(issued[0], /HttpOnly; SameSite=Strict/);
    const cookie = issued[0].split(';', 1)[0];
    const second = pair(cookie);
    assert.equal(emailMember(second.request), 'iodago@solvit.co.ke');
    const tampered = pair(cookie.replace('solvit_email_member=', 'solvit_email_member=x'));
    assert.equal(emailMember(tampered.request), null);
    clearEmailMemberSession(second.request, second.response);
    assert.match((second.headers.get('Set-Cookie') as string[])[0], /Max-Age=0/);
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; }
});

test('Microsoft login flow requires matching state', () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-secret-is-long-enough-for-hmac-123456789';
  try {
    const first = pair();
    setEmailLoginFlow(first.request, first.response, 'random-state', 'random-nonce', 'random-verifier');
    const cookie = (first.headers.get('Set-Cookie') as string).split(';', 1)[0];
    assert.equal(consumeEmailLoginFlow(pair(cookie).request, pair(cookie).response, 'wrong'), null);
    const second = pair(cookie);
    assert.deepEqual(consumeEmailLoginFlow(second.request, second.response, 'random-state'),
      { nonce: 'random-nonce', verifier: 'random-verifier' });
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; }
});
