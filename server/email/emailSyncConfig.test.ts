import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedCsMailboxes, validateMonitoredMailboxes } from './emailSyncService';

test('email synchronization requires the complete approved seven-mailbox roster', () => {
  assert.doesNotThrow(() => validateMonitoredMailboxes([...approvedCsMailboxes].reverse()));
  assert.throws(() => validateMonitoredMailboxes(approvedCsMailboxes.slice(1)), /exactly the 7 approved/);
  assert.throws(() => validateMonitoredMailboxes([...approvedCsMailboxes,'jmining@solvit.co.ke']), /exactly the 7 approved/);
  assert.throws(() => validateMonitoredMailboxes([...approvedCsMailboxes,approvedCsMailboxes[0]]), /exactly the 7 approved/);
});
