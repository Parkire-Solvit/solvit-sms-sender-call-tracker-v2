import type { EmailAssignmentMethod } from './emailTypes';

export interface EmailTeamMember {
  memberId: number;
  email: string | null;
  available: boolean;
  roundRobinEnabled: boolean;
  monitored: boolean;
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
  previousRoundRobinMemberId?: number | null;
}

export interface AssignmentDecision {
  memberId: number | null;
  method: EmailAssignmentMethod | null;
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
    if (owner) return { memberId: owner.memberId, method: 'DIRECT' };
  }

  const sender = input.senderEmail.trim().toLowerCase();
  const recipients = input.recipientEmails.map((email) => email.trim().toLowerCase());
  for (const rule of [...rules].filter((item) => item.enabled).sort((a, b) => a.priority - b.priority)) {
    if (!byId.has(rule.memberId)) continue;
    const value = rule.value.trim().toLowerCase();
    if (!value) continue;
    const matched = rule.field === 'sender_email' ? sender === value : recipients.includes(value);
    if (matched) return { memberId: rule.memberId, method: 'RULE' };
  }

  const roundRobin = active.filter((member) => member.roundRobinEnabled).sort((a, b) => a.memberId - b.memberId);
  if (!roundRobin.length) return { memberId: null, method: null };
  const previousIndex = roundRobin.findIndex((member) => member.memberId === input.previousRoundRobinMemberId);
  const next = roundRobin[(previousIndex + 1) % roundRobin.length];
  return { memberId: next.memberId, method: 'ROUND_ROBIN' };
}
