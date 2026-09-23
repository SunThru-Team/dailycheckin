/**
 * A minimal OAuth 2.1 authorization server, just enough for Claude's custom-connector flow.
 *
 * Claude always attempts Dynamic Client Registration when you add a connector; a server with no
 * OAuth endpoints fails before it is ever reached. So we implement the four things Claude needs:
 * discovery metadata, a registration endpoint, an authorize page, and a token endpoint.
 *
 * There is exactly one user (John), so "logging in" is typing MCP_SECRET on a page we control.
 *
 * Nothing is stored. Vercel functions share no memory, so every credential is an HMAC-signed blob
 * carrying its own contents and expiry; verifying is a signature check with nothing to look up.
 *   - the credential's type is signed into the MAC, so an auth code cannot be replayed as a token
 *   - `exp` lives inside the signed payload, so it cannot be edited
 *   - MACs are compared in constant time, after a length check (timingSafeEqual throws otherwise)
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from './db';

export type BlobType = 'client' | 'code' | 'access' | 'refresh';

const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

/** Fails closed: without MCP_SECRET nothing can be signed or verified. */
function signingKey(): Buffer {
  const secret = process.env.MCP_SECRET;
  if (!secret || secret.length < 16) throw new Error('MCP_SECRET is not set (or is too short)');
  return createHash('sha256').update(`${secret}:oauth-signing-key:v1`).digest();
}

export function isConfigured(): boolean {
  const s = process.env.MCP_SECRET;
  return typeof s === 'string' && s.length >= 16;
}

function mac(type: BlobType, body: string): string {
  return b64u(createHmac('sha256', signingKey()).update(`${type}.${body}`).digest());
}

/** Constant-time string compare that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function sign(type: BlobType, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  return `${body}.${mac(type, body)}`;
}

export function verify<T = Record<string, unknown>>(type: BlobType, token: string | undefined | null): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!safeEqual(sig, mac(type, body))) return null;
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(unb64u(body).toString()); } catch { return null; }
  const exp = payload.exp;
  if (typeof exp !== 'number' || exp * 1000 < Date.now()) return null;
  return payload as T;
}

// ------------------------------------------------------------- redirect URIs
/**
 * An unchecked redirect_uri is an open redirect that hands auth codes to anyone who registers.
 * Hosts are matched exactly, or as a true subdomain — `includes('claude.ai')` would happily
 * accept `claude.ai.evil.com`.
 */
const ALLOWED_HOSTS = ['claude.ai', 'claude.com', 'anthropic.com'];

export function isAllowedRedirect(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  const host = u.hostname.toLowerCase();

  // Local clients (Claude Desktop, Claude Code, MCP Inspector) use loopback over http.
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return u.protocol === 'http:' || u.protocol === 'https:';
  }
  if (u.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// --------------------------------------------------------------------- PKCE
export function verifyPkce(verifier: string, challenge: string, method = 'S256'): boolean {
  if (method !== 'S256') return false;               // plain is not accepted
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const computed = b64u(createHash('sha256').update(verifier).digest());
  return safeEqual(computed, challenge);
}

// ------------------------------------------------------------------- issuer
/** Absolute base URL for this deployment, used to build every advertised endpoint. */
export function issuer(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? u.host;
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export const newClientId = () => `c_${randomBytes(8).toString('hex')}`;
export const newJti = () => randomBytes(16).toString('hex');

/**
 * Authorization codes must be single-use. Signed blobs alone can't enforce that — a replay looks
 * identical — so each code carries a jti and redeeming it claims that jti in Postgres. The insert
 * either wins or conflicts; there is no read-then-write race.
 * Expired rows are swept opportunistically, so the table stays a handful of rows.
 */
export async function claimCode(jti: string, expSeconds: number): Promise<boolean> {
  const rows = await sql`
    INSERT INTO oauth_used_codes (jti, expires_at)
    VALUES (${jti}, to_timestamp(${expSeconds}))
    ON CONFLICT (jti) DO NOTHING
    RETURNING jti`;
  if (rows.length && Math.random() < 0.1) {
    await sql`DELETE FROM oauth_used_codes WHERE expires_at < now() - interval '1 hour'`;
  }
  return rows.length > 0;
}

// ------------------------------------------------------------ bearer tokens
export type AccessClaims = { sub: string; client_id: string; exp: number };

/** Returns the claims for a valid `Authorization: Bearer …`, or null. */
export function bearerClaims(req: Request): AccessClaims | null {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  return verify<AccessClaims>('access', m[1]);
}

export const ACCESS_TTL = 60 * 60 * 8;        // 8 hours
export const REFRESH_TTL = 60 * 60 * 24 * 60; // 60 days
export const CODE_TTL = 5 * 60;               // 5 minutes
