import { emailWorkingMinutesBetween } from './emailBusinessHours';

export function emailCompletionOutcome(completedAt: string, dueAt: string, holidayDates: string[] = []): string {
  const completed = new Date(completedAt);
  const due = new Date(dueAt);
  if (!Number.isFinite(completed.getTime()) || !Number.isFinite(due.getTime())) return 'SLA unavailable';
  if (completed <= due) return 'Within SLA';
  const lateMinutes = emailWorkingMinutesBetween(due, completed, holidayDates);
  return lateMinutes > 0 ? `${Math.ceil(lateMinutes)} working min late` : 'After deadline';
}

export function emailCompletionTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}
