import { describe, expect, it } from 'vitest';
import { expandSchedule, nextOccurrence, zonedTimeToUtc, parseDate } from '../src/index.js';

describe('the brief example', () => {
  it('monthly x6, then every 3 months - two segments, exact dates', () => {
    const dates = expandSchedule({
      anchorDate: '2026-09-15',
      segments: [
        { freq: 'monthly', count: 6 },
        { freq: 'monthly', interval: 3, count: 4 },
      ],
    });
    expect(dates).toEqual([
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
      '2027-02-15',
      '2027-05-15',
      '2027-08-15',
      '2027-11-15',
      '2028-02-15',
    ]);
  });

  it('open-ended tail is horizon-bounded and refuses to run without one', () => {
    const definition = {
      anchorDate: '2026-09-15',
      segments: [
        { freq: 'monthly', count: 2 },
        { freq: 'monthly', interval: 3 },
      ],
    } as const;
    expect(() => expandSchedule({ ...definition, segments: [...definition.segments] })).toThrow(
      /window/,
    );
    const bounded = expandSchedule(
      { ...definition, segments: [...definition.segments] },
      { to: '2027-06-30' },
    );
    expect(bounded).toEqual(['2026-09-15', '2026-10-15', '2027-01-15', '2027-04-15']);
  });
});

describe('weekly', () => {
  it('weekly on Fridays from a Friday anchor', () => {
    const dates = expandSchedule({
      anchorDate: '2026-08-28', // a Friday
      segments: [{ freq: 'weekly', count: 3 }],
    });
    expect(dates).toEqual(['2026-08-28', '2026-09-04', '2026-09-11']);
  });

  it('explicit weekdays Mon+Thu, every second week, until a date', () => {
    const dates = expandSchedule({
      anchorDate: '2026-08-24', // Monday
      segments: [{ freq: 'weekly', interval: 2, byWeekday: [1, 4], until: '2026-09-25' }],
    });
    expect(dates).toEqual([
      '2026-08-24',
      '2026-08-27',
      '2026-09-07',
      '2026-09-10',
      '2026-09-21',
      '2026-09-24',
    ]);
  });
});

describe('month-end clamping (RFC semantics)', () => {
  it('the 31st clamps in shorter months instead of skipping them', () => {
    const dates = expandSchedule({
      anchorDate: '2026-08-31',
      segments: [{ freq: 'monthly', count: 4 }],
    });
    expect(dates).toEqual(['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30']);
  });
});

describe('rdate / exdate', () => {
  it('adds and removes explicit dates', () => {
    const dates = expandSchedule({
      anchorDate: '2026-09-01',
      segments: [{ freq: 'weekly', count: 3 }],
      addDates: ['2026-09-04'],
      removeDates: ['2026-09-08'],
    });
    expect(dates).toEqual(['2026-09-01', '2026-09-04', '2026-09-15']);
  });
});

describe('windows and the preview line', () => {
  it('count semantics are absolute; the window only filters the output', () => {
    const definition = {
      anchorDate: '2026-09-01',
      segments: [{ freq: 'monthly' as const, count: 6 }],
    };
    const windowed = expandSchedule(definition, { from: '2026-11-01' });
    expect(windowed[0]).toBe('2026-11-01');
    expect(windowed).toHaveLength(4); // 6 total, first two before the window
    expect(nextOccurrence(definition, '2026-10-02', '2027-12-31')).toBe('2026-11-01');
  });
});

describe('timezone edge (the 01:00-overdue bug this design exists to prevent)', () => {
  it('09:00 Helsinki is 06:00Z in summer and 07:00Z in winter', () => {
    const summer = zonedTimeToUtc(parseDate('2026-07-15'), 9, 0, 'Europe/Helsinki');
    const winter = zonedTimeToUtc(parseDate('2026-12-15'), 9, 0, 'Europe/Helsinki');
    expect(summer.toISOString()).toBe('2026-07-15T06:00:00.000Z');
    expect(winter.toISOString()).toBe('2026-12-15T07:00:00.000Z');
  });

  it('handles the spring-forward day in Stockholm', () => {
    // DST starts 2026-03-29 in the EU; 09:00 local that day is 07:00Z.
    const dst = zonedTimeToUtc(parseDate('2026-03-29'), 9, 0, 'Europe/Stockholm');
    expect(dst.toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });
});

describe('safety', () => {
  it('caps runaway definitions at the hard maximum', () => {
    const dates = expandSchedule(
      { anchorDate: '2026-01-01', segments: [{ freq: 'daily', count: 100000 }] },
      { to: '2100-01-01' },
    );
    expect(dates.length).toBeLessThanOrEqual(1000);
  });
});
