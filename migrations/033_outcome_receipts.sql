-- Save receipts: a retried outcome save that already reached the server is recognised and not saved twice.
CREATE TABLE IF NOT EXISTS outcome_receipts (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL UNIQUE,
  section VARCHAR(30) NOT NULL,
  job_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

