CREATE TABLE IF NOT EXISTS employees (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone_number  TEXT NOT NULL,
  email         TEXT,
  access_token  TEXT NOT NULL UNIQUE,      -- random token; employee dashboard lives at /e/<token>
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  call_days     SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=Sun … 6=Sat, org time zone
  call_time     TIME NOT NULL DEFAULT '08:00',            -- org-local wall clock
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id                    SERIAL PRIMARY KEY,
  employee_id           INTEGER NOT NULL REFERENCES employees(id),
  twilio_call_sid       TEXT UNIQUE,
  status                TEXT NOT NULL DEFAULT 'queued', -- queued, ringing, in-progress, completed, no-answer, busy, failed, canceled
  scheduled_at          TIMESTAMPTZ NOT NULL,
  scheduled_callback_at TIMESTAMPTZ,                    -- employee-chosen retry time
  callback_of_call_id   INTEGER REFERENCES calls(id),   -- set on the retry row
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calls_employee_scheduled ON calls(employee_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS calls_pending_callbacks ON calls(scheduled_callback_at) WHERE scheduled_callback_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS responses (
  id             SERIAL PRIMARY KEY,
  call_id        INTEGER NOT NULL UNIQUE REFERENCES calls(id),
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  transcript     TEXT NOT NULL,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at      TIMESTAMPTZ,
  edit_locked_at TIMESTAMPTZ NOT NULL              -- submitted_at + 20 minutes, set at write time
);
CREATE INDEX IF NOT EXISTS responses_submitted ON responses(submitted_at DESC);

CREATE TABLE IF NOT EXISTS priorities (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  deadline    DATE,
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  priority_id INTEGER REFERENCES priorities(id),
  assigned_to INTEGER REFERENCES employees(id),
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',         -- open, in_progress, done
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ceo_schedules (
  id         SERIAL PRIMARY KEY,
  call_time  TIME NOT NULL,
  days       SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ceo_schedules (call_time, days)
  SELECT '18:00', '{1,2,3,4,5}' WHERE NOT EXISTS (SELECT 1 FROM ceo_schedules);

CREATE TABLE IF NOT EXISTS ceo_calls (
  id              SERIAL PRIMARY KEY,
  call_date       DATE NOT NULL,
  slot            TIME NOT NULL DEFAULT '18:00',   -- which scheduled briefing this was
  summary_text    TEXT NOT NULL,
  twilio_call_sid TEXT,
  status          TEXT,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (call_date, slot)
);
