import type postgres from 'postgres';
import { EDIT_WINDOW_MINUTES } from './env';
import { makeSql } from './pg';

declare global { var __sql: ReturnType<typeof postgres> | undefined; }

function client() {
  if (!globalThis.__sql) globalThis.__sql = makeSql();
  return globalThis.__sql;
}
export const sql = new Proxy((() => {}) as unknown as ReturnType<typeof postgres>, {
  apply: (_t, _this, args) => (client() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => (client() as unknown as Record<PropertyKey, unknown>)[prop],
}) as ReturnType<typeof postgres>;

// ---- Types -----------------------------------------------------------------
export type Employee = {
  id: number; name: string; phone_number: string; email: string | null; access_token: string; active: boolean;
  call_days: number[]; call_time: string; // 'HH:MM:SS', org-local
};
export type CeoSchedule = { id: number; call_time: string; days: number[]; active: boolean };
export type Call = {
  id: number; employee_id: number; twilio_call_sid: string | null; status: string;
  scheduled_at: Date; scheduled_callback_at: Date | null; callback_of_call_id: number | null;
  started_at: Date | null; ended_at: Date | null;
};
export type ResponseRow = {
  id: number; call_id: number; employee_id: number; transcript: string;
  submitted_at: Date; edited_at: Date | null; edit_locked_at: Date;
};
export type Priority = { id: number; title: string; description: string | null; deadline: string | null; archived: boolean; created_at: Date };
export type Task = {
  id: number; priority_id: number | null; assigned_to: number | null; description: string;
  status: 'open' | 'in_progress' | 'done'; due_date: string | null;
  priority_title?: string | null; priority_deadline?: string | null; assignee_name?: string | null;
};
export type CeoCall = { id: number; call_date: string; slot: string; summary_text: string; twilio_call_sid: string | null; status: string | null; generated_at: Date };

export const MISSED_STATUSES = ['no-answer', 'busy', 'failed', 'canceled'];

// ---- Employees -------------------------------------------------------------
export const getEmployeeByToken = async (token: string) =>
  (await sql<Employee[]>`SELECT * FROM employees WHERE access_token = ${token} AND active`)[0] ?? null;
export const listActiveEmployees = () =>
  sql<Employee[]>`SELECT * FROM employees WHERE active ORDER BY name`;

export const setEmployeeSchedule = (employeeId: number, days: number[], time: string) =>
  sql`UPDATE employees SET call_days = ${days}::smallint[], call_time = ${time}::time WHERE id = ${employeeId}`;

// ---- CEO schedule -----------------------------------------------------------
export const listCeoSchedules = () =>
  sql<CeoSchedule[]>`SELECT id, call_time::text AS call_time, days, active FROM ceo_schedules WHERE active ORDER BY call_time`;
export const addCeoSchedule = (time: string, days: number[]) =>
  sql`INSERT INTO ceo_schedules (call_time, days) VALUES (${time}::time, ${days}::smallint[])`;
export const removeCeoSchedule = (id: number) =>
  sql`UPDATE ceo_schedules SET active = FALSE WHERE id = ${id}`;

// ---- Calls -----------------------------------------------------------------
export const createCall = async (employeeId: number, scheduledAt: Date, callbackOf?: number) =>
  (await sql<Call[]>`
    INSERT INTO calls (employee_id, scheduled_at, callback_of_call_id)
    VALUES (${employeeId}, ${scheduledAt}, ${callbackOf ?? null}) RETURNING *`)[0];

export const setCallSid = (id: number, sid: string, status = 'queued') =>
  sql`UPDATE calls SET twilio_call_sid = ${sid}, status = ${status} WHERE id = ${id}`;

export const markCallFailed = (id: number) =>
  sql`UPDATE calls SET status = 'failed', ended_at = now() WHERE id = ${id}`;

export const getCall = async (id: number) =>
  (await sql<Call[]>`SELECT * FROM calls WHERE id = ${id}`)[0] ?? null;

export async function updateCallStatusBySid(sid: string, status: string) {
  const startedAt = status === 'in-progress' ? sql`, started_at = COALESCE(started_at, now())` : sql``;
  const endedAt = ['completed', ...MISSED_STATUSES].includes(status) ? sql`, ended_at = now()` : sql``;
  await sql`UPDATE calls SET status = ${status} ${startedAt} ${endedAt} WHERE twilio_call_sid = ${sid}`;
}

/** Did the employee already get a completed check-in call today (org date)? */
export const hasCallToday = async (employeeId: number, dateISO: string) =>
  (await sql`SELECT 1 FROM calls WHERE employee_id = ${employeeId}
     AND (scheduled_at AT TIME ZONE ${process.env.ORG_TIMEZONE ?? 'America/New_York'})::date = ${dateISO}::date
     AND callback_of_call_id IS NULL LIMIT 1`).length > 0;

export const listCallsForEmployee = (employeeId: number, limit = 30) =>
  sql<Call[]>`SELECT * FROM calls WHERE employee_id = ${employeeId} ORDER BY scheduled_at DESC LIMIT ${limit}`;

/** Missed calls that have no response and no pending/completed retry. */
export const listMissedCallsNeedingAction = (employeeId: number) =>
  sql<Call[]>`
    SELECT c.* FROM calls c
    WHERE c.employee_id = ${employeeId}
      AND c.status = ANY(${MISSED_STATUSES})
      AND c.scheduled_callback_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.call_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM calls r WHERE r.callback_of_call_id = c.id AND r.status NOT IN ('failed','no-answer','busy','canceled'))
      AND c.scheduled_at > now() - interval '3 days'
    ORDER BY c.scheduled_at DESC`;

export const listPendingCallbacks = (employeeId: number) =>
  sql<Call[]>`SELECT * FROM calls WHERE employee_id = ${employeeId}
    AND scheduled_callback_at IS NOT NULL AND scheduled_callback_at > now() ORDER BY scheduled_callback_at`;

export const setCallback = (callId: number, employeeId: number, at: Date) =>
  sql`UPDATE calls SET scheduled_callback_at = ${at}
      WHERE id = ${callId} AND employee_id = ${employeeId} AND status = ANY(${MISSED_STATUSES})`;

/** Callbacks whose time has passed and which haven't yet spawned a retry row. */
export const listDueCallbacks = () =>
  sql<Call[]>`
    SELECT c.* FROM calls c
    WHERE c.scheduled_callback_at IS NOT NULL
      AND c.scheduled_callback_at <= now()
      AND NOT EXISTS (SELECT 1 FROM calls r WHERE r.callback_of_call_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.call_id = c.id)`;

export const clearCallback = (callId: number) =>
  sql`UPDATE calls SET scheduled_callback_at = NULL WHERE id = ${callId}`;

// ---- Responses -------------------------------------------------------------
/** Insert the first spoken segment, or append a later one. The edit window restarts on each segment. */
export async function saveResponse(callId: number, employeeId: number, transcript: string) {
  const [row] = await sql<ResponseRow[]>`
    INSERT INTO responses (call_id, employee_id, transcript, submitted_at, edit_locked_at)
    VALUES (${callId}, ${employeeId}, ${transcript}, now(), now() + make_interval(mins => ${EDIT_WINDOW_MINUTES}))
    ON CONFLICT (call_id) DO UPDATE
      SET transcript = responses.transcript || ' ' || EXCLUDED.transcript,
          edit_locked_at = now() + make_interval(mins => ${EDIT_WINDOW_MINUTES})
    RETURNING *`;
  return row;
}

export const listResponsesForEmployee = (employeeId: number, limit = 30) =>
  sql<ResponseRow[]>`SELECT * FROM responses WHERE employee_id = ${employeeId} ORDER BY submitted_at DESC LIMIT ${limit}`;

/** Server-side enforcement of the edit window. Returns the updated row, or null if locked / not owned. */
export async function editResponse(responseId: number, employeeId: number, transcript: string) {
  const rows = await sql<ResponseRow[]>`
    UPDATE responses SET transcript = ${transcript}, edited_at = now()
    WHERE id = ${responseId} AND employee_id = ${employeeId} AND edit_locked_at > now()
    RETURNING *`;
  return rows[0] ?? null;
}

export type ResponseWithName = ResponseRow & { employee_name: string; date: string };
export const listResponsesForDate = (dateISO: string) =>
  sql<ResponseWithName[]>`
    SELECT r.*, e.name AS employee_name,
           to_char(r.submitted_at AT TIME ZONE ${process.env.ORG_TIMEZONE ?? 'America/New_York'}, 'YYYY-MM-DD') AS date
    FROM responses r JOIN employees e ON e.id = r.employee_id
    WHERE (r.submitted_at AT TIME ZONE ${process.env.ORG_TIMEZONE ?? 'America/New_York'})::date = ${dateISO}::date
    ORDER BY e.name`;

export const getRecentResponses = (days: number) =>
  sql<ResponseWithName[]>`
    SELECT r.*, e.name AS employee_name,
           to_char(r.submitted_at AT TIME ZONE ${process.env.ORG_TIMEZONE ?? 'America/New_York'}, 'YYYY-MM-DD') AS date
    FROM responses r JOIN employees e ON e.id = r.employee_id
    WHERE r.submitted_at > now() - make_interval(days => ${days})
    ORDER BY r.submitted_at DESC`;

// ---- Priorities & tasks ----------------------------------------------------
export const getPriorities = (includeArchived = false) =>
  sql<Priority[]>`SELECT id, title, description, deadline::text AS deadline, archived, created_at
    FROM priorities WHERE ${includeArchived ? sql`TRUE` : sql`NOT archived`}
    ORDER BY deadline NULLS LAST, created_at`;

export const createPriority = (title: string, description: string | null, deadline: string | null) =>
  sql`INSERT INTO priorities (title, description, deadline) VALUES (${title}, ${description}, ${deadline})`;

export const updatePriority = (id: number, title: string, description: string | null, deadline: string | null) =>
  sql`UPDATE priorities SET title = ${title}, description = ${description}, deadline = ${deadline} WHERE id = ${id}`;

export const archivePriority = (id: number) =>
  sql`UPDATE priorities SET archived = TRUE WHERE id = ${id}`;

export const listTasks = () =>
  sql<Task[]>`
    SELECT t.id, t.priority_id, t.assigned_to, t.description, t.status, t.due_date::text AS due_date,
           p.title AS priority_title, p.deadline::text AS priority_deadline, e.name AS assignee_name
    FROM tasks t LEFT JOIN priorities p ON p.id = t.priority_id LEFT JOIN employees e ON e.id = t.assigned_to
    ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.id`;

export const listTasksForEmployee = (employeeId: number) =>
  sql<Task[]>`
    SELECT t.id, t.priority_id, t.assigned_to, t.description, t.status, t.due_date::text AS due_date,
           p.title AS priority_title, p.deadline::text AS priority_deadline
    FROM tasks t LEFT JOIN priorities p ON p.id = t.priority_id
    WHERE t.assigned_to = ${employeeId}
    ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.id`;

export const createTask = (priorityId: number | null, assignedTo: number | null, description: string, dueDate: string | null) =>
  sql`INSERT INTO tasks (priority_id, assigned_to, description, due_date)
      VALUES (${priorityId}, ${assignedTo}, ${description}, ${dueDate})`;

export const setTaskStatus = (id: number, status: Task['status']) =>
  sql`UPDATE tasks SET status = ${status} WHERE id = ${id}`;

export const setTaskStatusForEmployee = (id: number, employeeId: number, status: Task['status']) =>
  sql`UPDATE tasks SET status = ${status} WHERE id = ${id} AND assigned_to = ${employeeId}`;

export const deleteTask = (id: number) => sql`DELETE FROM tasks WHERE id = ${id}`;

// ---- CEO calls -------------------------------------------------------------
const ceoCols = () => sql`id, call_date::text AS call_date, slot::text AS slot, summary_text, twilio_call_sid, status, generated_at`;

export const upsertCeoCall = async (dateISO: string, slot: string, summary: string) =>
  (await sql<CeoCall[]>`
    INSERT INTO ceo_calls (call_date, slot, summary_text, status, generated_at)
    VALUES (${dateISO}, ${slot}::time, ${summary}, 'queued', now())
    ON CONFLICT (call_date, slot) DO UPDATE
      SET summary_text = EXCLUDED.summary_text, status = 'queued', generated_at = now()
    RETURNING ${ceoCols()}`)[0];

export const ceoCallExists = async (dateISO: string, slot: string) =>
  (await sql`SELECT 1 FROM ceo_calls WHERE call_date = ${dateISO} AND slot = ${slot}::time`).length > 0;

/** Most recent briefing generated on a given org date, if any. */
export const latestCeoCallOn = async (dateISO: string) =>
  (await sql<CeoCall[]>`SELECT ${ceoCols()} FROM ceo_calls WHERE call_date = ${dateISO} ORDER BY generated_at DESC LIMIT 1`)[0] ?? null;

export const listResponsesSince = (since: Date) =>
  sql<ResponseWithName[]>`
    SELECT r.*, e.name AS employee_name,
           to_char(r.submitted_at AT TIME ZONE ${process.env.ORG_TIMEZONE ?? 'America/New_York'}, 'YYYY-MM-DD') AS date
    FROM responses r JOIN employees e ON e.id = r.employee_id
    WHERE r.submitted_at > ${since} ORDER BY e.name`;

export const setCeoCallSid = (id: number, sid: string | null, status: string) =>
  sql`UPDATE ceo_calls SET twilio_call_sid = ${sid}, status = ${status} WHERE id = ${id}`;

export const getCeoCall = async (id: number) =>
  (await sql<CeoCall[]>`SELECT ${ceoCols()} FROM ceo_calls WHERE id = ${id}`)[0] ?? null;

export const listCeoCalls = (limit = 30) =>
  sql<CeoCall[]>`SELECT ${ceoCols()} FROM ceo_calls ORDER BY call_date DESC, slot DESC LIMIT ${limit}`;

export const updateCeoCallStatusBySid = (sid: string, status: string) =>
  sql`UPDATE ceo_calls SET status = ${status} WHERE twilio_call_sid = ${sid}`;

/** Dates (org tz) that have at least one response, newest first. */
export const listResponseDates = (limit = 30) =>
  sql<{ date: string; count: number }[]>`
    SELECT to_char(submitted_at AT TIME ZONE ${process.env.ORG_TIMEZONE ?? 'America/New_York'}, 'YYYY-MM-DD') AS date,
           count(*)::int AS count
    FROM responses GROUP BY 1 ORDER BY 1 DESC LIMIT ${limit}`;
