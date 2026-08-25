CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE,
  phone_number VARCHAR(50),
  tag VARCHAR(100) NOT NULL DEFAULT 'Uncategorised',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agents_tag ON agents(tag);
CREATE INDEX IF NOT EXISTS idx_agents_last_active ON agents(last_active_at);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL ON UPDATE CASCADE,
  type VARCHAR(20) NOT NULL,
  target_phone VARCHAR(50) NOT NULL,
  status VARCHAR(50),
  duration INTEGER NOT NULL DEFAULT 0,
  reg_no VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_phone ON events(target_phone);
CREATE INDEX IF NOT EXISTS idx_events_agent_timestamp ON events(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type_status ON events(type, status);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  callback_window_minutes INTEGER NOT NULL DEFAULT 30,
  reconnection_window_minutes INTEGER NOT NULL DEFAULT 1440,
  sms_followup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_deadline_minutes INTEGER NOT NULL DEFAULT 30,
  working_hours_schedule JSONB NOT NULL,
  clock_mode VARCHAR(50) NOT NULL DEFAULT 'working_hours',
  min_connection_duration INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'system_settings' AND column_name = 'working_hours_json'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'system_settings' AND column_name = 'working_hours_schedule'
  ) THEN
    ALTER TABLE system_settings RENAME COLUMN working_hours_json TO working_hours_schedule;
    ALTER TABLE system_settings ALTER COLUMN working_hours_schedule TYPE JSONB USING working_hours_schedule::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS settings_change_log (
  id BIGSERIAL PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by VARCHAR(100) NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_settings_log_key ON settings_change_log(setting_key);
CREATE INDEX IF NOT EXISTS idx_settings_log_created_at ON settings_change_log(created_at);

CREATE TABLE IF NOT EXISTS internal_contacts (
  id BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(50) NOT NULL UNIQUE,
  label VARCHAR(100) DEFAULT 'Internal Staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (
  id, callback_window_minutes, reconnection_window_minutes, sms_followup_enabled,
  sms_deadline_minutes, working_hours_schedule, clock_mode, min_connection_duration
) VALUES (
  1, 30, 1440, TRUE, 30,
  '{"monday":{"enabled":true,"open":"09:00","close":"17:00"},"tuesday":{"enabled":true,"open":"09:00","close":"17:00"},"wednesday":{"enabled":true,"open":"09:00","close":"17:00"},"thursday":{"enabled":true,"open":"09:00","close":"17:00"},"friday":{"enabled":true,"open":"09:00","close":"17:00"},"saturday":{"enabled":true,"open":"09:00","close":"12:00"},"sunday":{"enabled":false,"open":"09:00","close":"17:00"}}'::jsonb,
  'working_hours', 0
) ON CONFLICT (id) DO NOTHING;
