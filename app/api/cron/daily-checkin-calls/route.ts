// 8am ET on weekdays: create a calls row for each active employee and dial them.
import { createCall, hasCallToday, listCallableEmployees, markCallFailed, setCallSid } from '@/lib/db';
import { isCronAuthorized } from '@/lib/auth';
import { isWeekday, orgDate } from '@/lib/time';
import { placeCheckinCall } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!isWeekday() && new URL(req.url).searchParams.get('force') !== '1') {
    return Response.json({ skipped: 'weekend' });
  }

  const today = orgDate();
  const employees = await listCallableEmployees();
  const results: Record<string, string> = {};

  for (const e of employees) {
    if (await hasCallToday(e.id, today)) { results[e.name] = 'already called today'; continue; }
    const call = await createCall(e.id, new Date());
    try {
      const sid = await placeCheckinCall(call.id, e.phone_number);
      await setCallSid(call.id, sid);
      results[e.name] = `dialed (${sid})`;
    } catch (err) {
      await markCallFailed(call.id);
      results[e.name] = `failed: ${(err as Error).message}`;
    }
  }
  return Response.json({ date: today, results });
}
