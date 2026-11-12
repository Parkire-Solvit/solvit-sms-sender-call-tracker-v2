import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { normalizeRole, type Section, type UserRole } from './access';

export type { Section, UserRole } from './access';

/** The verified identity and access of the account behind a request. Built from the database on every request. */
export interface AuthContext {
  userId: number;
  username: string;
  displayName: string;
  role: UserRole;
  /** The linked agent record, when there is one. */
  agentId: number | null;
  agentName: string | null;
  sections: Section[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** undefined: not resolved yet. null: no valid account. Otherwise the verified account. */
      auth?: AuthContext | null;
    }
  }
}

const cookieName = 'solvit_admin_session';
const ttlMs = 8 * 60 * 60 * 1000;
/**
 * The session is renewed while it is being used: once a cookie is older than this, the next request gets a fresh
 * 8 hours. An agent working a full day is therefore never signed out mid-shift, while a browser left unused still
 * expires 8 hours after its last request. Access itself is re-checked in the database on every request.
 */
export const SESSION_RENEW_AFTER_MS = 10 * 60 * 1000;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function mac(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function cookieValue(request: Request): string | undefined {
  const raw = request.headers.cookie || '';
  return raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

/**
 * Read and verify the signed session cookie. The cookie only says WHO the account is (`<expiryMs>.<userId>.<hmac>`).
 * What that account may do is never stored in the cookie: it is looked up in the database on every request, so a
 * demoted, deactivated or re-tagged account is affected at once. Cookies from the earlier format fail the check and
 * simply require a fresh login.
 */
export function readSession(request: Request): { userId: number; expiresAt: number } | null {
  const value = cookieValue(request);
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [expiryPart, userPart, signature] = parts;
  if (!/^\d+$/.test(expiryPart) || !/^\d+$/.test(userPart)) return null;
  const expected = Buffer.from(mac(`${expiryPart}.${userPart}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  const expiry = Number(expiryPart);
  if (!(expiry > Date.now() && expiry <= Date.now() + ttlMs)) return null;
  const userId = Number(userPart);
  return userId > 0 ? { userId, expiresAt: expiry } : null;
}

function cookieFlags(request: Request): string {
  const secure = process.env.NODE_ENV === 'production' || request.secure;
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function setUserSession(request: Request, response: Response, userId: number): void {
  const payload = `${Date.now() + ttlMs}.${userId}`;
  response.setHeader('Set-Cookie', `${cookieName}=${payload}.${mac(payload)}; Max-Age=${ttlMs / 1000}; ${cookieFlags(request)}`);
}

export function clearAdminSession(request: Request, response: Response): void {
  response.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; ${cookieFlags(request)}`);
}

export type AuthLoader = (userId: number) => Promise<AuthContext | null>;

/**
 * Resolves `request.auth` from the database for every API request that carries a session cookie. Mount it before
 * any route that checks access. If the database cannot be read the request is refused rather than guessed.
 */
export function attachAuth(load: AuthLoader) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const session = readSession(request);
    if (!session) {
      request.auth = null;
      next();
      return;
    }
    try {
      request.auth = await load(session.userId);
      // Sliding renewal: an account that still has access gets a fresh 8 hours once its cookie is 10 minutes old.
      // A later Set-Cookie from the route itself (sign-in, sign-out) replaces this one, as it should.
      if (request.auth && session.expiresAt - Date.now() < ttlMs - SESSION_RENEW_AFTER_MS) {
        setUserSession(request, response, session.userId);
      }
      next();
    } catch (error) {
      console.error('[AUTH] Could not verify the session:', (error as Error).message);
      response.status(503).json({ error: 'Session verification unavailable' });
    }
  };
}

export function authContext(request: Request): AuthContext | null {
  return request.auth ?? null;
}

export function sessionRole(request: Request): UserRole | null {
  return authContext(request)?.role ?? null;
}

export function isAdminRequest(request: Request): boolean {
  return authContext(request)?.role === 'admin';
}

/** Whether an account may open a section. Administrators may open all of them. */
export function canAccess(context: AuthContext | null, section: Section): boolean {
  if (!context) return false;
  return context.role === 'admin' || context.sections.includes(section);
}

function deny(request: Request, response: Response, message: string): void {
  if (!authContext(request)) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }
  response.status(403).json({ error: message });
}

// Any signed-in account that has access to at least one section.
export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!authContext(request)) return deny(request, response, 'Access denied');
  next();
}

// Administrators only.
export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (!isAdminRequest(request)) return deny(request, response, 'Admin access required');
  next();
}

// Administrators, and agents whose tag gives them this section.
export function requireSection(section: Section) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!canAccess(authContext(request), section)) return deny(request, response, 'You do not have access to this section');
    next();
  };
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
