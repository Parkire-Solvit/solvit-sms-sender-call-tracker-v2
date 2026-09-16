import { emailWorkingMinutesBetween } from '../../shared/emailBusinessHours';

export interface ReportPeriod { start: Date; endExclusive: Date }
export interface ReportEmail {
  id: number;
  receivedAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  responseDueAt: Date;
  resolutionDueAt: Date;
  holidayDates: readonly string[];
}

function calendarDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid report date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid report date');
  return date;
}

// Input dates are Nairobi calendar dates. End dates selected by users are inclusive.
export function emailReportPeriod(kind: 'weekly' | 'monthly' | 'custom', anchor: string, through?: string): ReportPeriod {
  const first = calendarDay(anchor);
  let last: Date;
  if (kind === 'weekly') {
    first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
    last = new Date(first.getTime() + 7 * 86400_000);
  } else if (kind === 'monthly') {
    first.setUTCDate(1);
    last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  } else {
    if (!through) throw new Error('Custom report requires an end date');
    last = calendarDay(through);
    if (last < first) throw new Error('Report end precedes start');
    last.setUTCDate(last.getUTCDate() + 1);
  }
  return { start: new Date(first.getTime() - 3 * 3600_000), endExclusive: new Date(last.getTime() - 3 * 3600_000) };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

export function calculateEmailReport(emails: readonly ReportEmail[], period: ReportPeriod, now = new Date()) {
  if (!Number.isFinite(period.start.getTime()) || !Number.isFinite(period.endExclusive.getTime()) ||
      !Number.isFinite(now.getTime()) || period.endExclusive <= period.start || now < period.start) {
    throw new Error('Invalid report period or observation time');
  }
  const cutoff = new Date(Math.min(now.getTime(), period.endExclusive.getTime()));
  const completed = (at: Date | null) => Boolean(at && at < cutoff);
  const cohort = emails.filter((email) => email.receivedAt >= period.start && email.receivedAt < cutoff);
  const earlier = emails.filter((email) => email.receivedAt < period.start);
  const metric = (stage: 'response' | 'resolution') => {
    let met = 0, late = 0, overdue = 0, pending = 0;
    const durations: number[] = [];
    for (const email of cohort) {
      const at = stage === 'response' ? email.firstResponseAt : email.resolvedAt;
      const due = stage === 'response' ? email.responseDueAt : email.resolutionDueAt;
      if (completed(at)) {
        if (at! <= due) met++; else late++;
        durations.push(emailWorkingMinutesBetween(email.receivedAt, at!, email.holidayDates));
      } else if (due < cutoff) overdue++; else pending++;
    }
    const assessed = met + late + overdue;
    return { met, completedLate: late, overdueOpen: overdue, pendingWithinDeadline: pending,
      assessed, compliancePercent: assessed ? 100 * met / assessed : null,
      medianWorkingMinutes: median(durations) };
  };
  return {
    asOf: cutoff.toISOString(), received: cohort.length,
    response: metric('response'), resolution: metric('resolution'),
    openingBacklog: earlier.filter((email) => !email.resolvedAt || email.resolvedAt >= period.start).length,
    olderBacklogStillOpen: earlier.filter((email) => !completed(email.resolvedAt)).length,
    awaitingResponse: cohort.filter((email) => !completed(email.firstResponseAt) && !completed(email.resolvedAt)).length,
    inProgress: cohort.filter((email) => completed(email.firstResponseAt) && !completed(email.resolvedAt)).length,
  };
}
