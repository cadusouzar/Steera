import { readResendApiKey, validateMailConfig } from './mail-config.util';

const PROD_OK = { NODE_ENV: 'production', RESEND_API_KEY: 're_real_key', FRONTEND_URL: 'https://app.steera.com.br' };

describe('validateMailConfig', () => {
  it('throws in production without RESEND_API_KEY', () => {
    expect(() => validateMailConfig({ ...PROD_OK, RESEND_API_KEY: '' })).toThrow(/RESEND_API_KEY/);
  });

  it('throws in production when RESEND_API_KEY is undefined', () => {
    expect(() => validateMailConfig({ NODE_ENV: 'production', FRONTEND_URL: PROD_OK.FRONTEND_URL })).toThrow(/RESEND_API_KEY/);
  });

  it('throws in production when RESEND_API_KEY is whitespace only', () => {
    expect(() => validateMailConfig({ ...PROD_OK, RESEND_API_KEY: '   ' })).toThrow(/RESEND_API_KEY/);
  });

  it('does not throw in production with a RESEND_API_KEY and an https FRONTEND_URL', () => {
    expect(() => validateMailConfig(PROD_OK)).not.toThrow();
  });

  it('does not throw in development without RESEND_API_KEY nor FRONTEND_URL', () => {
    expect(() => validateMailConfig({ NODE_ENV: 'development' })).not.toThrow();
  });

  describe('FRONTEND_URL em produção (links dos e-mails)', () => {
    it.each([
      ['ausente', undefined],
      ['vazio', ''],
      ['só espaços', '   '],
    ])('%s → falha o boot', (_label, value) => {
      expect(() => validateMailConfig({ ...PROD_OK, FRONTEND_URL: value })).toThrow(/FRONTEND_URL/);
    });

    it.each([
      'http://app.steera.com.br',
      'https://localhost:5173',
      'https://127.0.0.1',
      'http://localhost:5173',
      'nao-e-url',
    ])('%s → falha o boot', (value) => {
      expect(() => validateMailConfig({ ...PROD_OK, FRONTEND_URL: value })).toThrow(/FRONTEND_URL/);
    });

    it('mensagem clara em português', () => {
      expect(() => validateMailConfig({ ...PROD_OK, FRONTEND_URL: 'http://localhost:5173' })).toThrow(
        /FRONTEND_URL.*produção/,
      );
    });

    it('fora de produção, localhost/http continua valendo', () => {
      expect(() => validateMailConfig({ NODE_ENV: 'development', FRONTEND_URL: 'http://localhost:5173' })).not.toThrow();
    });
  });
});

describe('readResendApiKey', () => {
  it('apara espaços e trata vazio/só espaços como ausente', () => {
    expect(readResendApiKey({ RESEND_API_KEY: ' re_x ' })).toBe('re_x');
    expect(readResendApiKey({ RESEND_API_KEY: '  ' })).toBeUndefined();
    expect(readResendApiKey({ RESEND_API_KEY: '' })).toBeUndefined();
    expect(readResendApiKey({})).toBeUndefined();
  });
});
