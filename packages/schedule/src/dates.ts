/**
 * Date-level plumbing. The engine works on PLAIN LOCAL DATES ("2026-09-15")
 * expanded in the patient's IANA timezone - never on instants - because
 * survey due dates and recurrence semantics are dates, not instants
 * (docs/architecture/scheduling.md). Instants only appear at the edge,
 * when a timed occurrence is converted for storage.
 */

export interface PlainDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function parseDate(iso: string): PlainDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Not a date: ${iso}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDate(date: PlainDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

/** Days since epoch for a civil date (Howard Hinnant's algorithm). */
export function toEpochDays(date: PlainDate): number {
  const y = date.year - (date.month <= 2 ? 1 : 0);
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDays(days: number): PlainDate {
  const z = days + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromEpochDays(toEpochDays(date) + days);
}

/** Month arithmetic with end-of-month clamping (RFC 5545 semantics for the
 * subset we support: the 31st in a 30-day month clamps to the 30th). */
export function addMonthsClamped(date: PlainDate, months: number): PlainDate {
  const zeroBased = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  const lastDay = daysInMonth(year, month);
  return { year, month, day: Math.min(date.day, lastDay) };
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** ISO weekday 1=Mon..7=Sun. */
export function weekdayOf(date: PlainDate): number {
  const wd = (toEpochDays(date) + 4) % 7; // 1970-01-01 was a Thursday
  return wd === 0 ? 7 : wd < 0 ? wd + 7 : wd;
}

export function compareDates(a: PlainDate, b: PlainDate): number {
  return toEpochDays(a) - toEpochDays(b);
}

/**
 * Convert a local wall-clock time in an IANA timezone to a UTC instant.
 * Two-pass offset fix via Intl - no dependency, DST-correct (tested across
 * the Helsinki spring/autumn transitions).
 */
export function zonedTimeToUtc(
  date: PlainDate,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const offset1 = tzOffsetMs(new Date(guess), timeZone);
  const better = guess - offset1;
  const offset2 = tzOffsetMs(new Date(better), timeZone);
  return new Date(guess - offset2);
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    era: 'short',
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = get('hour') % 24; // Intl reports midnight as 24 in some engines
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asUtc - at.getTime();
}
