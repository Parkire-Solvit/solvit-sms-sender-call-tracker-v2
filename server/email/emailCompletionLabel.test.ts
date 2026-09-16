import test from 'node:test';
import assert from 'node:assert/strict';
import { emailCompletionOutcome, emailCompletionTime } from '../../shared/emailCompletionLabel';

test('completed emails retain completion timestamp and late outcome', () => {
  assert.equal(emailCompletionOutcome('2026-09-16T07:57:00Z', '2026-09-16T05:30:00Z'), '2h 27m late');
  assert.match(emailCompletionTime('2026-09-16T07:57:00Z'), /10:57:00/);
  assert.equal(emailCompletionOutcome('2026-09-16T05:30:00Z', '2026-09-16T05:30:00Z'), 'Within SLA');
});

test('completed lateness excludes nights and weekends', () => {
  assert.equal(emailCompletionOutcome('2026-09-21T05:15:00Z', '2026-09-18T13:45:00Z'), '30m late');
  assert.equal(emailCompletionOutcome('2026-09-16T05:15:00Z', '2026-09-15T13:45:00Z', ['2026-09-16']), '15m late');
});
