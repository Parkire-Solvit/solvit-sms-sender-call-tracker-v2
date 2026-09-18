// Lock and authorize against the same current owner before making any assignment write.
export const lockAssignableEmailSql = `SELECT assigned_member_id,status FROM email_threads
  WHERE id=$1 AND resolved_at IS NULL AND sla_exclusion_reason IS NULL
  AND ($2::text IS NULL OR assigned_member_id=(SELECT id FROM email_team_members WHERE email=$2)) FOR UPDATE`;
