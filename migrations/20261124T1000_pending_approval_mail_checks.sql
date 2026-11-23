-- The result of the last email check for each sender mailbox (Pending Approval, Import & Settings). "Verified" in the
-- interface means a real test email was accepted by Microsoft for that mailbox, not just that credentials are present.
CREATE TABLE IF NOT EXISTS pending_approval_mail_checks (
  id BIGSERIAL PRIMARY KEY,
  mailbox VARCHAR(255) NOT NULL UNIQUE,
  ok BOOLEAN NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  checked_by VARCHAR(255) NOT NULL DEFAULT '',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
