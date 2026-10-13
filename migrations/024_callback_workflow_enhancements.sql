-- Forward-port of the callback workflow schema from the supplied release.
-- Kept in one new migration to avoid colliding with the Email SLA migrations.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS agent_aliases (
  id SERIAL PRIMARY KEY,
  alias_normalised VARCHAR(255) UNIQUE NOT NULL,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_aliases_alias ON agent_aliases(alias_normalised);
CREATE INDEX IF NOT EXISTS idx_agent_aliases_agent_id ON agent_aliases(agent_id);

ALTER TABLE callback_job_logs ALTER COLUMN comment DROP NOT NULL;
ALTER TABLE callback_job_logs ALTER COLUMN comment SET DEFAULT '';

CREATE TABLE IF NOT EXISTS callback_job_phones (
  id SERIAL PRIMARY KEY,
  callback_job_id INTEGER NOT NULL REFERENCES callback_jobs(id) ON DELETE CASCADE,
  phone_normalised VARCHAR(64) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'PRIMARY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_callback_job_phones UNIQUE (callback_job_id, phone_normalised)
);
CREATE INDEX IF NOT EXISTS idx_callback_job_phones_phone ON callback_job_phones(phone_normalised);
CREATE INDEX IF NOT EXISTS idx_callback_job_phones_job_id ON callback_job_phones(callback_job_id);

INSERT INTO callback_job_phones (callback_job_id, phone_normalised, source)
SELECT id, client_phone, 'PRIMARY'
FROM callback_jobs
WHERE client_phone IS NOT NULL AND client_phone <> ''
ON CONFLICT (callback_job_id, phone_normalised) DO NOTHING;

ALTER TABLE callback_settings ADD COLUMN IF NOT EXISTS max_sms_attempts INTEGER NOT NULL DEFAULT 4;

-- These tables support an explicitly-triggered, auditable repair. Nothing in
-- this migration changes existing callback statuses.
CREATE TABLE IF NOT EXISTS one_time_job_runs (
  id SERIAL PRIMARY KEY,
  job_key TEXT UNIQUE NOT NULL,
  run_token TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS callback_reopen_snapshot (
  id SERIAL PRIMARY KEY,
  job_key TEXT NOT NULL,
  callback_job_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  previous_closed_at TIMESTAMPTZ,
  previous_latest_outcome TEXT,
  previous_assigned_agent_id INTEGER,
  new_assigned_agent_id INTEGER,
  outgoing_calls INTEGER,
  sms_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_callback_reopen_snapshot_job_key ON callback_reopen_snapshot(job_key);
CREATE INDEX IF NOT EXISTS idx_callback_reopen_snapshot_callback_job_id ON callback_reopen_snapshot(callback_job_id);
