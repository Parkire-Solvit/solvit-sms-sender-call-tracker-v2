import test from 'node:test';
import assert from 'node:assert/strict';
import { emailDeadlineLabel } from '../../shared/emailDeadlineLabel';

const calendar = { holidayDates: [] };
const at = (value: string) => new Date(value).getTime();

test('email received after 5 PM shows full response and resolution time overnight', () => {
  const mondayNight = at('2026-09-14T19:00:00Z'); // 10 PM Nairobi
  assert.equal(emailDeadlineLabel('2026-09-15T05:30:00Z', false, mondayNight, calendar), '30m left');
  assert.equal(emailDeadlineLabel('2026-09-15T07:00:00Z', false, mondayNight, calendar), '120m left');
  assert.equal(emailDeadlineLabel('2026-09-15T05:30:00Z', false, at('2026-09-15T04:00:00Z'), calendar), '30m left');
  assert.equal(emailDeadlineLabel('2026-09-15T05:30:00Z', false, at('2026-09-15T05:10:00Z'), calendar), '20m left');
});

test('remaining and overdue time freeze overnight and across weekends', () => {
  const fridayDue = '2026-09-18T14:10:00Z'; // 5:10 PM Nairobi is after close
  assert.equal(emailDeadlineLabel(fridayDue, false, at('2026-09-18T14:00:00Z'), calendar), 'Due now');
  const mondayDue = '2026-09-21T05:20:00Z';
  assert.equal(emailDeadlineLabel(mondayDue, false, at('2026-09-18T14:00:00Z'), calendar), '20m left');
  assert.equal(emailDeadlineLabel(mondayDue, false, at('2026-09-20T10:00:00Z'), calendar), '20m left');
  const pastDue = '2026-09-18T13:50:00Z'; // Friday 4:50 PM
  assert.equal(emailDeadlineLabel(pastDue, false, at('2026-09-18T14:00:00Z'), calendar), '10m overdue');
  assert.equal(emailDeadlineLabel(pastDue, false, at('2026-09-20T10:00:00Z'), calendar), '10m overdue');
});
