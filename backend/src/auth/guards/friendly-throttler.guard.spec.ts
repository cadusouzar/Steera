import { buildThrottleErrorMessage } from './friendly-throttler.guard';

describe('buildThrottleErrorMessage', () => {
  it('rounds up to whole minutes (e.g. 61s remaining -> 2 minutos)', () => {
    expect(buildThrottleErrorMessage(61)).toBe('Muitas tentativas. Tente novamente em 2 minutos.');
  });

  it('uses singular "minuto" for exactly 1 minute remaining', () => {
    expect(buildThrottleErrorMessage(60)).toBe('Muitas tentativas. Tente novamente em 1 minuto.');
  });

  it('uses a friendlier message than "minutos" when under 1 minute remains', () => {
    expect(buildThrottleErrorMessage(30)).toBe('Muitas tentativas. Tente novamente em menos de 1 minuto.');
  });

  it('never reports a negative time (defensive, clock/storage race)', () => {
    expect(buildThrottleErrorMessage(-5)).toBe('Muitas tentativas. Tente novamente em menos de 1 minuto.');
  });

  it('matches the real 15-minute login/punch throttle window', () => {
    expect(buildThrottleErrorMessage(900)).toBe('Muitas tentativas. Tente novamente em 15 minutos.');
  });
});
