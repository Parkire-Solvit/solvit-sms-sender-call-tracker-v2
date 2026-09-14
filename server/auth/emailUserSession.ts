import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { isAdminRequest } from './adminSession';

const flowCookie = 'solvit_email_flow';
const userCookie = 'solvit_email_user';
const flowTtlMs = 10 * 60_000;
const userTtlMs = 8 * 60 * 60_000;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters for Microsoft sign-in');
  return value;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function seal(data: object): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function unseal<T>(value?: string): T | null {
  if (!value) return null;
  const [payload, mac, extra] = value.split('.');
  if (!payload || !mac || extra) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T; }
  catch { return null; }
}

function cookie(request: Request, name: string): string | undefined {
  return (request.headers.cookie || '').split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function setCookie(response: Response, name: string, value: string, ageSeconds: number, sameSite: 'Lax' | 'Strict'): void {
  const flags = `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${ageSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
  response.append('Set-Cookie', `${name}=${value}; ${flags}`);
}

function tenantBase(): string {
  const tenant = process.env.MICROSOFT_TENANT_ID || '';
  if (!/^[0-9a-f-]{36}$/i.test(tenant)) throw new Error('MICROSOFT_TENANT_ID is invalid');
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

function redirectUri(): string {
  const value = process.env.MICROSOFT_REDIRECT_URI || '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/api/email-auth/callback' || url.search || url.hash) {
    throw new Error('MICROSOFT_REDIRECT_URI must be the HTTPS email callback URL');
  }
  return value;
}

export function emailUserLoginEnabled(): boolean {
  return process.env.EMAIL_SLA_ENABLED === 'true' && process.env.MICROSOFT_EMPLOYEE_LOGIN_ENABLED === 'true';
}

export function assertEmailUserLoginConfiguration(): void {
  if (!emailUserLoginEnabled()) return;
  secret(); tenantBase(); redirectUri();
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    throw new Error('Microsoft employee sign-in requires client ID and client secret');
  }
}

export function emailLoginUrl(response: Response): string {
  if (!emailUserLoginEnabled()) throw new Error('Microsoft employee sign-in is disabled');
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  setCookie(response, flowCookie, seal({ state, nonce, verifier, exp: Date.now() + flowTtlMs }), 600, 'Lax');
  const url = new URL(`${tenantBase()}/authorize`);
  url.search = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || '', response_type: 'code',
    redirect_uri: redirectUri(), response_mode: 'query', scope: 'openid email profile',
    state, nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

type Flow = { state: string; nonce: string; verifier: string; exp: number };
type Claims = { aud: string; iss: string; tid: string; exp: number; nbf?: number; nonce: string; preferred_username?: string; email?: string };

export async function finishEmailLogin(request: Request, response: Response, allowed: readonly string[], http: typeof fetch = fetch): Promise<string> {
  const flow = unseal<Flow>(cookie(request, flowCookie));
  setCookie(response, flowCookie, '', 0, 'Lax');
  if (!flow || flow.exp < Date.now() || request.query.state !== flow.state || typeof request.query.code !== 'string') {
    throw new Error('Microsoft sign-in state was invalid or expired');
  }
  const tokenResponse = await http(`${tenantBase()}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID || '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET || '', grant_type: 'authorization_code',
      code: request.query.code, redirect_uri: redirectUri(), code_verifier: flow.verifier }),
  });
  if (!tokenResponse.ok) throw new Error(`Microsoft sign-in exchange failed (${tokenResponse.status})`);
  const data = await tokenResponse.json() as { id_token?: string };
  if (!data.id_token) throw new Error('Microsoft did not issue an ID token');
  const claims = await verifyIdToken(data.id_token, flow.nonce, http);
  const email = (claims.preferred_username || claims.email || '').trim().toLowerCase();
  if (!allowed.includes(email)) throw new Error('This Microsoft account is not in the approved CS team');
  setCookie(response, userCookie, seal({ email, exp: Date.now() + userTtlMs }), userTtlMs / 1000, 'Strict');
  return email;
}

export async function verifyIdToken(token: string, nonce: string, http: typeof fetch = fetch): Promise<Claims> {
  const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra) throw new Error('Invalid Microsoft ID token');
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as Claims;
  const tenant = process.env.MICROSOFT_TENANT_ID || '';
  if (header.alg !== 'RS256' || !header.kid || claims.aud !== process.env.MICROSOFT_CLIENT_ID ||
    claims.tid !== tenant || claims.iss !== `https://login.microsoftonline.com/${tenant}/v2.0` ||
    claims.nonce !== nonce || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() ||
    (claims.nbf && claims.nbf * 1000 > Date.now() + 60_000)) throw new Error('Microsoft ID token claims failed validation');
  const keysResponse = await http(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`);
  if (!keysResponse.ok) throw new Error('Microsoft signing keys were unavailable');
  const keys = await keysResponse.json() as { keys?: Array<crypto.JsonWebKey & { kid?: string; use?: string }> };
  const jwk = keys.keys?.find((key) => key.kid === header.kid && (!key.use || key.use === 'sig'));
  if (!jwk) throw new Error('Microsoft ID token signing key was not found');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedClaims}`), key,
    Buffer.from(encodedSignature, 'base64url'));
  if (!valid) throw new Error('Microsoft ID token signature failed validation');
  return claims;
}

export function emailUser(request: Request, allowed: readonly string[]): string | null {
  if (!emailUserLoginEnabled()) return null;
  const session = unseal<{ email: string; exp: number }>(cookie(request, userCookie));
  if (!session || !Number.isFinite(session.exp) || session.exp <= Date.now()) return null;
  return allowed.includes(session.email) ? session.email : null;
}

export function clearEmailUser(response: Response): void { setCookie(response, userCookie, '', 0, 'Strict'); }

export function emailActor(request: Request, allowed: readonly string[]): { role: 'admin' | 'employee'; email?: string } | null {
  if (isAdminRequest(request)) return { role: 'admin' };
  const email = emailUser(request, allowed);
  return email ? { role: 'employee', email } : null;
}

export function requireEmailActor(allowed: readonly string[]): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    if (!emailActor(request, allowed)) return void response.status(401).json({ error: 'Authentication required' });
    next();
  };
}
