// Priorities, tasks, notes, suggestions and progress notes.
// Every read here takes a Viewer and filters in SQL.
import type { Viewer } from './access';
import { sql } from './db';

export type PriorityStatus = 'active' | 'done' | 'archived';
export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';
export type Visibility = 'ceo_only' | 'leadership' | 'assignee';

export type PriorityRow = {
  id: number; title: string; description: string | null; deadline: string | null;
  rank: number; status: PriorityStatus; task_count: number; active_task_count: number;
};
export type TaskRow = {
  id: number; title: string; description: string | null; priority_id: number | null;
  assigned_to: number | null; rank: number; status: TaskStatus; visibility: Visibility;
  due_date: string | null; source: string; completed_at: Date | null;
  priority_title: string | null; assignee_name: string | null; note_count: number;
};
export type TaskNote = { id: number; task_id: number; author_id: number | null; author_name: string | null; body: string; created_at: Date };
export type Suggestion = {
  id: number; kind: string; payload: Record<string, unknown>; rationale: string | null;
  source: string; batch: string | null; status: string; created_at: Date;
};
export type ProgressNote = { id: number; employee_id: number; body: string; published: boolean; created_at: Date };

export const TASK_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'done'];
export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done',
};
export const VISIBILITY_LABEL: Record<Visibility, string> = {
  ceo_only: 'Private to you', leadership: 'Leadership', assignee: 'Released',
};

/** The WHERE fragment implementing the visibility rules. */
function visibleTo(v: Viewer) {
  if (v.kind === 'ceo') return sql`TRUE`;
  if (v.kind === 'leadership') {
    return sql`(t.visibility IN ('leadership', 'assignee'))`;
  }
  return sql`(t.visibility = 'assignee' AND t.assigned_to = ${v.employeeId})`;
}

// ------------------------------------------------------------- priorities
export const listPriorities = (includeInactive = false) =>
  sql<PriorityRow[]>`
    SELECT p.id, p.title, p.description, p.deadline::text AS deadline, p.rank, p.status,
           (SELECT count(*)::int FROM tasks t WHERE t.priority_id = p.id) AS task_count,
           (SELECT count(*)::int FROM tasks t WHERE t.priority_id = p.id AND t.status <> 'done') AS active_task_count
    FROM priorities p
    WHERE ${includeInactive ? sql`TRUE` : sql`p.status = 'active'`}
    ORDER BY p.rank, p.id`;

export const getPriorityByTitle = async (needle: string) =>
  (await sql<PriorityRow[]>`
    SELECT p.id, p.title, p.description, p.deadline::text AS deadline, p.rank, p.status, 0 AS task_count, 0 AS active_task_count
    FROM priorities p WHERE lower(p.title) LIKE ${'%' + needle.toLowerCase() + '%'} AND p.status <> 'archived'
    ORDER BY length(p.title) LIMIT 1`)[0] ?? null;

export async function createPriorityRanked(title: string, description: string | null, deadline: string | null, rank?: number) {
  const target = rank && rank > 0 ? rank : ((await sql<{ m: number }[]>`SELECT COALESCE(max(rank), 0) + 1 AS m FROM priorities`)[0].m);
  await sql`UPDATE priorities SET rank = rank + 1, updated_at = now() WHERE rank >= ${target} AND status = 'active'`;
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO priorities (title, description, deadline, rank) VALUES (${title}, ${description}, ${deadline}, ${target}) RETURNING id`;
  return row.id;
}

export const updatePriorityRow = (id: number, fields: { title?: string; description?: string | null; deadline?: string | null; status?: PriorityStatus }) =>
  sql`UPDATE priorities SET
        title = COALESCE(${fields.title ?? null}, title),
        description = ${fields.description === undefined ? sql`description` : fields.description},
        deadline = ${fields.deadline === undefined ? sql`deadline` : fields.deadline},
        status = COALESCE(${fields.status ?? null}, status),
        archived = (COALESCE(${fields.status ?? null}, status) = 'archived'),
        updated_at = now()
      WHERE id = ${id}`;

export async function rankPriorities(orderedIds: number[]) {
  await sql.begin(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx`UPDATE priorities SET rank = ${i + 1}, updated_at = now() WHERE id = ${id}`;
    }
  });
}

/** Move one priority up or down among the active ones. */
export async function nudgePriority(id: number, dir: -1 | 1) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM priorities WHERE status = 'active' ORDER BY rank, id`;
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await rankPriorities(ids);
}

