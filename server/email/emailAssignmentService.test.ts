import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEmailOwner, findNamedOwner, type EmailTeamMember } from './emailAssignmentService';

const members: EmailTeamMember[] = [
  { memberId: 1, email: 'a@example.com', available: true, roundRobinEnabled: true, monitored: true },
  { memberId: 2, email: 'b@example.com', available: true, roundRobinEnabled: true, monitored: true },
  { memberId: 3, email: 'c@example.com', available: false, roundRobinEnabled: true, monitored: true },
];
const input = { senderEmail: 'customer@example.com', recipientEmails: ['cs@example.com'] };

test('round robin rotates among available agents only', () => {
  assert.equal(chooseEmailOwner(input, members, []).memberId, 1);
  assert.equal(chooseEmailOwner({ ...input, previousRoundRobinMemberId: 1 }, members, []).memberId, 2);
  assert.equal(chooseEmailOwner({ ...input, previousRoundRobinMemberId: 2 }, members, []).memberId, 1);
});

test('direct owner takes priority over rules and round robin', () => {
  const decision = chooseEmailOwner({ ...input, directOwnerEmail: 'b@example.com' }, members, [
    { priority: 1, field: 'sender_email', value: input.senderEmail, memberId: 1, enabled: true },
  ]);
  assert.equal(decision.memberId, 2);
  assert.equal(decision.method, 'DIRECT');
});

test('rule takes priority over round robin', () => {
  const decision = chooseEmailOwner(input, members, [
    { priority: 1, field: 'sender_email', value: input.senderEmail, memberId: 2, enabled: true },
  ]);
  assert.equal(decision.memberId, 2);
  assert.equal(decision.method, 'RULE');
});

test('unmonitored and unavailable members are skipped, otherwise unassigned', () => {
  const inactive = members.map((member) => ({ ...member, monitored: false }));
  assert.equal(chooseEmailOwner(input, inactive, []).memberId, null);
});

test('named greeting is used before the default CS handler', () => {
  const namedMembers = members.map((member) => ({ ...member, routingNames: member.memberId === 2 ? ['Irene'] : [] }));
  const named = findNamedOwner('Hi Irene, kindly assist with this request.', namedMembers);
  const decision = chooseEmailOwner({ ...input, namedOwnerEmail: named, defaultOwnerEmail: 'a@example.com' }, namedMembers, []);
  assert.equal(decision.memberId, 2);
  assert.equal(decision.method, 'NAME_MATCH');
});

test('generic CS mail goes to the configured default handler', () => {
  const decision = chooseEmailOwner({ ...input, defaultOwnerEmail: 'b@example.com' }, members, []);
  assert.equal(decision.memberId, 2);
  assert.equal(decision.method, 'DEFAULT');
});
