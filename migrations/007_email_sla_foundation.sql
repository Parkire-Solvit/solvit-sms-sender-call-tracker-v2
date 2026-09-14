-- Email SLA data is deliberately separate from SMS/call events.
CREATE TABLE IF NOT EXISTS email_sla_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  response_minutes INTEGER NOT NULL DEFAULT 30 CHECK (response_minutes > 0),
  response_warning_minutes INTEGER NOT NULL DEFAULT 20 CHECK (response_warning_minutes >= 0),
  response_urgent_minutes INTEGER NOT NULL DEFAULT 25 CHECK (response_urgent_minutes >= 0),
  resolution_minutes INTEGER NOT NULL DEFAULT 120 CHECK (resolution_minutes > 0),
  resolution_warning_minutes INTEGER NOT NULL DEFAULT 90 CHECK (resolution_warning_minutes >= 0),
  resolution_urgent_minutes INTEGER NOT NULL DEFAULT 105 CHECK (resolution_urgent_minutes >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_response_warning_order CHECK (response_warning_minutes < response_urgent_minutes AND response_urgent_minutes < response_minutes),
  CONSTRAINT valid_resolution_warning_order CHECK (resolution_warning_minutes < resolution_urgent_minutes AND resolution_urgent_minutes < resolution_minutes)
);

INSERT INTO email_sla_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS email_team_members (
  agent_id BIGINT PRIMARY KEY REFERENCES agents(id) ON DELETE RESTRICT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  round_robin_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  direct_email TEXT UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_assignment_rules (
  id BIGSERIAL PRIMARY KEY,
  priority INTEGER NOT NULL DEFAULT 100,
  match_field TEXT NOT NULL CHECK (match_field IN ('sender_email', 'recipient_email')),
  match_value TEXT NOT NULL,
  assigned_agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_assignment_cursor (
  mailbox TEXT PRIMARY KEY,
  last_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_threads (
  id BIGSERIAL PRIMARY KEY,
  mailbox TEXT NOT NULL,
  graph_conversation_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL,
  assigned_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  assignment_method TEXT CHECK (assignment_method IN ('DIRECT', 'RULE', 'ROUND_ROBIN', 'MANUAL')),
  received_at TIMESTAMPTZ NOT NULL,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  response_due_at TIMESTAMPTZ NOT NULL,
  resolution_due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNASSIGNED' CHECK (status IN ('UNASSIGNED', 'AWAITING_RESPONSE', 'IN_PROGRESS', 'RESOLVED')),
  response_breached BOOLEAN NOT NULL DEFAULT FALSE,
  resolution_breached BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mailbox, graph_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_email_threads_owner_status ON email_threads(assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_email_threads_response_due ON email_threads(response_due_at) WHERE first_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_threads_resolution_due ON email_threads(resolution_due_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS email_messages (
  id BIGSERIAL PRIMARY KEY,
  email_thread_id BIGINT NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  graph_message_id TEXT NOT NULL UNIQUE,
  graph_conversation_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  recipient_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  sent_or_received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_messages_thread_time ON email_messages(email_thread_id, sent_or_received_at);

CREATE TABLE IF NOT EXISTS email_alerts (
  id BIGSERIAL PRIMARY KEY,
  email_thread_id BIGINT NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'EMAIL_UNASSIGNED', 'RESPONSE_WARNING', 'RESPONSE_URGENT', 'RESPONSE_BREACH',
    'RESOLUTION_WARNING', 'RESOLUTION_URGENT', 'RESOLUTION_BREACH'
  )),
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ,
  UNIQUE (email_thread_id, alert_type)
);

CREATE TABLE IF NOT EXISTS email_sync_state (
  mailbox TEXT NOT NULL,
  folder TEXT NOT NULL,
  delta_link TEXT,
  subscription_id TEXT,
  subscription_expires_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox, folder)
);

CREATE TABLE IF NOT EXISTS email_assignment_history (
  id BIGSERIAL PRIMARY KEY,
  email_thread_id BIGINT NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  previous_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  new_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('DIRECT', 'RULE', 'ROUND_ROBIN', 'MANUAL')),
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
