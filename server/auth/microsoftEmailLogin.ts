import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { getPostgresPool } from '../../db';
import { consumeEmailLoginFlow, setEmailLoginFlow, setEmailMemberSession } from './emailMemberSession';

function config() {
  const tenant = process.env.MICROSOFT_TENANT_ID || '';
  const client = process.env.MICROSOFT_CLIENT_ID || '';
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';
  const redirect = process.env.MICROSOFT_REDIRECT_URI || '';
  if (!/^[0-9a-f-]{36}$/i.test(tenant) || !/^[0-9a-f-]{36}$/i.test(client) || !clientSecret ||
      !/^https:\/\/[^/]+\/api\/email-auth\/callback$/.test(redirect)) return null;
  return { tenant, client, clientSecret, redirect };
}

export function microsoftEmailLoginAvailable(): boolean {
  return Boolean(config() && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
}

export function beginMicrosoftEmailLogin(request: Request, response: Response): void {
  const value = config();
  if (!value || !microsoftEmailLoginAvailable()) { response.status(503).send('Microsoft sign-in is not configured'); return; }
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  setEmailLoginFlow(request, response, state, nonce, verifier);
  const url = new URL(`https://login.microsoftonline.com/${value.tenant}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({ client_id: value.client, response_type: 'code', redirect_uri: value.redirect,
    response_mode: 'query', scope: 'openid profile email', state, nonce,
    code_challenge_method: 'S256', code_challenge: challenge, prompt: 'select_account' }).toString();
  response.redirect(url.toString());
}

type Claims = { aud?: string; iss?: string; tid?: string; exp?: number; nbf?: number; nonce?: string;
  preferred_username?: string; email?: string; upn?: string };

async function verifiedClaims(token: string, tenant: string, client: string, nonce: string): Promise<Claims> {
  const [rawHeader, rawPayload, rawSignature] = token.split('.');
  if (!rawHeader || !rawPayload || !rawSignature) throw new Error('Invalid Microsoft identity token');
  const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString()) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Invalid Microsoft identity token algorithm');
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`);
  if (!response.ok) throw new Error('Microsoft signing keys unavailable');
  const { keys } = await response.json() as { keys: Array<JsonWebKey & { kid?: string; kty?: string; use?: string }> };
  const key = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA' && candidate.use === 'sig');
  if (!key) throw new Error('Microsoft signing key not found');
  const publicKey = crypto.createPublicKey({ key: key as unknown as crypto.JsonWebKey, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${rawHeader}.${rawPayload}`), publicKey, Buffer.from(rawSignature, 'base64url')))
    throw new Error('Invalid Microsoft identity token signature');
  const claims = JSON.parse(Buffer.from(rawPayload, 'base64url').toString()) as Claims;
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== client || claims.tid?.toLowerCase() !== tenant.toLowerCase() ||
      claims.iss !== `https://login.microsoftonline.com/${tenant}/v2.0` ||
      !claims.exp || claims.exp <= now || (claims.nbf && claims.nbf > now + 60) || claims.nonce !== nonce)
    throw new Error('Microsoft identity token claims did not match this login');
  return claims;
}

export async function completeMicrosoftEmailLogin(request: Request, response: Response): Promise<void> {
  const value = config();
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  const state = typeof request.query.state === 'string' ? request.query.state : '';
  if (!value || !code || !state) { response.redirect('/?emailAuthError=invalid'); return; }
  const flow = consumeEmailLoginFlow(request, response, state);
  if (!flow) { response.redirect('/?emailAuthError=expired'); return; }
  try {
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${value.tenant}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: value.client, client_secret: value.clientSecret, code,
        redirect_uri: value.redirect, grant_type: 'authorization_code', scope: 'openid profile email',
        code_verifier: flow.verifier }),
    });
    if (!tokenResponse.ok) throw new Error('Microsoft token exchange failed');
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error('Microsoft did not return an identity token');
    const claims = await verifiedClaims(tokens.id_token, value.tenant, value.client, flow.nonce);
    const allowed = (process.env.MICROSOFT_MONITORED_MAILBOXES || '').split(',').map((item) => item.trim().toLowerCase());
    const email = [claims.preferred_username, claims.email, claims.upn]
      .map((item) => (item || '').trim().toLowerCase()).find((item) => allowed.includes(item));
    if (!email) throw new Error('Account is not in the approved CS team');
    const member = await getPostgresPool().query<{ email: string }>(
      'SELECT email FROM email_team_members WHERE email=$1 AND is_monitored=true', [email]);
    if (member.rowCount !== 1) throw new Error('Account is not in the approved CS team');
    setEmailMemberSession(request, response, email);
    response.redirect('/?emailAuth=success');
  } catch (error) {
    console.warn('[EMAIL] Microsoft member sign-in failed:', (error as Error).message);
    response.redirect('/?emailAuthError=denied');
  }
}
