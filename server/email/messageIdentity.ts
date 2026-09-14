import type { GraphMessage } from './graphClient';

function normalizeMessageId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/<[^<>\s]+>/);
  return (match?.[0] || (trimmed && !/\s/.test(trimmed) ? trimmed : null))?.toLowerCase() || null;
}

function header(message: GraphMessage, name: string): string | undefined {
  return message.internetMessageHeaders?.find((item) => item.name.toLowerCase() === name)?.value;
}

export function emailIdentity(message: GraphMessage): {
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
} {
  const references = (header(message, 'references') || '').match(/<[^<>\s]+>/g) || [];
  return {
    internetMessageId: normalizeMessageId(message.internetMessageId),
    inReplyTo: normalizeMessageId(header(message, 'in-reply-to')),
    references: [...new Set(references.map((value) => value.toLowerCase()))],
  };
}

export function isAddressedToGroup(message: GraphMessage, groupAddress: string): boolean {
  const target = groupAddress.trim().toLowerCase();
  return [...(message.toRecipients || []), ...(message.ccRecipients || [])]
    .some((recipient) => recipient.emailAddress?.address?.trim().toLowerCase() === target);
}

// Conversation IDs are not assumed to be stable across personal mailboxes.
// Prefer RFC message headers when linking an agent reply to an inbound email.
export function replyMatchesKnownMessage(
  reply: GraphMessage,
  knownInternetMessageIds: ReadonlySet<string>,
): boolean {
  const identity = emailIdentity(reply);
  return Boolean((identity.inReplyTo && knownInternetMessageIds.has(identity.inReplyTo)) ||
    identity.references.some((id) => knownInternetMessageIds.has(id)));
}
