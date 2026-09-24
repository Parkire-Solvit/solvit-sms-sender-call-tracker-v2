import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export type UserRole = 'admin' | 'callback_agent';

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

function normalizeRole(value: string | undefined): UserRole {
  return value === 'callback_agent' ? 'callback_agent' : 'admin';
}

/**
 * Read and verify the signed session cookie. Cookie value is
 * `<expiryMs>.<role>.<hmac(expiryMs.role)>`. Returns null if missing, tampered,
 * malformed, or expired. (Old expiry-only cookies fail this check and simply
 * require a fresh login.)
 */
export function readSession(request: Request): { role: UserRole } | null {
  const value = cookieValue(request);
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [expiryPart, rolePart, signature] = parts;
  if (!/^\d+$/.test(expiryPart)) return null;
  const payload = `${expiryPart}.${rolePart}`;
  const expected = Buffer.from(mac(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  const expiry = Number(expiryPart);
  if (!(expiry > Date.now() && expiry <= Date.now() + ttlMs)) return null;
  return { role: normalizeRole(rolePart) };
}

export function sessionRole(request: Request): UserRole | null {
  return readSession(request)?.role ?? null;
}

export function isAdminRequest(request: Request): boolean {
  return readSession(request)?.role === 'admin';
}

function cookieFlags(request: Request): string {
  const secure = process.env.NODE_ENV === 'production' || request.secure;
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function setUserSession(request: Request, response: Response, role: UserRole = 'admin'): void {
  const payload = `${Date.now() + ttlMs}.${normalizeRole(role)}`;
  response.setHeader('Set-Cookie', `${cookieName}=${payload}.${mac(payload)}; Max-Age=${ttlMs / 1000}; ${cookieFlags(request)}`);
}

// Backwards-compatible alias (grants an admin session).
export function setAdminSession(request: Request, response: Response): void {
  setUserSession(request, response, 'admin');
}

export function clearAdminSession(request: Request, response: Response): void {
  response.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; ${cookieFlags(request)}`);
}

// Any authenticated dashboard user (admin or callback_agent).
export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!readSession(request)) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

// Admins only.
export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (!isAdminRequest(request)) {
    response.status(403).json({ error: 'Admin access required' });
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
