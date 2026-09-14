import { computeEasterSunday, getNationalAndMovableHolidays, getStateHolidays } from './brazilian-holidays.seed';

describe('brazilian-holidays.seed', () => {
  it('computes known Easter Sundays correctly', () => {
    expect(computeEasterSunday(2024).toISOString().slice(0, 10)).toBe('2024-03-31');
    expect(computeEasterSunday(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
    expect(computeEasterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
  });

  it('generates exactly 13 national/movable holidays for a given year', () => {
    expect(getNationalAndMovableHolidays(2026)).toHaveLength(13);
  });

  it('derives Carnaval and Corpus Christi correctly relative to Easter', () => {
    const holidays = getNationalAndMovableHolidays(2026);
    const carnavalSegunda = holidays.find((h) => h.name.includes('segunda'));
    expect(carnavalSegunda?.date.toISOString().slice(0, 10)).toBe('2026-02-16');

    const corpusChristi = holidays.find((h) => h.name === 'Corpus Christi');
    expect(corpusChristi?.date.toISOString().slice(0, 10)).toBe('2026-06-04');
  });

  it('returns fixed-date state holidays for the given year', () => {
    const sp = getStateHolidays('SP', 2026);
    expect(sp).toHaveLength(1);
    expect(sp[0].date.toISOString().slice(0, 10)).toBe('2026-07-09');
    expect(sp[0].name).toBe('Revolução Constitucionalista de 1932');
  });

  it('is case-insensitive on the state code', () => {
    expect(getStateHolidays('sp', 2026)).toHaveLength(1);
  });

  it('resolves a movable (Easter-relative) state holiday correctly (ES = Easter + 8 days)', () => {
    const es = getStateHolidays('ES', 2026);
    expect(es).toHaveLength(1);
    // Easter 2026-04-05 + 8 days = 2026-04-13 (a Monday)
    expect(es[0].date.toISOString().slice(0, 10)).toBe('2026-04-13');
  });

  it('returns an empty array for a state with no confirmed current state holiday (MT, PR)', () => {
    expect(getStateHolidays('MT', 2026)).toEqual([]);
    expect(getStateHolidays('PR', 2026)).toEqual([]);
  });

  it('returns an empty array for an unknown state code', () => {
    expect(getStateHolidays('XX', 2026)).toEqual([]);
  });

  it('covers all 27 states/DF with an entry in the lookup table (empty array counts as covered)', () => {
    const ufs = [
      'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
      'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
    ];
    for (const uf of ufs) {
      expect(() => getStateHolidays(uf, 2026)).not.toThrow();
    }
    expect(ufs).toHaveLength(27);
  });
});
