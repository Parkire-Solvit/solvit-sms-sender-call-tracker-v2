import test from 'node:test';
import assert from 'node:assert/strict';
import { addEmailWorkingMinutes, emailWorkingMinutesBetween, isEmailWorkingTime,
  nextEmailWorkingStart, validEmailHolidayDate } from '../../shared/emailBusinessHours';

test('Nairobi email clock pauses at 5 PM and resumes at 8 AM', () => {
  const monday = new Date('2026-09-14T13:50:00Z');
  assert.equal(addEmailWorkingMinutes(monday, 30, []).toISOString(), '2026-09-15T05:20:00.000Z');
  assert.equal(addEmailWorkingMinutes(monday, 120, []).toISOString(), '2026-09-15T06:50:00.000Z');
  assert.equal(emailWorkingMinutesBetween(monday, new Date('2026-09-15T05:20:00Z'), []), 30);
  assert.equal(isEmailWorkingTime(new Date('2026-09-14T15:00:00Z'), []), false);
});

test('weekend mail starts Monday and a holiday pushes it to Tuesday', () => {
  const saturday = new Date('2026-09-19T08:00:00Z');
  assert.equal(addEmailWorkingMinutes(saturday, 30, []).toISOString(), '2026-09-21T05:30:00.000Z');
  assert.equal(addEmailWorkingMinutes(saturday, 30, ['2026-09-21']).toISOString(), '2026-09-22T05:30:00.000Z');
  assert.equal(nextEmailWorkingStart(saturday, ['2026-09-21']).toISOString(), '2026-09-22T05:00:00.000Z');
});

test('holiday dates must be real local calendar days', () => {
  assert.equal(validEmailHolidayDate('2026-02-29'), false);
  assert.equal(validEmailHolidayDate('2028-02-29'), true);
});
