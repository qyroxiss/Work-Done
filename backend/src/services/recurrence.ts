/**
 * Date arithmetic for repeating work. All dates are calendar dates ("YYYY-MM-DD"), computed in UTC
 * so daylight-saving changes never shift a day. Pure functions: covered by tests/unit.
 */

export const FREQUENCIES = ['Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const MONTHS_PER: Record<Exclude<Frequency, 'Weekly'>, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

function parse(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addDays(day: string, days: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/**
 * The due date after `due`. Month-based frequencies land on `anchorDay`, or the last day of a shorter
 * month (31 Jan -> 28 Feb -> 31 Mar), so the schedule never drifts.
 */
export function nextOccurrence(due: string, frequency: Frequency, anchorDay: number): string {
  if (frequency === 'Weekly') return addDays(due, 7);
  const d = parse(due);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + MONTHS_PER[frequency];
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return format(new Date(Date.UTC(year, month, day)));
}

/** Day of month (1-31) to keep for month-based schedules; for weekly ones the weekday is implied by the date. */
export function anchorDayOf(due: string): number {
  return parse(due).getUTCDate();
}

/** The date an occurrence is created and starts: `leadDays` before it is due. */
export function createOn(due: string, leadDays: number): string {
  return addDays(due, -leadDays);
}

/**
 * Due dates that should exist by `today`, starting at `nextDue`. Capped so a server that was off for
 * a long time catches up without flooding the work list.
 */
export function dueOccurrences(
  nextDue: string,
  frequency: Frequency,
  anchorDay: number,
  leadDays: number,
  today: string,
  endDate: string | null,
  max = 12,
): { due: string[]; nextDue: string } {
  const due: string[] = [];
  let cursor = nextDue;
  while (due.length < max && createOn(cursor, leadDays) <= today && (!endDate || cursor <= endDate)) {
    due.push(cursor);
    cursor = nextOccurrence(cursor, frequency, anchorDay);
  }
  return { due, nextDue: cursor };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/**
 * Fills title placeholders for one occurrence:
 *   {month}     month of the due date, e.g. "Oct 2026"
 *   {prevMonth} the month before it, e.g. "Sep 2026" (the period a return due in October covers)
 *   {date}      the due date, e.g. "20 Oct 2026"
 */
export function fillTitle(template: string, due: string): string {
  const d = parse(due);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const prev = m === 0 ? monthLabel(y - 1, 11) : monthLabel(y, m - 1);
  return template
    .replace(/\{month\}/gi, monthLabel(y, m))
    .replace(/\{prevMonth\}/gi, prev)
    .replace(/\{date\}/gi, `${d.getUTCDate()} ${MONTH_NAMES[m]} ${y}`);
}
