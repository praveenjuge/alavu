// Calendar days are `yyyy-MM-dd` strings in the person's local time, exactly as the iOS
// app and the server store them. Date math runs in UTC on those strings so a time zone
// change can never shift a day.

export type Day = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function dayFromDate(date: Date): Day {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today(): Day {
  return dayFromDate(new Date());
}

function parts(day: Day) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

function fromUTC(ms: number): Day {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(day: Day, n: number): Day {
  const { y, m, d } = parts(day);
  return fromUTC(Date.UTC(y, m - 1, d + n));
}

function addMonths(day: Day, n: number): Day {
  const { y, m, d } = parts(day);
  return fromUTC(Date.UTC(y, m - 1 + n, d));
}

/** A budget month. With start day 25 it runs from the 25th to the 24th, following payday. */
export interface Period {
  start: Day;
  /** Exclusive. */
  end: Day;
  startDay: number;
}

export function periodContaining(day: Day, startDay: number): Period {
  const clamped = Math.min(Math.max(startDay, 1), 28);
  const { y, m, d } = parts(day);
  const start = fromUTC(Date.UTC(y, m - 1 - (d < clamped ? 1 : 0), clamped));
  return { start, end: addMonths(start, 1), startDay: clamped };
}

export const nextPeriod = (p: Period) => periodContaining(p.end, p.startDay);
export const previousPeriod = (p: Period) => periodContaining(addDays(p.start, -1), p.startDay);
export const lastDay = (p: Period) => addDays(p.end, -1);
export const contains = (p: Period, day: Day) => day >= p.start && day < p.end;

export function periodDays(p: Period): Day[] {
  const days: Day[] = [];
  for (let day = p.start; day < p.end; day = addDays(day, 1)) days.push(day);
  return days;
}

function toDate(day: Day) {
  const { y, m, d } = parts(day);
  return new Date(y, m - 1, d);
}

/** "November 2026" for calendar months, "25 Oct – 24 Nov" otherwise. */
export function periodTitle(p: Period, locale?: string): string {
  if (p.startDay === 1) {
    return toDate(p.start).toLocaleDateString(locale, { month: "long", year: "numeric" });
  }
  const short = (day: Day) =>
    toDate(day).toLocaleDateString(locale, { day: "numeric", month: "short" });
  return `${short(p.start)} – ${short(lastDay(p))}`;
}

/** "Today", "Yesterday", or a date like "Sat, 31 Oct". */
export function dayTitle(day: Day, locale?: string): string {
  const now = today();
  if (day === now) return "Today";
  if (day === addDays(now, -1)) return "Yesterday";
  const sameYear = day.slice(0, 4) === now.slice(0, 4);
  return toDate(day).toLocaleDateString(
    locale,
    sameYear
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
  );
}

export function longDate(day: Day, locale?: string): string {
  return toDate(day).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
