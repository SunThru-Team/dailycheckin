'use server';
import { revalidatePath } from 'next/cache';
import { isAdminToken } from '@/lib/auth';
import {
  addCeoSchedule, archivePriority, createPriority, createTask, deleteTask, removeCeoSchedule,
  setEmployeeSchedule, setTaskStatus, updatePriority, type Task,
} from '@/lib/db';

function requireAdmin(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  if (!isAdminToken(token)) throw new Error('Unauthorized');
  return token;
}
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? '').trim(); return v || null; };
const num = (fd: FormData, k: string) => { const v = Number(fd.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };

export async function createPriorityAction(formData: FormData) {
  const token = requireAdmin(formData);
  const title = str(formData, 'title');
  if (!title) return;
  await createPriority(title, str(formData, 'description'), str(formData, 'deadline'));
  revalidatePath(`/x/${token}`);
}

export async function updatePriorityAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); const title = str(formData, 'title');
  if (!id || !title) return;
  await updatePriority(id, title, str(formData, 'description'), str(formData, 'deadline'));
  revalidatePath(`/x/${token}`);
}

export async function archivePriorityAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); if (!id) return;
  await archivePriority(id);
  revalidatePath(`/x/${token}`);
}

export async function createTaskAction(formData: FormData) {
  const token = requireAdmin(formData);
  const description = str(formData, 'description'); if (!description) return;
  await createTask(num(formData, 'priorityId'), num(formData, 'assignedTo'), description, str(formData, 'dueDate'));
  revalidatePath(`/x/${token}`);
}

export async function setTaskStatusAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); const status = String(formData.get('status')) as Task['status'];
  if (!id || !['open', 'in_progress', 'done'].includes(status)) return;
  await setTaskStatus(id, status);
  revalidatePath(`/x/${token}`);
}

export async function deleteTaskAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'taskId'); if (!id) return;
  await deleteTask(id);
  revalidatePath(`/x/${token}`);
}

function parseSchedule(formData: FormData) {
  const days = [...new Set(formData.getAll('days').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const time = String(formData.get('time') ?? '');
  return /^\d{2}:\d{2}$/.test(time) ? { days, time } : null;
}

export async function addCeoScheduleAction(formData: FormData) {
  const token = requireAdmin(formData);
  const parsed = parseSchedule(formData); if (!parsed || !parsed.days.length) return;
  await addCeoSchedule(parsed.time, parsed.days);
  revalidatePath(`/x/${token}`);
}

export async function removeCeoScheduleAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'id'); if (!id) return;
  await removeCeoSchedule(id);
  revalidatePath(`/x/${token}`);
}

export async function setEmployeeScheduleAction(formData: FormData) {
  const token = requireAdmin(formData);
  const id = num(formData, 'employeeId'); const parsed = parseSchedule(formData);
  if (!id || !parsed) return;
  await setEmployeeSchedule(id, parsed.days, parsed.time);
  revalidatePath(`/x/${token}`);
}
