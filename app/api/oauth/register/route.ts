// Dynamic Client Registration (RFC 7591). Claude calls this the moment you add the connector.
// There is no client store: the client_id IS a signed blob carrying its own redirect_uris.
import { isAllowedRedirect, isConfigured, newClientId, sign } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const bad = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: cors });

export async function POST(req: Request) {
  // Every failure here must come back as readable JSON. An unhandled throw becomes an opaque
  // FUNCTION_INVOCATION_FAILED in Vercel, which tells you nothing.
  try {
    if (!isConfigured()) return bad('server_error', 'MCP_SECRET is not set on the server. Add it in Vercel and redeploy.', 500);

    const body = await req.json().catch(() => ({})) as { redirect_uris?: unknown; client_name?: unknown };
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    if (!uris.length) return bad('invalid_redirect_uri', 'redirect_uris is required.');

    const rejected = uris.filter((u) => !isAllowedRedirect(u));
    if (rejected.length) return bad('invalid_redirect_uri', `Redirect URI not allowed: ${rejected.join(', ')}`);

    const client_id = newClientId();
    // The registration token IS the client_id we hand back, binding the allowed redirect URIs.
    const signed = sign('client', { cid: client_id, uris, name: typeof body.client_name === 'string' ? body.client_name : null }, 60 * 60 * 24 * 365);

    return Response.json({
      client_id: signed,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp',
    }, { status: 201, headers: cors });
  } catch (err) {
    return bad('server_error', (err as Error).message, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
  } });
}
