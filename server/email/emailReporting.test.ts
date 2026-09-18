import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEmailReport, emailReportPeriod, type ReportEmail } from './emailReporting';
const at = (value: string) => new Date(value);
const email = (changes: Partial<ReportEmail> = {}): ReportEmail => ({
  id: 1, receivedAt: at('2026-09-16T05:00:00Z'), firstResponseAt: null, resolvedAt: null,
  responseDueAt: at('2026-09-16T05:30:00Z'), resolutionDueAt: at('2026-09-16T07:00:00Z'), holidayDates: [], ...changes,
});

test('manual closure without a detected reply is not a successful response or an open overdue stage', () => {
  const report=calculateEmailReport([email({resolvedAt:at('2026-09-16T06:00Z')})],emailReportPeriod('weekly','2026-09-16'),at('2026-09-16T08:00Z'));
  assert.equal(report.response.closedWithoutCompletion,1);
  assert.equal(report.response.overdueOpen,0);
  assert.equal(report.response.met,0);
  assert.equal(report.response.compliancePercent,0);
});

test('weekly monthly and inclusive custom dates use Nairobi boundaries', () => {
  const week = emailReportPeriod('weekly', '2026-09-16');
  assert.equal(week.start.toISOString(), '2026-09-13T21:00:00.000Z');
  assert.equal(week.endExclusive.toISOString(), '2026-09-20T21:00:00.000Z');
  assert.equal(emailReportPeriod('monthly', '2026-12-16').endExclusive.toISOString(), '2026-12-31T21:00:00.000Z');
  assert.equal(emailReportPeriod('custom', '2026-09-16', '2026-09-16').endExclusive.toISOString(), '2026-09-16T21:00:00.000Z');
  assert.throws(() => emailReportPeriod('custom', '2026-02-30', '2026-03-01'));
  assert.throws(() => emailReportPeriod('custom', '2026-09-16', '2026-09-15'));
});

test('late completions and overdue unanswered emails are misses; pending is separate', () => {
  const result = calculateEmailReport([
    email({ firstResponseAt: at('2026-09-16T05:30:00Z') }),
    email({ id: 2, firstResponseAt: at('2026-09-16T06:00:00Z') }),
    email({ id: 3 }), email({ id: 4, responseDueAt: at('2026-09-16T09:00:00Z') }),
  ], emailReportPeriod('weekly', '2026-09-16'), at('2026-09-16T08:00:00Z'));
  assert.equal(result.response.met, 1);
  assert.equal(result.response.completedLate, 1);
  assert.equal(result.response.overdueOpen, 1);
  assert.equal(result.response.pendingWithinDeadline, 1);
  assert.equal(result.response.compliancePercent, 100 / 3);
  assert.equal(result.response.medianWorkingMinutes, 45);
});

test('past reports ignore completions after period end and keep older backlog separate', () => {
  const period = emailReportPeriod('custom', '2026-09-16', '2026-09-16');
  const result = calculateEmailReport([
    email({ firstResponseAt: at('2026-09-17T05:00:00Z') }),
    email({ id: 2, receivedAt: at('2026-09-15T05:00:00Z') }),
    email({ id: 3, receivedAt: period.endExclusive }),
  ], period, at('2026-09-18T10:00:00Z'));
  assert.equal(result.received, 1);
  assert.equal(result.response.overdueOpen, 1);
  assert.equal(result.openingBacklog, 1);
  assert.equal(result.olderBacklogStillOpen, 1);
});

test('response duration skips nights and weekends and empty compliance is N/A', () => {
  const result = calculateEmailReport([email({ receivedAt: at('2026-09-18T13:45:00Z'),
    firstResponseAt: at('2026-09-21T05:15:00Z') })], emailReportPeriod('custom', '2026-09-18', '2026-09-21'), at('2026-09-22T05:00:00Z'));
  assert.equal(result.response.medianWorkingMinutes, 30);
  assert.equal(calculateEmailReport([], emailReportPeriod('weekly', '2026-09-16'), at('2026-09-17T05:00:00Z')).response.compliancePercent, null);
});
