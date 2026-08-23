import {
  addDays,
  addMonthsClamped,
  compareDates,
  formatDate,
  parseDate,
  weekdayOf,
  type PlainDate,
} from './dates.js';

/**
 * Phased recurrence (docs/architecture/scheduling.md): an ORDERED LIST of
 * RFC 5545-shaped segments, each with its own count/until; segments run in
 * sequence - "monthly for 6, then every 3 months" is two segments. The
 * semantics follow RFC 5545 for the subset supported; the implementation
 * is a small pure-date expander instead of rrule.js, deliberately: the
 * engine never touches instants, which is where recurrence libraries breed
 * DST bugs, and the same code runs in the builder preview and the worker.
 */

export interface ScheduleSegment {
  freq: 'daily' | 'weekly' | 'monthly';
  /** every N days/weeks/months; default 1 */
  interval?: number;
  /** how many occurrences this segment contributes */
  count?: number;
  /** inclusive local end date, alternative to count */
  until?: string;
  /** weekly only: ISO weekdays 1=Mon..7=Sun; defaults to the anchor's weekday */
  byWeekday?: number[];
}

export interface ScheduleDefinition {
  /** local anchor date, the first candidate occurrence */
  anchorDate: string;
  segments: ScheduleSegment[];
  /** extra dates (RDATE) */
  addDates?: string[];
  /** removed dates (EXDATE) */
  removeDates?: string[];
}

export interface ExpandOptions {
  /** inclusive window start (occurrences before it are dropped AFTER
   * counting - count semantics are absolute, not window-relative) */
  from?: string;
  /** inclusive window end - REQUIRED when any segment is open-ended */
  to?: string;
  /** safety valve against runaway definitions */
  max?: number;
}

const HARD_MAX = 1000;

export function expandSchedule(
  definition: ScheduleDefinition,
  options: ExpandOptions = {},
): string[] {
  const max = Math.min(options.max ?? HARD_MAX, HARD_MAX);
  const windowFrom = options.from !== undefined ? parseDate(options.from) : undefined;
  const windowTo = options.to !== undefined ? parseDate(options.to) : undefined;

  const openEnded = definition.segments.some(
    (segment) => segment.count === undefined && segment.until === undefined,
  );
  if (openEnded && windowTo === undefined) {
    throw new Error('open-ended schedule needs an expansion window (options.to)');
  }

  const out: PlainDate[] = [];
  let previousLast: PlainDate | undefined;

  for (const segment of definition.segments) {
    const interval = Math.max(1, segment.interval ?? 1);
    const until = segment.until !== undefined ? parseDate(segment.until) : undefined;

    // A segment starts at the anchor, or one of ITS OWN intervals after the
    // previous segment's last occurrence: "monthly x6, then every 3 months"
    // continues three months after the sixth, not one.
    const segmentStart: PlainDate =
      previousLast === undefined
        ? parseDate(definition.anchorDate)
        : segment.freq === 'daily'
          ? addDays(previousLast, interval)
          : segment.freq === 'weekly'
            ? addDays(previousLast, 7 * interval)
            : addMonthsClamped(previousLast, interval);

    let produced = 0;
    const hardStop = (candidate: PlainDate): boolean =>
      out.length >= max ||
      (segment.count === undefined &&
        until === undefined &&
        windowTo !== undefined &&
        compareDates(candidate, windowTo) > 0);

    if (segment.freq === 'weekly') {
      const weekdays = (
        segment.byWeekday && segment.byWeekday.length > 0
          ? [...segment.byWeekday]
          : [weekdayOf(segmentStart)]
      ).sort((a, b) => a - b);
      let weekStart = addDays(segmentStart, -(weekdayOf(segmentStart) - 1)); // Monday
      outer: for (;;) {
        for (const weekday of weekdays) {
          const candidate = addDays(weekStart, weekday - 1);
          if (compareDates(candidate, segmentStart) < 0) continue;
          if (until !== undefined && compareDates(candidate, until) > 0) break outer;
          if (segment.count !== undefined && produced >= segment.count) break outer;
          if (hardStop(candidate)) break outer;
          out.push(candidate);
          produced += 1;
        }
        if (segment.count !== undefined && produced >= segment.count) break;
        weekStart = addDays(weekStart, 7 * interval);
        if (until !== undefined && compareDates(weekStart, addDays(until, 7)) > 0) break;
        if (hardStop(weekStart)) break;
      }
    } else {
      // Index-based stepping anchored on segmentStart: month-end clamping
      // is per-occurrence relative to the ORIGINAL day (RFC 5545), so an
      // anchor on the 31st visits Sep 30 and then Oct 31, never Oct 30.
      for (let index = 0; ; index++) {
        if (segment.count !== undefined && produced >= segment.count) break;
        const candidate =
          segment.freq === 'daily'
            ? addDays(segmentStart, index * interval)
            : addMonthsClamped(segmentStart, index * interval);
        if (until !== undefined && compareDates(candidate, until) > 0) break;
        if (hardStop(candidate)) break;
        out.push(candidate);
        produced += 1;
      }
    }

    previousLast = out[out.length - 1] ?? previousLast;
    if (out.length >= max) break;
  }

  const removed = new Set(definition.removeDates ?? []);
  const withExtras = [
    ...out.map(formatDate).filter((iso) => !removed.has(iso)),
    ...(definition.addDates ?? []).filter((iso) => !removed.has(iso)),
  ];
  const unique = [...new Set(withExtras)].sort();

  return unique.filter((iso) => {
    const date = parseDate(iso);
    if (windowFrom !== undefined && compareDates(date, windowFrom) < 0) return false;
    if (windowTo !== undefined && compareDates(date, windowTo) > 0) return false;
    return true;
  });
}

/** The next occurrence on/after a date - the preview's "Next: ..." line. */
export function nextOccurrence(
  definition: ScheduleDefinition,
  onOrAfter: string,
  horizonTo: string,
): string | undefined {
  return expandSchedule(definition, { from: onOrAfter, to: horizonTo })[0];
}
