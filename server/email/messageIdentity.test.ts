import test from 'node:test';
import assert from 'node:assert/strict';
import { emailIdentity, isAddressedToGroup, isFromMonitoredMailbox, replyMatchesKnownMessage } from './messageIdentity';

test('recognizes CS group in To or Cc without reading the body', () => {
  assert.equal(isAddressedToGroup({ id: '1', ccRecipients: [{ emailAddress: { address: 'CS-Team@Solvit.co.ke' } }] }, 'cs-team@solvit.co.ke'), true);
  assert.equal(isAddressedToGroup({ id: '2', toRecipients: [{ emailAddress: { address: 'other@example.com' } }] }, 'cs-team@solvit.co.ke'), false);
});

test('links a personal-mailbox reply using RFC headers, not mailbox conversation ID', () => {
  const reply = { id: 'reply', conversationId: 'different-across-mailboxes', internetMessageHeaders: [
    { name: 'In-Reply-To', value: '<Customer.One@Example.com>' },
    { name: 'References', value: '<older@example.com> <Customer.One@Example.com>' },
  ] };
  assert.deepEqual(emailIdentity(reply).references, ['<older@example.com>', '<customer.one@example.com>']);
  assert.equal(replyMatchesKnownMessage(reply, new Set(['<customer.one@example.com>'])), true);
  assert.equal(replyMatchesKnownMessage(reply, new Set(['<unrelated@example.com>'])), false);
});

test('normalizes duplicate message identities copied into multiple subscribers', () => {
  assert.equal(emailIdentity({ id: 'copy-a', internetMessageId: '<SAME@example.com>' }).internetMessageId,
    emailIdentity({ id: 'copy-b', internetMessageId: '<same@example.com>' }).internetMessageId);
});

test('identifies CS mail copied back into another monitored inbox', () => {
  const mailboxes=['irene@solvit.co.ke','carol@solvit.co.ke'];
  assert.equal(isFromMonitoredMailbox({id:'1',from:{emailAddress:{address:'IRENE@solvit.co.ke'}}},mailboxes),true);
  assert.equal(isFromMonitoredMailbox({id:'2',from:{emailAddress:{address:'client@example.com'}}},mailboxes),false);
});
