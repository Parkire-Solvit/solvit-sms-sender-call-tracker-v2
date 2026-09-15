import type { EmailAssignmentMethod } from './emailTypes';

export interface EmailTeamMember {
  memberId: number;
  email: string | null;
  available: boolean;
  roundRobinEnabled: boolean;
  monitored: boolean;
  routingNames?: string[];
}

export interface EmailAssignmentRule {
  priority: number;
  field: 'sender_email' | 'recipient_email';
  value: string;
  memberId: number;
  enabled: boolean;
}

export interface AssignmentInput {
  senderEmail: string;
  recipientEmails: string[];
  directOwnerEmail?: string | null;
  namedOwnerEmail?: string | null;
  defaultOwnerEmail?: string | null;
  previousRoundRobinMemberId?: number | null;
}

export interface AssignmentDecision {
  memberId: number | null;
  method: EmailAssignmentMethod | null;
  reason: string | null;
}

export function chooseEmailOwner(
  input: AssignmentInput,
  members: readonly EmailTeamMember[],
  rules: readonly EmailAssignmentRule[],
): AssignmentDecision {
  const active = members.filter((member) => member.available && member.monitored);
  const byId = new Map(active.map((member) => [member.memberId, member]));
  const direct = input.directOwnerEmail?.trim().toLowerCase();
  if (direct) {
    const owner = active.find((member) => member.email?.toLowerCase() === direct);
    if (owner) return { memberId: owner.memberId, method: 'DIRECT', reason: `Directly addressed to ${direct}` };
  }

  const named = input.namedOwnerEmail?.trim().toLowerCase();
  if (named) {
    const owner = active.find((member) => member.email?.toLowerCase() === named);
    if (owner) return { memberId: owner.memberId, method: 'NAME_MATCH', reason: `Named in email greeting (${named})` };
  }

  const sender = input.senderEmail.trim().toLowerCase();
  const recipients = input.recipientEmails.map((email) => email.trim().toLowerCase());
  for (const rule of [...rules].filter((item) => item.enabled).sort((a, b) => a.priority - b.priority)) {
    if (!byId.has(rule.memberId)) continue;
    const value = rule.value.trim().toLowerCase();
    if (!value) continue;
    const matched = rule.field === 'sender_email' ? sender === value : recipients.includes(value);
    if (matched) return { memberId: rule.memberId, method: 'RULE', reason: `Matched ${rule.field} rule` };
  }

  const fallback = input.defaultOwnerEmail?.trim().toLowerCase();
  if (fallback) {
    const owner = active.find((member) => member.email?.toLowerCase() === fallback);
    if (owner) return { memberId: owner.memberId, method: 'DEFAULT', reason: `Generic CS email assigned to default handler (${fallback})` };
  }

  const roundRobin = active.filter((member) => member.roundRobinEnabled).sort((a, b) => a.memberId - b.memberId);
  if (!roundRobin.length) return { memberId: null, method: null, reason: null };
  const previousIndex = roundRobin.findIndex((member) => member.memberId === input.previousRoundRobinMemberId);
  const next = roundRobin[(previousIndex + 1) % roundRobin.length];
  return { memberId: next.memberId, method: 'ROUND_ROBIN', reason: 'Assigned by CS round-robin fallback' };
}

export function findNamedOwner(preview: string | undefined, members: readonly EmailTeamMember[]): string | null {
  // A person's name only routes the message when it appears in the opening
  // salutation. Scanning the whole preview incorrectly treats signatures such
  // as "Regards, Mercy" as instructions to assign the email to Mercy.
  const openingLine = (preview || '')
    .slice(0, 300)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.toLowerCase();
  if (!openingLine || !/^(?:hi|hello|dear|hey|good\s+(?:morning|afternoon|evening))\b/i.test(openingLine)) return null;
  const matches = members.filter((member) => member.email && [...(member.routingNames || []), member.email].some((rawName) => {
    const name = rawName.trim().toLowerCase();
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z])${escaped}(?:[^a-z]|$)`, 'i').test(openingLine);
  }));
  return matches.length === 1 ? matches[0].email!.toLowerCase() : null;
}
