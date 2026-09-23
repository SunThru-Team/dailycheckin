// RFC 9728 protected-resource metadata. Optional catch-all because clients probe both
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp.
import { issuer } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const base = issuer(req);
  return Response.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
    resource_documentation: `${base}/`,
  }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  } });
}