// ------------------------------------------------------------------ tasks
const TASK_SELECT = () => sql`
  t.id, t.title, t.description, t.priority_id, t.assigned_to, t.rank, t.status, t.visibility,
  t.due_date::text AS due_date, t.source, t.completed_at,
  p.title AS priority_title, e.name AS assignee_name,
  (SELECT count(*)::int FROM task_notes n WHERE n.task_id = t.id) AS note_count`;

export const listTasksVisible = (v: Viewer, filter: { assignedTo?: number | null; priorityId?: number; status?: TaskStatus } = {}) =>
  sql<TaskRow[]>`
    SELECT ${TASK_SELECT()}
    FROM tasks t LEFT JOIN priorities p ON p.id = t.priority_id LEFT JOIN employees e ON e.id = t.assigned_to
    WHERE ${visibleTo(v)}
      AND ${filter.assignedTo === undefined ? sql`TRUE`
            : filter.assignedTo === null ? sql`t.assigned_to IS NULL` : sql`t.assigned_to = ${filter.assignedTo}`}
      AND ${filter.priorityId ? sql`t.priority_id = ${filter.priorityId}` : sql`TRUE`}
      AND ${filter.status ? sql`t.status = ${filter.status}` : sql`TRUE`}
    ORDER BY (t.status = 'done'), t.rank, t.id`;

export const getTaskVisible = async (v: Viewer, id: number) =>
  (await sql<TaskRow[]>`
    SELECT ${TASK_SELECT()}
    FROM tasks t LEFT JOIN priorities p ON p.id = t.priority_id LEFT JOIN employees e ON e.id = t.assigned_to
    WHERE t.id = ${id} AND ${visibleTo(v)}`)[0] ?? null;

export async function createTask(input: {
  title: string; description?: string | null; priorityId?: number | null; assignedTo?: number | null;
  dueDate?: string | null; visibility?: Visibility; status?: TaskStatus; source?: string;
}) {
  const [{ m }] = await sql<{ m: number }[]>`
    SELECT COALESCE(max(rank), 0) + 1 AS m FROM tasks
    WHERE assigned_to IS NOT DISTINCT FROM ${input.assignedTo ?? null}`;
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO tasks (title, description, priority_id, assigned_to, due_date, visibility, status, source, rank)
    VALUES (${input.title}, ${input.description ?? null}, ${input.priorityId ?? null}, ${input.assignedTo ?? null},
            ${input.dueDate ?? null}, ${input.visibility ?? 'ceo_only'}, ${input.status ?? 'not_started'},
            ${input.source ?? 'dashboard'}, ${m})
    RETURNING id`;
  return row.id;
}

export async function updateTask(id: number, f: {
  title?: string; description?: string | null; status?: TaskStatus; dueDate?: string | null;
  priorityId?: number | null; visibility?: Visibility;
}) {
  await sql`UPDATE tasks SET
      title = COALESCE(${f.title ?? null}, title),
      description = ${f.description === undefined ? sql`description` : f.description},
      status = COALESCE(${f.status ?? null}, status),
      completed_at = CASE WHEN COALESCE(${f.status ?? null}, status) = 'done'
                          THEN COALESCE(completed_at, now()) ELSE NULL END,
      due_date = ${f.dueDate === undefined ? sql`due_date` : f.dueDate},
      priority_id = ${f.priorityId === undefined ? sql`priority_id` : f.priorityId},
      visibility = COALESCE(${f.visibility ?? null}, visibility),
      updated_at = now()
    WHERE id = ${id}`;
}

/** Assign or reassign. Visibility is deliberately left alone. */
export async function delegateTask(id: number, assigneeId: number | null) {
  const [{ m }] = await sql<{ m: number }[]>`
    SELECT COALESCE(max(rank), 0) + 1 AS m FROM tasks WHERE assigned_to IS NOT DISTINCT FROM ${assigneeId}`;
  await sql`UPDATE tasks SET assigned_to = ${assigneeId}, rank = ${m}, updated_at = now() WHERE id = ${id}`;
}

export const setTaskVisibility = (id: number, visibility: Visibility) =>
  sql`UPDATE tasks SET visibility = ${visibility}, updated_at = now() WHERE id = ${id}`;

export async function rankTasks(orderedIds: number[]) {
  await sql.begin(async (tx) => {
    for (const [i, id] of orderedIds.entries()) await tx`UPDATE tasks SET rank = ${i + 1}, updated_at = now() WHERE id = ${id}`;
  });
}

export async function nudgeTask(id: number, dir: -1 | 1) {
  const [task] = await sql<{ assigned_to: number | null }[]>`SELECT assigned_to FROM tasks WHERE id = ${id}`;
  if (!task) return;
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM tasks WHERE assigned_to IS NOT DISTINCT FROM ${task.assigned_to} ORDER BY (status='done'), rank, id`;
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await rankTasks(ids);
}

