CREATE TABLE IF NOT EXISTS pending_submission_jobs (
  id BIGSERIAL PRIMARY KEY,
  external_id BIGINT NOT NULL UNIQUE,
  solver_name VARCHAR(255),
  solver_contact VARCHAR(50) NOT NULL,
  solver_contact_raw VARCHAR(50) NOT NULL,
  solver_email VARCHAR(255),
  vehicle_reg VARCHAR(100) NOT NULL,
  vehicle_reg_raw VARCHAR(100) NOT NULL,
  insurance_company VARCHAR(255),
  client_phone VARCHAR(50) NOT NULL,
  client_phone_raw VARCHAR(50) NOT NULL,
  customer_email VARCHAR(255),
  schedule_date TIMESTAMPTZ,
  latest_pending_reason VARCHAR(255),
  status VARCHAR(10) NOT NULL DEFAULT 'AMBER' CHECK (status IN ('GREEN','AMBER','RED')),
  latest_outcome VARCHAR(50),
  assigned_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  scheduled_place TEXT,
  solver_notification_status VARCHAR(20),
  solver_notified_at TIMESTAMPTZ,
  first_imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_in_import_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_psj_client_phone ON pending_submission_jobs(client_phone);
CREATE INDEX IF NOT EXISTS idx_psj_solver_contact ON pending_submission_jobs(solver_contact);
CREATE INDEX IF NOT EXISTS idx_psj_status ON pending_submission_jobs(status);
CREATE INDEX IF NOT EXISTS idx_psj_company ON pending_submission_jobs(insurance_company);
CREATE INDEX IF NOT EXISTS idx_psj_agent ON pending_submission_jobs(assigned_agent_id);

CREATE TABLE IF NOT EXISTS pending_submission_logs (
  id BIGSERIAL PRIMARY KEY,
  pending_submission_job_id BIGINT NOT NULL REFERENCES pending_submission_jobs(id) ON DELETE CASCADE,
  outcome VARCHAR(50) NOT NULL,
  comment TEXT NOT NULL,
  logged_by VARCHAR(255) NOT NULL,
  resulting_status VARCHAR(10) NOT NULL CHECK (resulting_status IN ('GREEN','AMBER','RED')),
  scheduled_at TIMESTAMPTZ,
  scheduled_place TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_psl_job ON pending_submission_logs(pending_submission_job_id);

CREATE TABLE IF NOT EXISTS pending_submission_imports (
  id BIGSERIAL PRIMARY KEY,
  file_name TEXT,
  imported_by VARCHAR(255),
  row_count_total INTEGER NOT NULL DEFAULT 0,
  new_records_count INTEGER NOT NULL DEFAULT 0,
  skipped_open_count INTEGER NOT NULL DEFAULT 0,
  skipped_closed_count INTEGER NOT NULL DEFAULT 0,
  auto_closed_absent_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_submission_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  callback_team_tag VARCHAR(100) NOT NULL DEFAULT 'Callback Team(Submission)',
  max_attempts INTEGER NOT NULL DEFAULT 4,
  overdue_after_days INTEGER NOT NULL DEFAULT 3,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO pending_submission_settings (id, callback_team_tag, max_attempts, overdue_after_days)
VALUES (1, 'Callback Team(Submission)', 4, 3)
ON CONFLICT (id) DO NOTHING;

