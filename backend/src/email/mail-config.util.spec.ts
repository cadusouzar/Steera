import { validateMailConfig } from './mail-config.util';

describe('validateMailConfig', () => {
  it('throws in production without RESEND_API_KEY', () => {
    expect(() => validateMailConfig({ NODE_ENV: 'production', RESEND_API_KEY: '' })).toThrow();
  });

  it('throws in production when RESEND_API_KEY is undefined', () => {
    expect(() => validateMailConfig({ NODE_ENV: 'production' })).toThrow();
  });

  it('does not throw in production with a RESEND_API_KEY set', () => {
    expect(() => validateMailConfig({ NODE_ENV: 'production', RESEND_API_KEY: 're_real_key' })).not.toThrow();
  });

  it('does not throw in development without RESEND_API_KEY', () => {
    expect(() => validateMailConfig({ NODE_ENV: 'development' })).not.toThrow();
  });
});