export const deleteTaskRow = (id: number) => sql`DELETE FROM tasks WHERE id = ${id}`;

// ------------------------------------------------------------- task notes
export const listNotesVisible = (v: Viewer, taskId: number) =>
  sql<TaskNote[]>`
    SELECT n.id, n.task_id, n.author_id, e.name AS author_name, n.body, n.created_at
    FROM task_notes n LEFT JOIN employees e ON e.id = n.author_id
    WHERE n.task_id = ${taskId}
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = n.task_id AND ${visibleTo(v)})
    ORDER BY n.created_at`;

export const recentNotesFor = (employeeId: number, limit = 5) =>
  sql<(TaskNote & { task_title: string })[]>`
    SELECT n.id, n.task_id, n.author_id, e.name AS author_name, n.body, n.created_at, t.title AS task_title
    FROM task_notes n JOIN tasks t ON t.id = n.task_id LEFT JOIN employees e ON e.id = n.author_id
    WHERE t.assigned_to = ${employeeId} ORDER BY n.created_at DESC LIMIT ${limit}`;

/** Adding a note requires the author to be able to see the task. */
export async function addNote(v: Viewer, taskId: number, authorId: number | null, body: string) {
  const rows = await sql`
    INSERT INTO task_notes (task_id, author_id, body)
    SELECT ${taskId}, ${authorId}, ${body}
    WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.id = ${taskId} AND ${visibleTo(v)})
    RETURNING id`;
  return rows.length > 0;
}

// ------------------------------------------------------------ suggestions
export const listSuggestions = (status = 'pending') =>
  sql<Suggestion[]>`SELECT id, kind, payload, rationale, source, batch, status, created_at
    FROM suggestions WHERE status = ${status} ORDER BY created_at DESC, id`;

export const countPendingSuggestions = async () =>
  Number((await sql<{ c: string }[]>`SELECT count(*) AS c FROM suggestions WHERE status = 'pending'`)[0].c);

export const addSuggestion = async (kind: string, payload: unknown, rationale: string | null, source: string, batch: string | null) =>
  (await sql<{ id: number }[]>`
    INSERT INTO suggestions (kind, payload, rationale, source, batch)
    VALUES (${kind}, ${sql.json(payload as never)}, ${rationale}, ${source}, ${batch}) RETURNING id`)[0].id;

export const setSuggestionStatus = (id: number, status: 'approved' | 'rejected') =>
  sql`UPDATE suggestions SET status = ${status}, resolved_at = now() WHERE id = ${id} AND status = 'pending'`;

export const getSuggestion = async (id: number) =>
  (await sql<Suggestion[]>`SELECT id, kind, payload, rationale, source, batch, status, created_at FROM suggestions WHERE id = ${id}`)[0] ?? null;

export const listBatch = (batch: string) =>
  sql<Suggestion[]>`SELECT id, kind, payload, rationale, source, batch, status, created_at
    FROM suggestions WHERE batch = ${batch} AND status = 'pending' ORDER BY id`;

// --------------------------------------------------------- progress notes
export const latestPublishedNote = async (employeeId: number) =>
  (await sql<ProgressNote[]>`SELECT * FROM progress_notes WHERE employee_id = ${employeeId} AND published
    ORDER BY created_at DESC LIMIT 1`)[0] ?? null;

export const latestNoteAnyState = async (employeeId: number) =>
  (await sql<ProgressNote[]>`SELECT * FROM progress_notes WHERE employee_id = ${employeeId}
    ORDER BY created_at DESC LIMIT 1`)[0] ?? null;

export const addProgressNote = (employeeId: number, body: string, published: boolean) =>
  sql`INSERT INTO progress_notes (employee_id, body, published) VALUES (${employeeId}, ${body}, ${published})`;
