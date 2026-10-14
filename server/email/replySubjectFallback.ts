// Outlook may omit usable RFC reply headers or change conversation identity
// when a different CS mailbox answers a group copy. Subject fallback is used
// only after the stronger header and mailbox-conversation matches fail.
export function normalizedReplySubject(value: string | undefined): string {
  let subject = (value || '').trim();
  // Remove common reply/forward and external-mail prefixes repeatedly.
  for (let previous = ''; subject && subject !== previous;) {
    previous = subject;
    subject = subject.replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*|\[external\]\s*)/i, '').trim();
  }
  return subject.replace(/\s+/g, ' ').toLowerCase();
}

export function firstMatchingSubjectTicket<T extends { subject?: string }>(
  incomingSubject: string | undefined,
  ticketsInOriginalOrder: readonly T[],
): T | undefined {
  const subject = normalizedReplySubject(incomingSubject);
  if (!subject) return undefined;
  return ticketsInOriginalOrder.find((ticket) => normalizedReplySubject(ticket.subject) === subject);
}
