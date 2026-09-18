// An email's copy must belong to the current assigned mailbox and match the exact RFC root.
export const emailOutlookCopySql = `SELECT m.email,c.graph_message_id
  FROM email_threads t JOIN email_team_members m ON m.id=t.assigned_member_id
  LEFT JOIN LATERAL (SELECT graph_message_id FROM email_mailbox_copies
    WHERE email_thread_id=t.id AND source_mailbox=m.email AND internet_message_id=t.root_internet_message_id
    ORDER BY graph_message_id LIMIT 1) c ON true
  WHERE t.id=$1 AND ($2::text IS NULL OR m.email=$2)`;
