import crypto from 'node:crypto';
import type { Request, Response } from 'express';

const sessionCookie = 'solvit_email_member';
const flowCookie = 'solvit_email_login';
const ttlMs = 8 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters for Microsoft sign-in');
  return value;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function cookie(request: Request, name: string): string | undefined {
  return (request.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function secureFlag(request: Request): string {
  return process.env.NODE_ENV === 'production' || request.secure ? '; Secure' : '';
}

function encode(payload: object): string {
  const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${value}.${sign(value)}`;
}

function decode<T>(raw: string | undefined): T | null {
  if (!raw || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return null;
  const [value, signature] = raw.split('.');
  if (!value || !signature) return null;
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try { return JSON.parse(Buffer.from(value, 'base64url').toString()) as T; }
  catch { return null; }
}

export function setEmailLoginFlow(request: Request, response: Response, state: string, nonce: string, verifier: string): void {
  response.setHeader('Set-Cookie', `${flowCookie}=${encode({ state, nonce, verifier, expiry: Date.now() + 10 * 60_000 })}; Max-Age=600; Path=/api/email-auth; HttpOnly; SameSite=Lax${secureFlag(request)}`);
}

export function consumeEmailLoginFlow(request: Request, response: Response, state: string): { nonce: string; verifier: string } | null {
  const flow = decode<{ state: string; nonce: string; verifier: string; expiry: number }>(cookie(request, flowCookie));
  response.setHeader('Set-Cookie', `${flowCookie}=; Max-Age=0; Path=/api/email-auth; HttpOnly; SameSite=Lax${secureFlag(request)}`);
  if (!flow || flow.expiry < Date.now() || flow.state !== state || !flow.verifier) return null;
  return { nonce: flow.nonce, verifier: flow.verifier };
}

export function setEmailMemberSession(request: Request, response: Response, email: string): void {
  const previous = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [String(previous)] : []),
    `${sessionCookie}=${encode({ email: email.toLowerCase(), expiry: Date.now() + ttlMs })}; Max-Age=${ttlMs / 1000}; Path=/; HttpOnly; SameSite=Strict${secureFlag(request)}`]);
}

export function emailMember(request: Request): string | null {
  const value = decode<{ email: string; expiry: number }>(cookie(request, sessionCookie));
  if (!value || value.expiry < Date.now() || typeof value.email !== 'string') return null;
  return value.email;
}

export function clearEmailMemberSession(request: Request, response: Response): void {
  const previous = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [String(previous)] : []),
    `${sessionCookie}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secureFlag(request)}`]);
}
