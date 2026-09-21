// 6pm ET on weekdays: summarize today's responses with Claude, store it, and call the CEO.
// Manual use: GET /api/cron/ceo-summary-call?date=2026-09-21&nocall=1  (regenerate without dialing)
import { listActiveEmployees, listResponsesForDate, setCeoCallSid, upsertCeoCall } from '@/lib/db';
import { isCronAuthorized } from '@/lib/auth';
import { generateDailySummary } from '@/lib/ai';
import { fmtDate, isWeekday, orgDate } from '@/lib/time';
import { placeCeoCall } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const url = new URL(req.url);
  if (!isWeekday() && url.searchParams.get('force') !== '1') return Response.json({ skipped: 'weekend' });

  const date = url.searchParams.get('date') ?? orgDate();
  const responses = await listResponsesForDate(date);
  const responded = new Set(responses.map((r) => r.employee_id));
  const missed = (await listActiveEmployees()).filter((e) => !responded.has(e.id)).map((e) => e.name);

  const summary = await generateDailySummary(
    fmtDate(date),
    responses.map((r) => ({ employeeName: r.employee_name, transcript: r.transcript })),
    missed,
  );
  const row = await upsertCeoCall(date, summary);

  if (url.searchParams.get('nocall') === '1') return Response.json({ date, summary, called: false });

  try {
    const sid = await placeCeoCall(row.id);
    await setCeoCallSid(row.id, sid, 'queued');
    return Response.json({ date, summary, called: true, sid });
  } catch (err) {
    await setCeoCallSid(row.id, null, 'failed');
    return Response.json({ date, summary, called: false, error: (err as Error).message }, { status: 502 });
  }
}
