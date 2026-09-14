import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEmailOwner, type EmailTeamMember } from './emailAssignmentService';

const members: EmailTeamMember[] = [
  { agentId: 1, email: 'a@example.com', available: true, roundRobinEnabled: true, archived: false },
  { agentId: 2, email: 'b@example.com', available: true, roundRobinEnabled: true, archived: false },
  { agentId: 3, email: 'c@example.com', available: false, roundRobinEnabled: true, archived: false },
];
const input = { senderEmail: 'customer@example.com', recipientEmails: ['cs@example.com'] };

test('round robin rotates among available agents only', () => {
  assert.deepEqual(chooseEmailOwner(input, members, []), { agentId: 1, method: 'ROUND_ROBIN' });
  assert.deepEqual(chooseEmailOwner({ ...input, previousRoundRobinAgentId: 1 }, members, []), { agentId: 2, method: 'ROUND_ROBIN' });
  assert.deepEqual(chooseEmailOwner({ ...input, previousRoundRobinAgentId: 2 }, members, []), { agentId: 1, method: 'ROUND_ROBIN' });
});

test('direct owner takes priority over rules and round robin', () => {
  const decision = chooseEmailOwner({ ...input, directOwnerEmail: 'b@example.com' }, members, [
    { priority: 1, field: 'sender_email', value: input.senderEmail, agentId: 1, enabled: true },
  ]);
  assert.deepEqual(decision, { agentId: 2, method: 'DIRECT' });
});

test('rule takes priority over round robin', () => {
  const decision = chooseEmailOwner(input, members, [
    { priority: 1, field: 'sender_email', value: input.senderEmail, agentId: 2, enabled: true },
  ]);
  assert.deepEqual(decision, { agentId: 2, method: 'RULE' });
});

test('archived and unavailable agents are skipped, otherwise unassigned', () => {
  const inactive = members.map((member) => ({ ...member, archived: true }));
  assert.deepEqual(chooseEmailOwner(input, inactive, []), { agentId: null, method: null });
});
