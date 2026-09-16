export const replyConversationCandidatesSql = `
  SELECT DISTINCT t.id FROM email_mailbox_copies c JOIN email_threads t ON t.id=c.email_thread_id
  WHERE c.source_mailbox=$1 AND c.graph_conversation_id=$2 AND t.received_at <= $3
    AND t.customer_email=ANY($4::text[]) AND t.root_internet_message_id <> $5 LIMIT 2`;
