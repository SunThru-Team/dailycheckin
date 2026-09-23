-- Run this once in Neon's SQL Editor on a database that already has the original schema.
-- Per-employee call schedule (org-local wall clock). 0=Sun … 6=Sat.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS call_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS call_time TIME NOT NULL DEFAULT '08:00';

-- CEO briefing schedule: any number of daily slots.
CREATE TABLE IF NOT EXISTS ceo_schedules (
  id         SERIAL PRIMARY KEY,
  call_time  TIME NOT NULL,
  days       SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ceo_schedules (call_time, days)
  SELECT '18:00', '{1,2,3,4,5}' WHERE NOT EXISTS (SELECT 1 FROM ceo_schedules);

-- Allow more than one briefing per day.
ALTER TABLE ceo_calls DROP CONSTRAINT IF EXISTS ceo_calls_call_date_key;
ALTER TABLE ceo_calls ADD COLUMN IF NOT EXISTS slot TIME NOT NULL DEFAULT '18:00';
ALTER TABLE ceo_calls ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS ceo_calls_date_slot ON ceo_calls(call_date, slot);
