import { startOfToday } from './date.util';

describe('startOfToday', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    jest.useRealTimers();
    process.env.TZ = originalTz;
  });

  it('returns the UTC calendar date, not the local one, when they differ (e.g. 21:37 in UTC-3 is already the next UTC day)', () => {
    process.env.TZ = 'America/Sao_Paulo'; // UTC-3, no DST as of 2026
    // 2026-09-10T21:37:00-03:00 == 2026-09-11T00:37:00Z — local calendar day
    // is the 10th, UTC calendar day is already the 11th.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-11T00:37:00.000Z'));

    const result = startOfToday();

    expect(result.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('still returns the correct UTC date well within the UTC day (no local/UTC straddling)', () => {
    process.env.TZ = 'America/Sao_Paulo';
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T15:00:00.000Z')); // noon local, same calendar day both ways

    const result = startOfToday();

    expect(result.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });
});
