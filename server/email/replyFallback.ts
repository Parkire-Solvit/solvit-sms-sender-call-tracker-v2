export const replyConversationCandidatesSql = `WITH candidates AS (
  SELECT DISTINCT t.id,t.received_at FROM email_mailbox_copies c JOIN email_threads t ON t.id=c.email_thread_id
  WHERE c.source_mailbox=$1 AND c.graph_conversation_id=$2 AND t.received_at <= $3
    AND t.customer_email=ANY($4::text[]) AND t.root_internet_message_id <> $5
) SELECT id FROM candidates WHERE received_at=(SELECT max(received_at) FROM candidates) LIMIT 2`;
