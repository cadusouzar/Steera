import { createHash } from 'crypto';
import { refreshSessionTracker } from './refresh-throttle.util';

describe('refreshSessionTracker', () => {
  it('rastreia pela sessão (sha256 do cookie rt), nunca pelo valor cru do cookie', () => {
    const expected = 'rt:' + createHash('sha256').update('abc').digest('hex');
    expect(refreshSessionTracker({ cookies: { rt: 'abc' }, ip: '1.2.3.4' })).toBe(expected);
  });

  it('a mesma sessão vinda de IPs diferentes cai no MESMO bucket', () => {
    const a = refreshSessionTracker({ cookies: { rt: 'abc' }, ip: '1.2.3.4' });
    const b = refreshSessionTracker({ cookies: { rt: 'abc' }, ip: '5.6.7.8' });
    expect(a).toBe(b);
  });

  it('sessões diferentes atrás do mesmo IP (escritório) caem em buckets diferentes', () => {
    const a = refreshSessionTracker({ cookies: { rt: 'abc' }, ip: '1.2.3.4' });
    const b = refreshSessionTracker({ cookies: { rt: 'def' }, ip: '1.2.3.4' });
    expect(a).not.toBe(b);
  });

  it('sem cookie cai no IP', () => {
    expect(refreshSessionTracker({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(refreshSessionTracker({ cookies: {}, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(refreshSessionTracker({ cookies: { rt: '' }, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
  });
});
