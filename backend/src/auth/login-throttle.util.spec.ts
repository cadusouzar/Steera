import { loginEmailTracker } from './login-throttle.util';

describe('loginEmailTracker', () => {
  it('tracks by email, normalized (trimmed + lowercased)', () => {
    expect(loginEmailTracker({ body: { email: '  Vitima@Teste.com  ' }, ip: '1.1.1.1' })).toBe('vitima@teste.com');
  });

  it('produces the SAME key for the same email coming from different IPs', () => {
    const a = loginEmailTracker({ body: { email: 'vitima@teste.com' }, ip: '10.0.0.1' });
    const b = loginEmailTracker({ body: { email: 'vitima@teste.com' }, ip: '10.0.0.2' });
    expect(a).toBe(b);
  });

  it('produces DIFFERENT keys for different emails from the same IP', () => {
    const a = loginEmailTracker({ body: { email: 'a@teste.com' }, ip: '10.0.0.1' });
    const b = loginEmailTracker({ body: { email: 'b@teste.com' }, ip: '10.0.0.1' });
    expect(a).not.toBe(b);
  });

  it('falls back to IP if the body has no email (defensive, should not happen after login DTO validation)', () => {
    expect(loginEmailTracker({ body: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
});
