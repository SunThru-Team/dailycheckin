// The Claude custom connector endpoint.
//
//   https://<app>/api/mcp/<MCP_SECRET>
//
// The secret is a path segment because Claude's custom-connector UI has no place to
// enter a header. It is compared in constant time; anything else gets a flat 404 so
// the endpoint is indistinguishable from a nonexistent path. Rotate by changing the
// MCP_SECRET env var in Vercel, redeploying, and pasting the new URL into Claude.
import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from 'mcp-handler';
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

function authorized(secret: string): boolean {
  const expected = process.env.MCP_SECRET;
  if (!expected || expected.length < 16) return false; // unset or too weak: refuse rather than run open
  const a = Buffer.from(secret), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function guard(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!authorized(secret)) return new Response('Not found', { status: 404 });
  return handler(req);
}

export { guard as GET, guard as POST, guard as DELETE };
