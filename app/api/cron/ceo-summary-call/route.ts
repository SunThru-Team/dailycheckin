// Manual trigger for a briefing. Scheduled briefings run from /api/cron/tick.
//   GET /api/cron/ceo-summary-call?nocall=1            generate today's briefing, don't dial
//   GET /api/cron/ceo-summary-call?date=2026-09-21     regenerate a past day
import { isCronAuthorized } from '@/lib/auth';
import { runBriefing } from '@/lib/briefing';
import { orgDate, orgNow } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? orgDate();
  const now = orgNow();
  const slot = url.searchParams.get('slot') ??
    `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`;
  const result = await runBriefing(date, slot, { call: url.searchParams.get('nocall') !== '1' });
  return Response.json({ date, slot, summary: result.row.summary_text, called: result.called, error: 'error' in result ? result.error : undefined },
    { status: 'error' in result ? 502 : 200 });
}
