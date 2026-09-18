// Keep the authorization predicate in the same UPDATE as the resolution audit write.
export const resolveEmailThreadSql = `UPDATE email_threads SET resolved_at=now(),resolved_by=$3,resolution_note=$4,
  resolution_breached=(now()>resolution_due_at),status='RESOLVED',updated_at=now()
  WHERE id=$1 AND resolved_at IS NULL AND
    ($2::text IS NULL OR (status IN ('IN_PROGRESS','AWAITING_RESPONSE')
      AND (first_response_at IS NOT NULL OR NULLIF(trim($4::text),'') IS NOT NULL) AND EXISTS (
      SELECT 1 FROM email_team_members m WHERE m.id=email_threads.assigned_member_id AND m.email=$2
    )))`;
