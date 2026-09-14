import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const cookieName = 'solvit_admin_session';
const ttlMs = 8 * 60 * 60 * 1000;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function mac(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function cookieValue(request: Request): string | undefined {
  const raw = request.headers.cookie || '';
  return raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

export function isAdminRequest(request: Request): boolean {
  const value = cookieValue(request);
  if (!value) return false;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !/^\d+$/.test(payload)) return false;
  const expected = Buffer.from(mac(payload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) &&
    Number(payload) > Date.now() && Number(payload) <= Date.now() + ttlMs;
}

function cookieFlags(request: Request): string {
  const secure = process.env.NODE_ENV === 'production' || request.secure;
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function setAdminSession(request: Request, response: Response): void {
  const expiry = String(Date.now() + ttlMs);
  response.setHeader('Set-Cookie', `${cookieName}=${expiry}.${mac(expiry)}; Max-Age=${ttlMs / 1000}; ${cookieFlags(request)}`);
}

export function clearAdminSession(request: Request, response: Response): void {
  response.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; ${cookieFlags(request)}`);
}

export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (!isAdminRequest(request)) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function credentialsMatch(username: unknown, password: unknown): boolean {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const expectedUser = process.env.ADMIN_USERNAME?.trim().toLowerCase() || '';
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  if (!expectedUser || !expectedPassword) return false;
  const actual = crypto.createHash('sha256').update(`${username.trim().toLowerCase()}\0${password}`).digest();
  const expected = crypto.createHash('sha256').update(`${expectedUser}\0${expectedPassword}`).digest();
  return crypto.timingSafeEqual(actual, expected);
}
