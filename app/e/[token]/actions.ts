'use server';
import { revalidatePath } from 'next/cache';
import { getEmployeeByToken, setCallback, setEmployeeSchedule } from '@/lib/db';
import { viewerFor } from '@/lib/access';
import { addNote, addSuggestion, getTaskVisible } from '@/lib/tasks';
import { ORG_TZ } from '@/lib/env';

async function requireEmployee(token: string) {
  const emp = await getEmployeeByToken(token);
  if (!emp) throw new Error('Unauthorized');
  return emp;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Interpret a datetime-local value (no zone) as org-local time. */
function orgLocalToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
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
  return { ok: true, message: 'Callback scheduled. Calls go out every 15 minutes, so expect it shortly after that time.' };
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

/** Employees may add notes to tasks they can see. They cannot edit the task itself. */
export async function addNoteAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const emp = await requireEmployee(token);
  const taskId = Number(formData.get('taskId'));
  const body = String(formData.get('body') ?? '').trim();
  if (!Number.isFinite(taskId) || !body || body.length > 2000) return;
  await addNote(viewerFor(emp), taskId, emp.id, body);
  revalidatePath(`/e/${token}`);
}

/**
 * "I think this is done" / "I'm blocked" — these never change the task.
 * They queue a suggestion for the CEO, and record the reason as a note.
 */
export async function flagTaskAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const emp = await requireEmployee(token);
  const taskId = Number(formData.get('taskId'));
  const kind = String(formData.get('flag'));
  if (!Number.isFinite(taskId) || !['done', 'blocked'].includes(kind)) return;

  const viewer = viewerFor(emp);
  const task = await getTaskVisible(viewer, taskId);
  if (!task) return; // not visible to them: silently ignore

  const note = String(formData.get('body') ?? '').trim();
  if (note) await addNote(viewer, taskId, emp.id, note);

  await addSuggestion(
    kind === 'done' ? 'complete_task' : 'update_task',
    kind === 'done' ? { task_id: taskId } : { task_id: taskId, status: 'blocked' },
    `${emp.name} says this is ${kind === 'done' ? 'done' : 'blocked'}${note ? `: ${note}` : ''}`,
    'employee', null,
  );
  revalidatePath(`/e/${token}`);
}
