import test from 'node:test';
import assert from 'node:assert/strict';
import { emailDurationLabel } from '../../shared/emailDurationLabel';
import { emailDeadlineLabel } from '../../shared/emailDeadlineLabel';

test('formats nine-hour working days, hours and minutes', () => {
  for (const [value, label] of [[0, '0m'], [30, '30m'], [60, '1h'], [90, '1h 30m'], [540, '1d'], [630, '1d 1h 30m'], [730, '1d 3h 10m'], [826, '1d 4h 46m'], [1080, '2d']] as const) {
    assert.equal(emailDurationLabel(value), label);
  }
  assert.equal(emailDeadlineLabel('2026-09-15T05:00:00Z', false, new Date('2026-09-16T06:30:00Z').getTime(), { holidayDates: [] }), '1d 1h 30m overdue');
});
