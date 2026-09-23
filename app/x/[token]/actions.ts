'use server';
import { revalidatePath } from 'next/cache';
import { isAdminToken } from '@/lib/auth';
import { addCeoSchedule, removeCeoSchedule, setBriefingCallEnabled, setEmployeeSchedule } from '@/lib/db';
import {
  addNote, addProgressNote, createPriorityRanked, createTask, delegateTask, deleteTaskRow, listBatch,
  nudgePriority, nudgeTask, setSuggestionStatus, setTaskVisibility, updatePriorityRow, updateTask,
  type PriorityStatus, type TaskStatus, type Visibility,
} from '@/lib/tasks';
import { applySuggestion } from '@/lib/suggestions';

function requireAdmin(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  if (!isAdminToken(token)) throw new Error('Unauthorized');
  return token;
}
const CEO = { kind: 'ceo' } as const;
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? '').trim(); return v || null; };
const num = (fd: FormData, k: string) => { const v = Number(fd.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };
const refresh = (token: string) => revalidatePath(`/x/${token}`, 'layout');

// ------------------------------------------------------------- priorities
export async function createPriorityAction(formData: FormData) {
  const token = requireAdmin(formData);
  const title = str(formData, 'title'); if (!title) return;
  await createPriorityRanked(title, str(formData, 'description'), str(formData, 'deadline'), num(formData, 'rank') ?? undefined);
  refresh(token);
}

export async function updatePriorityAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); const title = str(formData, 'title');
  if (!id || !title) return;
  const status = String(formData.get('status') ?? '') as PriorityStatus;
  await updatePriorityRow(id, {
    title, description: str(formData, 'description'), deadline: str(formData, 'deadline'),
    status: ['active', 'done', 'archived'].includes(status) ? status : undefined,
  });
  refresh(token);
}

export async function setPriorityStatusAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); const status = String(formData.get('status')) as PriorityStatus;
  if (!id || !['active', 'done', 'archived'].includes(status)) return;
  await updatePriorityRow(id, { status });
  refresh(token);
}

export async function movePriorityAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); const dir = String(formData.get('dir'));
  if (!id || !['up', 'down'].includes(dir)) return;
  await nudgePriority(id, dir === 'up' ? -1 : 1);
  refresh(token);
}

// ------------------------------------------------------------------ tasks
export async function createTaskAction(formData: FormData) {
  const token = requireAdmin(formData);
  const title = str(formData, 'title'); if (!title) return;
  const vis = String(formData.get('visibility') ?? 'ceo_only') as Visibility;
  await createTask({
    title, description: str(formData, 'description'),
    assignedTo: num(formData, 'assignedTo'), priorityId: num(formData, 'priorityId'),
    dueDate: str(formData, 'dueDate'),
    visibility: ['ceo_only', 'leadership', 'assignee'].includes(vis) ? vis : 'ceo_only',
  });
  refresh(token);
}

export async function updateTaskAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); const title = str(formData, 'title');
  if (!id || !title) return;
  const status = String(formData.get('status') ?? '') as TaskStatus;
  await updateTask(id, {
    title, description: str(formData, 'description'), dueDate: str(formData, 'dueDate'),
    priorityId: num(formData, 'priorityId'),
    status: ['not_started', 'in_progress', 'blocked', 'done'].includes(status) ? status : undefined,
  });
  const assignee = formData.get('assignedTo');
  if (assignee !== null) await delegateTask(id, num(formData, 'assignedTo'));
  refresh(token);
}

export async function setTaskStatusAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); const status = String(formData.get('status')) as TaskStatus;
  if (!id || !['not_started', 'in_progress', 'blocked', 'done'].includes(status)) return;
  await updateTask(id, { status });
  refresh(token);
}

export async function setVisibilityAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); const v = String(formData.get('visibility')) as Visibility;
  if (!id || !['ceo_only', 'leadership', 'assignee'].includes(v)) return;
  await setTaskVisibility(id, v);
  refresh(token);
}

export async function moveTaskAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); const dir = String(formData.get('dir'));
  if (!id || !['up', 'down'].includes(dir)) return;
  await nudgeTask(id, dir === 'up' ? -1 : 1);
  refresh(token);
}

export async function delegateTaskAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); if (!id) return;
  await delegateTask(id, num(formData, 'assignedTo'));
  refresh(token);
}

export async function deleteTaskAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); if (!id) return;
  await deleteTaskRow(id);
  refresh(token);
}

export async function addCeoNoteAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); const body = str(formData, 'body');
  if (!id || !body) return;
  await addNote(CEO, id, null, body);
  refresh(token);
}

// ------------------------------------------------------------ suggestions
export async function resolveSuggestionAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); const decision = String(formData.get('decision'));
  if (!id) return;
  if (decision === 'approve') await applySuggestion(id);
  else if (decision === 'reject') await setSuggestionStatus(id, 'rejected');
  refresh(token);
}

export async function resolveBatchAction(formData: FormData) {
  const token = requireAdmin(formData);
  const batch = str(formData, 'batch'); const decision = String(formData.get('decision'));
  if (!batch) return;
  for (const s of await listBatch(batch)) {
    if (decision === 'approve') await applySuggestion(s.id);
    else await setSuggestionStatus(s.id, 'rejected');
  }
  refresh(token);
}

// --------------------------------------------------------- progress notes
export async function saveProgressNoteAction(formData: FormData) {
  const token = requireAdmin(formData);
  const employeeId = num(formData, 'employeeId'); const body = str(formData, 'body');
  if (!employeeId || !body) return;
  await addProgressNote(employeeId, body, formData.get('publish') === 'on');
  refresh(token);
}

// ------------------------------------------------------------- schedules
function parseSchedule(formData: FormData) {
  const days = [...new Set(formData.getAll('days').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const time = String(formData.get('time') ?? '');
  return /^\d{2}:\d{2}$/.test(time) ? { days, time } : null;
}

export async function addCeoScheduleAction(formData: FormData) {
  const token = requireAdmin(formData);
  const parsed = parseSchedule(formData); if (!parsed || !parsed.days.length) return;
  await addCeoSchedule(parsed.time, parsed.days);
  refresh(token);
}

export async function removeCeoScheduleAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); if (!id) return;
  await removeCeoSchedule(id);
  refresh(token);
}

export async function setEmployeeScheduleAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'employeeId'); const parsed = parseSchedule(formData);
  if (!id || !parsed) return;
  await setEmployeeSchedule(id, parsed.days, parsed.time);
  refresh(token);
}

export async function setBriefingCallAction(formData: FormData) {
  const token = requireAdmin(formData);
  await setBriefingCallEnabled(String(formData.get('enabled')) === 'on');
  refresh(token);
}
