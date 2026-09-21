// Hourly: any employee-chosen callback whose time has passed gets a retry call.
import { clearCallback, createCall, listActiveEmployees, listDueCallbacks, markCallFailed, setCallSid } from '@/lib/db';
import { isCronAuthorized } from '@/lib/auth';
import { placeCheckinCall } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  const due = await listDueCallbacks();
  const employees = new Map((await listActiveEmployees()).map((e) => [e.id, e]));
  const results: string[] = [];

  for (const original of due) {
    const emp = employees.get(original.employee_id);
    if (!emp) { await clearCallback(original.id); continue; }
    const retry = await createCall(emp.id, original.scheduled_callback_at ?? new Date(), original.id);
    try {
      const sid = await placeCheckinCall(retry.id, emp.phone_number);
      await setCallSid(retry.id, sid);
      results.push(`${emp.name}: retry dialed (${sid})`);
    } catch (err) {
      await markCallFailed(retry.id);
      results.push(`${emp.name}: retry failed: ${(err as Error).message}`);
    }
  }
  return Response.json({ processed: results });
}
