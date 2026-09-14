import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEmailOwner, type EmailTeamMember } from './emailAssignmentService';

const members: EmailTeamMember[] = [
  { memberId: 1, email: 'a@example.com', available: true, roundRobinEnabled: true, monitored: true },
  { memberId: 2, email: 'b@example.com', available: true, roundRobinEnabled: true, monitored: true },
  { memberId: 3, email: 'c@example.com', available: false, roundRobinEnabled: true, monitored: true },
];
const input = { senderEmail: 'customer@example.com', recipientEmails: ['cs@example.com'] };

test('round robin rotates among available agents only', () => {
  assert.deepEqual(chooseEmailOwner(input, members, []), { memberId: 1, method: 'ROUND_ROBIN' });
  assert.deepEqual(chooseEmailOwner({ ...input, previousRoundRobinMemberId: 1 }, members, []), { memberId: 2, method: 'ROUND_ROBIN' });
  assert.deepEqual(chooseEmailOwner({ ...input, previousRoundRobinMemberId: 2 }, members, []), { memberId: 1, method: 'ROUND_ROBIN' });
});

test('direct owner takes priority over rules and round robin', () => {
  const decision = chooseEmailOwner({ ...input, directOwnerEmail: 'b@example.com' }, members, [
    { priority: 1, field: 'sender_email', value: input.senderEmail, memberId: 1, enabled: true },
  ]);
  assert.deepEqual(decision, { memberId: 2, method: 'DIRECT' });
});

test('rule takes priority over round robin', () => {
  const decision = chooseEmailOwner(input, members, [
    { priority: 1, field: 'sender_email', value: input.senderEmail, memberId: 2, enabled: true },
  ]);
  assert.deepEqual(decision, { memberId: 2, method: 'RULE' });
});

test('unmonitored and unavailable members are skipped, otherwise unassigned', () => {
  const inactive = members.map((member) => ({ ...member, monitored: false }));
  assert.deepEqual(chooseEmailOwner(input, inactive, []), { memberId: null, method: null });
});
