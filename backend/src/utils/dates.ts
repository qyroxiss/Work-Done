/**
 * Date conventions:
 *  - DATE columns (StartDate, DueDate, JoiningDate) are plain calendar dates, exchanged as "YYYY-MM-DD".
 *    The driver runs with useUTC=true, so they are represented as UTC-midnight Date objects.
 *  - DATETIME2 audit columns are stored in UTC and returned as ISO strings.
 *  - "Today" and date-range filters on timestamps use the server's local time zone (the office).
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC-midnight Date (from a DATE column) -> "YYYY-MM-DD" */
export function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> UTC-midnight Date suitable for a sql.Date parameter */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`);
}

export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Today's local calendar date as "YYYY-MM-DD" */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Start of a local calendar day as an absolute instant (for comparing UTC timestamps). */
export function localDayStart(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

/** Start of the local day AFTER the given day (exclusive upper bound). */
export function localDayEndExclusive(day: string): Date {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d;
}

/** Minutes to add to a UTC timestamp to get server local time (used for grouping by local day in SQL). */
export function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** Inclusive list of "YYYY-MM-DD" days between two dates. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}
