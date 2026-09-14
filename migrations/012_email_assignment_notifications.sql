-- In-app assignment notices are scoped to the assigned CS member.
CREATE TABLE IF NOT EXISTS email_assignment_notifications (
  id BIGSERIAL PRIMARY KEY,
  email_thread_id BIGINT NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  member_id BIGINT NOT NULL REFERENCES email_team_members(id) ON DELETE RESTRICT,
  assignment_history_id BIGINT NOT NULL UNIQUE REFERENCES email_assignment_history(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_assignment_notifications_member_unseen
  ON email_assignment_notifications(member_id, created_at DESC) WHERE seen_at IS NULL;
