// Token endpoint: trades an auth code (or refresh token) for a bearer token.
// Both are signed blobs; the type is bound into the MAC so a code can't be used as a token.
import { ACCESS_TTL, REFRESH_TTL, claimCode, isConfigured, sign, verify, verifyPkce } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const bad = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: cors });

type CodeBlob = { jti: string; cid: string; redirect_uri: string; cc: string; resource?: string; exp: number };
type RefreshBlob = { cid: string };

export async function POST(req: Request) {
  try {
    if (!isConfigured()) return bad('server_error', 'MCP_SECRET is not set on the server.', 500);

    const ct = req.headers.get('content-type') ?? '';
    const body = ct.includes('application/json')
      ? new URLSearchParams(Object.entries((await req.json()) as Record<string, string>))
      : new URLSearchParams(await req.text());

    const grant = body.get('grant_type');

    if (grant === 'refresh_token') {
      const blob = verify<RefreshBlob>('refresh', body.get('refresh_token'));
      if (!blob) return bad('invalid_grant', 'Refresh token is invalid or expired.');
      return issue(blob.cid);
    }

    if (grant !== 'authorization_code') return bad('unsupported_grant_type', `Unsupported grant_type "${grant}".`);

    const blob = verify<CodeBlob>('code', body.get('code'));
    if (!blob) return bad('invalid_grant', 'Authorization code is invalid or expired.');

    const redirect = body.get('redirect_uri');
    if (redirect && redirect !== blob.redirect_uri) return bad('invalid_grant', 'redirect_uri does not match the one used to authorize.');

    const verifier = body.get('code_verifier') ?? '';
    if (!verifyPkce(verifier, blob.cc)) return bad('invalid_grant', 'PKCE verification failed.');

    // Single use: the first redemption claims the jti, any replay loses.
    if (!blob.jti || !(await claimCode(blob.jti, blob.exp))) {
      return bad('invalid_grant', 'This authorization code has already been used.');
    }

    return issue(blob.cid);
  } catch (err) {
    return bad('server_error', (err as Error).message, 500);
  }
}

function issue(cid: string) {
  return Response.json({
    access_token: sign('access', { sub: 'ceo', client_id: cid }, ACCESS_TTL),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: sign('refresh', { cid }, REFRESH_TTL),
    scope: 'mcp',
  }, { headers: cors });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
  } });
}
