'use server';
import { revalidatePath } from 'next/cache';
import { editResponse, getEmployeeByToken, setCallback, setEmployeeSchedule, setTaskStatusForEmployee, type Task } from '@/lib/db';
import { ORG_TZ } from '@/lib/env';

async function requireEmployee(token: string) {
  const emp = await getEmployeeByToken(token);
  if (!emp) throw new Error('Unauthorized');
  return emp;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function saveTranscriptAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get('token') ?? '');
  const emp = await requireEmployee(token);
  const id = Number(formData.get('responseId'));
  const transcript = String(formData.get('transcript') ?? '').trim();
  if (!transcript) return { ok: false, error: 'Your update can’t be empty.' };
  if (transcript.length > 5000) return { ok: false, error: 'Keep it under 5,000 characters.' };

  const row = await editResponse(id, emp.id, transcript);
  if (!row) return { ok: false, error: 'The 20-minute edit window has closed for this update.' };
  revalidatePath(`/e/${token}`);
  return { ok: true, message: 'Saved.' };
}

/** Interpret a datetime-local value (no zone) as org-local time. */
function orgLocalToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Find the UTC instant whose org-tz wall clock equals the requested wall clock.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ORG_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return new Date(guess - (asIfUtc - guess));
}

export async function rescheduleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get('token') ?? '');
  const emp = await requireEmployee(token);
  const callId = Number(formData.get('callId'));
  const when = orgLocalToDate(String(formData.get('when') ?? ''));
  if (!when) return { ok: false, error: 'Pick a date and time.' };
  if (when.getTime() < Date.now() - 60_000) return { ok: false, error: 'That time has already passed.' };
  if (when.getTime() > Date.now() + 3 * 86_400_000) return { ok: false, error: 'Pick a time within the next three days.' };

  await setCallback(callId, emp.id, when);
  revalidatePath(`/e/${token}`);
  return { ok: true, message: 'Callback scheduled. Calls go out on the hour, so expect it shortly after that time.' };
}

export async function setMyTaskStatusAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const emp = await requireEmployee(token);
  const id = Number(formData.get('taskId'));
  const status = String(formData.get('status')) as Task['status'];
  if (!['open', 'in_progress', 'done'].includes(status)) return;
  await setTaskStatusForEmployee(id, emp.id, status);
  revalidatePath(`/e/${token}`);
}

function parseSchedule(formData: FormData, dayField = 'days', timeField = 'time') {
  const days = formData.getAll(dayField).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const time = String(formData.get(timeField) ?? '');
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  return { days: [...new Set(days)].sort(), time };
}

export async function saveScheduleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get('token') ?? '');
  const emp = await requireEmployee(token);
  const parsed = parseSchedule(formData);
  if (!parsed) return { ok: false, error: 'Pick a time.' };
  await setEmployeeSchedule(emp.id, parsed.days, parsed.time);
  revalidatePath(`/e/${token}`);
  return { ok: true, message: parsed.days.length ? 'Schedule saved.' : 'Saved. You won’t be called until you pick at least one day.' };
}
