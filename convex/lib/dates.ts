// Calendar dates are plain `yyyy-MM-dd` strings so every client agrees on them
// regardless of time zone.

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string) {
  if (!datePattern.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today's calendar date in an IANA time zone. */
export function todayIn(timeZone: string, now = Date.now()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export type Cadence = "weekly" | "monthly" | "yearly";

/**
 * The `index`-th occurrence of a schedule anchored on `start`. Months and years are
 * computed from the anchor so a rule on the 31st lands on the last day of short
 * months without drifting.
 */
export function occurrence(start: string, cadence: Cadence, interval: number, index: number) {
  const [y, m, d] = start.split("-").map(Number);
  if (cadence === "weekly") {
    const date = new Date(Date.UTC(y, m - 1, d + 7 * interval * index));
    return date.toISOString().slice(0, 10);
  }
  const months = (cadence === "monthly" ? 1 : 12) * interval * index;
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** First occurrence on or after `day`. */
export function occurrenceOnOrAfter(
  start: string,
  cadence: Cadence,
  interval: number,
  day: string,
) {
  for (let i = 0; ; i++) {
    const date = occurrence(start, cadence, interval, i);
    if (date >= day) return date;
  }
}

/** First occurrence strictly after `after`, or on/after `start` when `after` is null. */
export function nextOccurrence(
  start: string,
  cadence: Cadence,
  interval: number,
  after: string | null,
) {
  for (let i = 0; ; i++) {
    const date = occurrence(start, cadence, interval, i);
    if (after === null || date > after) return date;
  }
}
