-- Priorities, tasks, visibility, suggestions, progress notes, and the briefing-call toggle.
-- Safe to run more than once. Run it in Neon's SQL Editor BEFORE deploying the matching code.
--
-- Adapted from the spec: this app's employees/priorities/tasks tables already exist with
-- integer primary keys, so these are ALTERs on those tables rather than new UUID tables.

BEGIN;

-- ---------------------------------------------------------------- people
ALTER TABLE employees ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee';
DO $$ BEGIN
  ALTER TABLE employees ADD CONSTRAINT employees_role_check
    CHECK (role IN ('ceo', 'leadership', 'employee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------ priorities
ALTER TABLE priorities ADD COLUMN IF NOT EXISTS rank INTEGER;
ALTER TABLE priorities ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE priorities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE priorities SET status = 'archived' WHERE archived AND status = 'active';
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY deadline NULLS LAST, created_at, id) AS rn
  FROM priorities WHERE rank IS NULL
)
UPDATE priorities p SET rank = ordered.rn FROM ordered WHERE p.id = ordered.id;
ALTER TABLE priorities ALTER COLUMN rank SET DEFAULT 0;
ALTER TABLE priorities ALTER COLUMN rank SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE priorities ADD CONSTRAINT priorities_status_check
    CHECK (status IN ('active', 'done', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------- tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'ceo_only';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dashboard';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- The old table kept the task text in `description`. Promote it to `title`
-- and leave `description` for the longer detail.
ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL;
UPDATE tasks SET title = description WHERE title IS NULL;
UPDATE tasks SET description = NULL WHERE description = title;
ALTER TABLE tasks ALTER COLUMN title SET NOT NULL;

-- Old status vocabulary was open/in_progress/done.
UPDATE tasks SET status = 'not_started' WHERE status = 'open';
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'not_started';
DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('not_started', 'in_progress', 'blocked', 'done'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_visibility_check
    CHECK (visibility IN ('ceo_only', 'leadership', 'assignee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_source_check
    CHECK (source IN ('dashboard', 'claude_connector'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tasks that already existed were created before visibility existed and were
-- visible to their assignee, so keep them that way.
UPDATE tasks SET visibility = 'assignee'
  WHERE assigned_to IS NOT NULL AND created_at < now() - interval '1 second' AND visibility = 'ceo_only';

WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY assigned_to ORDER BY due_date NULLS LAST, id) AS rn FROM tasks
)
UPDATE tasks t SET rank = ordered.rn FROM ordered WHERE t.id = ordered.id AND t.rank = 0;

-- ------------------------------------------------------------- new tables
CREATE TABLE IF NOT EXISTS task_notes (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES employees(id),   -- NULL = written by the CEO through the dashboard/connector
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id, created_at);

CREATE TABLE IF NOT EXISTS suggestions (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  rationale   TEXT,
  source      TEXT NOT NULL,
  batch       TEXT,                              -- groups one reprioritize_team run for "approve all"
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE suggestions ADD CONSTRAINT suggestions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_suggestions_pending ON suggestions(status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS progress_notes (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_progress_notes_employee ON progress_notes(employee_id, created_at DESC);

-- --------------------------------------------------- briefing call toggle
ALTER TABLE ceo_schedules ADD COLUMN IF NOT EXISTS briefing_call_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, rank);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority_id);

COMMIT;

-- ---------------------------------------------------------------- people
-- AFTER running the above, set roles. Replace the names with the real ones.
--   UPDATE employees SET role = 'ceo'        WHERE name = 'John ...';
--   UPDATE employees SET role = 'leadership' WHERE name = 'Jeremy ...';
-- If John is not yet an employees row, add him (he is skipped by the check-in scheduler):
--   INSERT INTO employees (name, phone_number, email, access_token, role, call_days)
--   VALUES ('John ...', '+1XXXXXXXXXX', 'john@sunthru.co',
--           replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
--           'ceo', '{}');
