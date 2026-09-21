// The scheduler. Hit this every 10–15 minutes (cron-job.org, or Vercel Pro cron).
// It places whichever employee check-ins and CEO briefings are due right now, plus rescheduled callbacks.
// Idempotent: a call that already happened today is never placed twice.
import { isCronAuthorized } from '@/lib/auth';
import { runBriefing } from '@/lib/briefing';
import {
  ceoCallExists, clearCallback, createCall, hasCallToday, listActiveEmployees, listCeoSchedules,
  listDueCallbacks, markCallFailed, setCallSid,
} from '@/lib/db';
import { orgNow, timeToMinutes } from '@/lib/time';
import { placeCheckinCall } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** How long after its scheduled time something is still worth doing. Past this, skip it. */
const GRACE_MINUTES = 90;

const isDue = (scheduled: string, now: number) => {
  const t = timeToMinutes(scheduled);
  return now >= t && now - t <= GRACE_MINUTES;
};

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const now = orgNow();
  const log: string[] = [];

  // 1. Employee check-ins due now
  const employees = await listActiveEmployees();
  for (const e of employees) {
    if (!e.call_days.includes(now.dow) || !isDue(e.call_time, now.minutes)) continue;
    if (await hasCallToday(e.id, now.date)) continue;
    const call = await createCall(e.id, new Date());
    try {
      const sid = await placeCheckinCall(call.id, e.phone_number);
      await setCallSid(call.id, sid);
      log.push(`${e.name}: dialed (${sid})`);
    } catch (err) {
      await markCallFailed(call.id);
      log.push(`${e.name}: failed: ${(err as Error).message}`);
    }
  }

  // 2. Rescheduled callbacks whose time has come
  const byId = new Map(employees.map((e) => [e.id, e]));
  for (const original of await listDueCallbacks()) {
    const emp = byId.get(original.employee_id);
    if (!emp) { await clearCallback(original.id); continue; }
    const retry = await createCall(emp.id, original.scheduled_callback_at ?? new Date(), original.id);
    try {
      const sid = await placeCheckinCall(retry.id, emp.phone_number);
      await setCallSid(retry.id, sid);
      log.push(`${emp.name}: callback dialed (${sid})`);
    } catch (err) {
      await markCallFailed(retry.id);
      log.push(`${emp.name}: callback failed: ${(err as Error).message}`);
    }
  }

  // 3. CEO briefings due now
  for (const s of await listCeoSchedules()) {
    if (!s.days.includes(now.dow) || !isDue(s.call_time, now.minutes)) continue;
    if (await ceoCallExists(now.date, s.call_time)) continue;
    try {
      const r = await runBriefing(now.date, s.call_time, { call: true });
      log.push(`CEO briefing ${s.call_time}: ${r.called ? `dialed (${r.sid})` : `not called: ${'error' in r ? r.error : ''}`}`);
    } catch (err) {
      // e.g. the summary model is unreachable; the slot stays open so the next tick retries within the grace window.
      log.push(`CEO briefing ${s.call_time}: failed: ${(err as Error).message}`);
    }
  }

  return Response.json({ at: now, actions: log });
}
