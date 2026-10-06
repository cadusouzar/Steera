import { localDateOnly, startOfToday } from './date.util';

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

describe('localDateOnly', () => {
  it('06/10 00:30 em São Paulo é o dia 06/10', () => {
    // 2026-10-06T00:30:00-03:00 == 2026-10-06T03:30:00Z
    expect(localDateOnly(new Date('2026-10-06T03:30:00.000Z'), 'America/Sao_Paulo').toISOString())
      .toBe('2026-10-06T00:00:00.000Z');
  });

  it('05/10 22:00 em São Paulo continua sendo 05/10, mesmo já sendo 06/10 em UTC', () => {
    // 2026-10-05T22:00:00-03:00 == 2026-10-06T01:00:00Z
    expect(localDateOnly(new Date('2026-10-06T01:00:00.000Z'), 'America/Sao_Paulo').toISOString())
      .toBe('2026-10-05T00:00:00.000Z');
  });

  it('em UTC devolve o próprio dia UTC', () => {
    expect(localDateOnly(new Date('2026-10-06T23:59:59.999Z'), 'UTC').toISOString())
      .toBe('2026-10-06T00:00:00.000Z');
  });
});
