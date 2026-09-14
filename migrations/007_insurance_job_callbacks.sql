-- Migration 007: Callbacks Extension
-- Add tables for tracking daily valuation callback lists, import batches, and callback settings.

CREATE TABLE IF NOT EXISTS callback_jobs (
  id BIGSERIAL PRIMARY KEY,
  vehicle_reg VARCHAR(100) NOT NULL UNIQUE,
  vehicle_reg_raw VARCHAR(100) NOT NULL,
  client_name VARCHAR(255),
  client_phone VARCHAR(50) NOT NULL,
  client_phone_raw VARCHAR(50) NOT NULL,
  channel_partner VARCHAR(255),
  initiated_date TIMESTAMPTZ,
  brian_reason VARCHAR(255),
  status VARCHAR(10) NOT NULL DEFAULT 'AMBER' CHECK (status IN ('GREEN','AMBER','RED')),
  assigned_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  first_imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_in_import_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_callback_jobs_phone ON callback_jobs(client_phone);
CREATE INDEX IF NOT EXISTS idx_callback_jobs_status ON callback_jobs(status);
CREATE INDEX IF NOT EXISTS idx_callback_jobs_partner ON callback_jobs(channel_partner);
CREATE INDEX IF NOT EXISTS idx_callback_jobs_agent ON callback_jobs(assigned_agent_id);

CREATE TABLE IF NOT EXISTS callback_imports (
  id BIGSERIAL PRIMARY KEY,
  file_name TEXT,
  imported_by VARCHAR(255),
  row_count_total INTEGER NOT NULL DEFAULT 0,
  new_records_count INTEGER NOT NULL DEFAULT 0,
  skipped_open_count INTEGER NOT NULL DEFAULT 0,
  skipped_closed_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS callback_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  staff_count INTEGER NOT NULL DEFAULT 2,
  callback_team_tag VARCHAR(100) NOT NULL DEFAULT 'Callback Team',
  max_attempts INTEGER NOT NULL DEFAULT 4,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO callback_settings (id, staff_count, callback_team_tag, max_attempts)
VALUES (1, 2, 'Callback Team', 4)
ON CONFLICT (id) DO NOTHING;
