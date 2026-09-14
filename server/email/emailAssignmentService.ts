import type { EmailAssignmentMethod } from './emailTypes';

export interface EmailTeamMember {
  agentId: number;
  email: string | null;
  available: boolean;
  roundRobinEnabled: boolean;
  archived: boolean;
}

export interface EmailAssignmentRule {
  priority: number;
  field: 'sender_email' | 'recipient_email';
  value: string;
  agentId: number;
  enabled: boolean;
}

export interface AssignmentInput {
  senderEmail: string;
  recipientEmails: string[];
  directOwnerEmail?: string | null;
  previousRoundRobinAgentId?: number | null;
}

export interface AssignmentDecision {
  agentId: number | null;
  method: EmailAssignmentMethod | null;
}

export function chooseEmailOwner(
  input: AssignmentInput,
  members: readonly EmailTeamMember[],
  rules: readonly EmailAssignmentRule[],
): AssignmentDecision {
  const active = members.filter((member) => member.available && !member.archived);
  const byId = new Map(active.map((member) => [member.agentId, member]));
  const direct = input.directOwnerEmail?.trim().toLowerCase();
  if (direct) {
    const owner = active.find((member) => member.email?.toLowerCase() === direct);
    if (owner) return { agentId: owner.agentId, method: 'DIRECT' };
  }

  const sender = input.senderEmail.trim().toLowerCase();
  const recipients = input.recipientEmails.map((email) => email.trim().toLowerCase());
  for (const rule of [...rules].filter((item) => item.enabled).sort((a, b) => a.priority - b.priority)) {
    if (!byId.has(rule.agentId)) continue;
    const value = rule.value.trim().toLowerCase();
    if (!value) continue;
    const matched = rule.field === 'sender_email' ? sender === value : recipients.includes(value);
    if (matched) return { agentId: rule.agentId, method: 'RULE' };
  }

  const roundRobin = active.filter((member) => member.roundRobinEnabled).sort((a, b) => a.agentId - b.agentId);
  if (!roundRobin.length) return { agentId: null, method: null };
  const previousIndex = roundRobin.findIndex((member) => member.agentId === input.previousRoundRobinAgentId);
  const next = roundRobin[(previousIndex + 1) % roundRobin.length];
  return { agentId: next.agentId, method: 'ROUND_ROBIN' };
}
