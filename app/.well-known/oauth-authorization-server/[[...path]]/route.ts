// RFC 8414 authorization-server metadata.
import { issuer } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const base = issuer(req);
  return Response.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
    service_documentation: `${base}/`,
  }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  } });
}
