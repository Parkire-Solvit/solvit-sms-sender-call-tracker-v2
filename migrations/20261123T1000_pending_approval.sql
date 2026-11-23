-- Pending Approval: jobs that are valued and submitted but cannot be approved because documents are missing.
-- One row per job (keyed by the Request ID in the weekly export), an append-only list of follow-up attempts, the log of
-- emails sent from the section, the solver contact list, the AM and valuation team addresses, and one settings row.

CREATE TABLE IF NOT EXISTS pending_approval_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Agents whose tag matches this open the Pending Approval section (administrators always can).
  team_tag VARCHAR(100) NOT NULL DEFAULT 'Approvals Team',
  target_conversion NUMERIC(5,4) NOT NULL DEFAULT 0.9900 CHECK (target_conversion >= 0 AND target_conversion <= 1),
  valuation_group VARCHAR(255) NOT NULL DEFAULT 'valuations@solvit.co.ke',
  cs_group VARCHAR(255) NOT NULL DEFAULT 'cs-team@solvit.co.ke',
  -- Mailbox emails are sent from when the signed-in user has none of their own. Administrators only.
  default_sender_mailbox VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO pending_approval_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Which Outlook mailbox each portal login sends from. Administrators only: it decides whose name an email carries.
CREATE TABLE IF NOT EXISTS pending_approval_senders (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  mailbox VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- team: 'am' (Account Management, emailed for Ref Agent jobs) or 'val' (valuers, emailed when a document is received).
-- Names must match the Initiated_by (AM) and Allocated_to (valuer) names in the export.
CREATE TABLE IF NOT EXISTS pending_approval_team (
  id BIGSERIAL PRIMARY KEY,
  team VARCHAR(10) NOT NULL CHECK (team IN ('am', 'val')),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pat_team_name ON pending_approval_team(team, lower(name));

CREATE TABLE IF NOT EXISTS pending_approval_solvers (
  id BIGSERIAL PRIMARY KEY,
  name_key VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  region VARCHAR(255) NOT NULL DEFAULT '',
  location VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(50) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_approval_imports (
  id BIGSERIAL PRIMARY KEY,
  file_name TEXT,
  imported_by VARCHAR(255),
  row_count_total INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  refreshed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  -- Open jobs that were not in this file. They are only closed when the user confirms (closed_missing_at).
  missing_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  closed_missing_at TIMESTAMPTZ,
  closed_missing_by VARCHAR(255),
  closed_missing_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_approval_jobs (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL UNIQUE,
  allocated_to VARCHAR(255) NOT NULL DEFAULT '',
  vehicle_reg VARCHAR(100) NOT NULL DEFAULT '',
  val_date TIMESTAMPTZ NOT NULL,
  policy_holder VARCHAR(255) NOT NULL DEFAULT '',
  initiated_by VARCHAR(255) NOT NULL DEFAULT '',
  source_raw VARCHAR(100) NOT NULL DEFAULT '',
  fleet VARCHAR(255) NOT NULL DEFAULT '',
  client_cell VARCHAR(50) NOT NULL DEFAULT '',
  insurer VARCHAR(255) NOT NULL DEFAULT '',
  insurer_email VARCHAR(255) NOT NULL DEFAULT '',
  request_type VARCHAR(100) NOT NULL DEFAULT '',
  solver_name VARCHAR(255) NOT NULL DEFAULT '',
  solver_email VARCHAR(255) NOT NULL DEFAULT '',
  solver_phone VARCHAR(50) NOT NULL DEFAULT '',
  reason VARCHAR(255) NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Set by hand when the export does not say who should be followed up (solver, ref, cp).
  route_override VARCHAR(20),
  -- Why no follow-up was done, for jobs that were never actioned (reported in Segment 2).
  nofu_reason VARCHAR(255),
  -- A non-actionable job brought back into play: follow-ups are counted again from this moment.
  reactivated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_by VARCHAR(255),
  -- 'export': dropped off the pending export (approved on its own). 'received': the document was received.
  closed_via VARCHAR(20),
  first_imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_paj_status ON pending_approval_jobs(status);
CREATE INDEX IF NOT EXISTS idx_paj_insurer ON pending_approval_jobs(insurer);

-- Append-only. Two people logging on the same job at the same moment both keep their entry.
-- attempt_type: call, message (text or WhatsApp), email: follow-ups. update: the outcome of an earlier contact.
-- receipt: the system's own record of a closure.
CREATE TABLE IF NOT EXISTS pending_approval_attempts (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES pending_approval_jobs(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  by_name VARCHAR(255) NOT NULL,
  attempt_type VARCHAR(20) NOT NULL CHECK (attempt_type IN ('call', 'message', 'email', 'update', 'receipt')),
  party VARCHAR(40) NOT NULL DEFAULT '-',
  outcome VARCHAR(40) NOT NULL,
  outcome_text TEXT,
  contact TEXT,
  note TEXT,
  -- Lets a retried save (flaky connection, double click) be recognised and not stored twice.
  client_request_id VARCHAR(80) UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_paa_job ON pending_approval_attempts(job_id, attempted_at);

CREATE TABLE IF NOT EXISTS pending_approval_emails (
  id BIGSERIAL PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  by_name VARCHAR(255) NOT NULL,
  -- am, ins: follow-up emails. received: told the valuer. solver: told the solver.
  kind VARCHAR(20) NOT NULL,
  email_key VARCHAR(255) NOT NULL DEFAULT '',
  to_addrs JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_addrs JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL DEFAULT '',
  job_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_pae_sent ON pending_approval_emails(sent_at DESC);
