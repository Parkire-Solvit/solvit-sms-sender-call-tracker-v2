import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { clearAdminSession, isAdminRequest, setAdminSession } from './adminSession';

test('admin session is signed, HttpOnly and rejects tampering', () => {
  const headers = new Map<string, string>();
  const request = { headers: {}, secure: false } as Request;
  const response = { setHeader: (key: string, value: string) => { headers.set(key, value); } } as Response;
  setAdminSession(request, response);
  const cookie = headers.get('Set-Cookie')!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const token = cookie.split(';')[0];
  assert.equal(isAdminRequest({ headers: { cookie: token } } as Request), true);
  assert.equal(isAdminRequest({ headers: { cookie: `${token}x` } } as Request), false);
  clearAdminSession(request, response);
  assert.match(headers.get('Set-Cookie')!, /Max-Age=0/);
});
