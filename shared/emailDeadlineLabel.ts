import { emailWorkingMinutesBetween } from './emailBusinessHours';
import { emailDurationLabel } from './emailDurationLabel';

export function emailDeadlineLabel(
  value: string, done: boolean, now: number, calendar: { holidayDates: string[] } | null,
): string {
  if (done) return 'Completed';
  if (!calendar) return 'Calendar pending';
  const due = new Date(value);
  const current = new Date(now);
  const holidays = calendar.holidayDates;
  if (due.getTime() <= now) {
    const overdue = Math.ceil(emailWorkingMinutesBetween(due, current, holidays));
    return overdue ? `${emailDurationLabel(overdue)} overdue` : 'Due now';
  }
  const minutes = Math.ceil(emailWorkingMinutesBetween(current, due, holidays));
  return minutes ? `${emailDurationLabel(minutes)} left` : 'Due now';
}
