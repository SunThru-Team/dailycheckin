// Applying an approved suggestion. The payload shapes here are the contract the
// connector's suggest_changes tool writes and the dashboard's Approve button reads.
import { getSuggestion, setSuggestionStatus, createTask, delegateTask, rankPriorities, rankTasks, updateTask, type Suggestion, type TaskStatus, type Visibility } from './tasks';

export type SuggestionPayload =
  | { kind: 'create_task'; title: string; description?: string | null; assignee_id?: number | null; priority_id?: number | null; due_date?: string | null; visibility?: Visibility }
  | { kind: 'update_task'; task_id: number; title?: string; description?: string | null; status?: TaskStatus; due_date?: string | null; priority_id?: number | null }
  | { kind: 'complete_task'; task_id: number }
  | { kind: 'reassign_task'; task_id: number; assignee_id: number | null }
  | { kind: 'reorder_tasks'; assignee_id: number | null; ordered_task_ids: number[] }
  | { kind: 'rerank_priorities'; ordered_priority_ids: number[] };

/** jsonb usually arrives parsed, but tolerate a stored string rather than silently applying nothing. */
export function readPayload(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } }
  return (raw ?? {}) as Record<string, unknown>;
}

const asId = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asIdList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

/** Human-readable one-liner for the dashboard inbox. */
export function describeSuggestion(s: Suggestion, names: Map<number, string>, taskTitles: Map<number, string>): string {
  const p = readPayload(s.payload);
  const who = (id: unknown) => (typeof id === 'number' ? names.get(id) ?? `#${id}` : 'nobody');
  const task = (id: unknown) => (typeof id === 'number' ? taskTitles.get(id) ?? `task #${id}` : 'a task');
  switch (s.kind) {
    case 'create_task': return `Create “${String(p.title)}” for ${who(p.assignee_id)}`;
    case 'update_task': return `Update ${task(p.task_id)}${p.status ? ` → ${String(p.status)}` : ''}`;
    case 'complete_task': return `Mark ${task(p.task_id)} done`;
    case 'reassign_task': return `Move ${task(p.task_id)} to ${who(p.assignee_id)}`;
    case 'reorder_tasks': return `Reorder ${who(p.assignee_id)}’s tasks (${(p.ordered_task_ids as number[] | undefined)?.length ?? 0} items)`;
    case 'rerank_priorities': return `Reorder the priority list (${(p.ordered_priority_ids as number[] | undefined)?.length ?? 0} items)`;
    default: return s.kind;
  }
}

export async function applySuggestion(id: number): Promise<{ ok: boolean; error?: string }> {
  const s = await getSuggestion(id);
  if (!s) return { ok: false, error: 'Not found.' };
  if (s.status !== 'pending') return { ok: false, error: 'Already resolved.' };
  const p = readPayload(s.payload) as Record<string, never> & SuggestionPayload;

  try {
    switch (s.kind) {
      case 'create_task': {
        if (typeof p.title !== 'string' || !p.title.trim()) return { ok: false, error: 'Suggestion has no task title.' };
        await createTask({
          title: p.title, description: p.description ?? null,
          priorityId: p.priority_id ?? null, assignedTo: p.assignee_id ?? null,
          dueDate: p.due_date ?? null, visibility: p.visibility ?? 'ceo_only', source: 'claude_connector',
        });
        break;
      }
      case 'update_task': {
        const tid = asId(p.task_id);
        if (!tid) return { ok: false, error: 'Suggestion has no task id.' };
        await updateTask(tid, {
          title: p.title, description: p.description, status: p.status,
          dueDate: p.due_date, priorityId: p.priority_id,
        });
        break;
      }
      case 'complete_task': {
        const tid = asId(p.task_id);
        if (!tid) return { ok: false, error: 'Suggestion has no task id.' };
        await updateTask(tid, { status: 'done' });
        break;
      }
      case 'reassign_task': {
        const tid = asId(p.task_id);
        if (!tid) return { ok: false, error: 'Suggestion has no task id.' };
        await delegateTask(tid, asId(p.assignee_id));
        break;
      }
      case 'reorder_tasks': {
        const ids = asIdList(p.ordered_task_ids);
        if (!ids.length) return { ok: false, error: 'Suggestion lists no tasks to reorder.' };
        await rankTasks(ids);
        break;
      }
      case 'rerank_priorities': {
        const ids = asIdList(p.ordered_priority_ids);
        if (!ids.length) return { ok: false, error: 'Suggestion lists no priorities to reorder.' };
        await rankPriorities(ids);
        break;
      }
      default: return { ok: false, error: `Unknown suggestion kind "${s.kind}".` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  await setSuggestionStatus(id, 'approved');
  return { ok: true };
}
