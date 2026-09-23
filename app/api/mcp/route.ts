// The Claude custom connector endpoint.
//
//   https://<app>/api/mcp
//
// Two ways in:
//   1. OAuth 2.1 (what claude.ai uses). An unauthenticated request gets a 401 carrying
//      WWW-Authenticate with resource_metadata=… — that header is the pointer Claude follows
//      to discover the authorization server. Without it, nothing kicks off.
//   2. Authorization: Bearer <MCP_SECRET>, for clients that support custom headers
//      (Claude Code, Claude Desktop, curl). Saves running the whole dance by hand.
import { createMcpHandler } from 'mcp-handler';
import { bearerClaims, isConfigured, issuer, safeEqual } from '@/lib/oauth';
import { registerTools } from '@/lib/mcp-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: 'sunthru-checkin', version: '1.0.0' },
  instructions:
    'SunThru company operations. You can read daily check-in transcripts and briefings, and manage the CEO\'s ' +
    'priorities and task board. Tasks are private to the CEO by default: creating or assigning one does NOT show it ' +
    'to the assignee — only set_task_visibility does. Apply changes directly when the CEO explicitly asks for them; ' +
    'when you are proposing something off your own analysis, use suggest_changes so he can approve it.',
});

/** A raw `Authorization: Bearer <MCP_SECRET>`, as a shortcut for header-capable clients. */
function hasStaticToken(req: Request): boolean {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') ?? '').trim());
  return !!m && safeEqual(m[1], process.env.MCP_SECRET ?? '');
}

function challenge(req: Request, description: string) {
  const base = issuer(req);
  return new Response(JSON.stringify({ error: 'unauthorized', error_description: description }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate':
        `Bearer realm="sunthru", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function guarded(req: Request) {
  if (!isConfigured()) {
    // Say so out loud rather than failing closed and silently: a missing env var and a bad
    // token would otherwise look identical from the outside.
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'MCP_SECRET is not set on this deployment. Add it in Vercel and redeploy.',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (!hasStaticToken(req) && !bearerClaims(req)) {
    return challenge(req, 'Authenticate with OAuth, or send Authorization: Bearer <MCP_SECRET>.');
  }
  return handler(req);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
  } });
}

export { guarded as GET, guarded as POST, guarded as DELETE };
