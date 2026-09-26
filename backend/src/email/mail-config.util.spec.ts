import {
  describeEmailSetup,
  readDevAllowedRecipients,
  readResendApiKey,
  readSesRegion,
  resolveEmailSetup,
  validateMailConfig,
} from './mail-config.util';

const SES_CREDS = { AWS_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'AKIA_TESTE', AWS_SECRET_ACCESS_KEY: 'segredo_teste' };
const FRONT = { FRONTEND_URL: 'https://app.steera.com.br' };
// Produção padrão: sem EMAIL_PROVIDER → ses.
const PROD_OK = { NODE_ENV: 'production', ...SES_CREDS, ...FRONT };
const PROD_RESEND_OK = { NODE_ENV: 'production', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_real_key', ...FRONT };

describe('validateMailConfig', () => {
  describe('produção com ses (padrão quando EMAIL_PROVIDER não está definido)', () => {
    it('não lança com AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY e FRONTEND_URL https', () => {
      expect(() => validateMailConfig(PROD_OK)).not.toThrow();
      expect(() => validateMailConfig({ ...PROD_OK, EMAIL_PROVIDER: ' SES ' })).not.toThrow();
    });

    it.each(['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])('%s ausente → falha o boot', (key) => {
      const env: NodeJS.ProcessEnv = { ...PROD_OK };
      delete env[key];
      expect(() => validateMailConfig(env)).toThrow(new RegExp(key));
    });

    it.each(['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])('%s só com espaços → falha o boot', (key) => {
      expect(() => validateMailConfig({ ...PROD_OK, [key]: '   ' })).toThrow(new RegExp(key));
    });

    it('a mensagem de erro nunca traz o valor das credenciais', () => {
      let message = '';
      try {
        validateMailConfig({ ...PROD_OK, AWS_SECRET_ACCESS_KEY: '' });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toContain('AKIA_TESTE');
      expect(message).not.toContain('us-east-2');
    });

    it('não exige RESEND_API_KEY quando o provedor é ses', () => {
      expect(() => validateMailConfig({ ...PROD_OK, RESEND_API_KEY: '' })).not.toThrow();
    });
  });

  describe('produção com resend', () => {
    it('não lança com RESEND_API_KEY', () => {
      expect(() => validateMailConfig(PROD_RESEND_OK)).not.toThrow();
    });

    it.each([
      ['vazia', ''],
      ['só espaços', '   '],
      ['ausente', undefined],
    ])('RESEND_API_KEY %s → falha o boot', (_label, value) => {
      expect(() => validateMailConfig({ ...PROD_RESEND_OK, RESEND_API_KEY: value })).toThrow(/RESEND_API_KEY/);
    });
  });

  it('produção com EMAIL_PROVIDER=log → falha o boot (nenhum e-mail chegaria)', () => {
    expect(() => validateMailConfig({ ...PROD_OK, EMAIL_PROVIDER: 'log' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('EMAIL_PROVIDER desconhecido → falha o boot em qualquer ambiente (erro de digitação nunca passa calado)', () => {
    expect(() => validateMailConfig({ ...PROD_OK, EMAIL_PROVIDER: 'sess' })).toThrow(/EMAIL_PROVIDER/);
    expect(() => validateMailConfig({ NODE_ENV: 'development', EMAIL_PROVIDER: 'mailgun' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('fora de produção, sem nenhuma credencial nem FRONTEND_URL, não lança', () => {
    expect(() => validateMailConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateMailConfig({ NODE_ENV: 'development', EMAIL_PROVIDER: 'ses' })).not.toThrow();
    expect(() => validateMailConfig({ NODE_ENV: 'development', EMAIL_PROVIDER: 'resend' })).not.toThrow();
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

describe('resolveEmailSetup', () => {
  it('NODE_ENV=test → sempre log, mesmo com EMAIL_PROVIDER=ses e credenciais', () => {
    expect(resolveEmailSetup({ NODE_ENV: 'test', EMAIL_PROVIDER: 'ses', ...SES_CREDS }).active).toBe('log');
    expect(resolveEmailSetup({ NODE_ENV: 'test', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x' }).active).toBe('log');
  });

  it('produção sem EMAIL_PROVIDER → ses', () => {
    expect(resolveEmailSetup(PROD_OK)).toMatchObject({ selected: 'ses', active: 'ses', production: true });
  });

  it('produção com EMAIL_PROVIDER=resend → resend', () => {
    expect(resolveEmailSetup(PROD_RESEND_OK)).toMatchObject({ selected: 'resend', active: 'resend' });
  });

  it('dev sem EMAIL_PROVIDER → log, mesmo com credenciais de ses e chave do resend no ambiente', () => {
    const setup = resolveEmailSetup({ NODE_ENV: 'development', ...SES_CREDS, RESEND_API_KEY: 're_x' });
    expect(setup).toMatchObject({ selected: 'log', active: 'log', production: false });
  });

  it('NODE_ENV ausente conta como dev → log por padrão', () => {
    expect(resolveEmailSetup({ ...SES_CREDS }).active).toBe('log');
  });

  it('dev com EMAIL_PROVIDER=ses (aparado/minúsculo) e credenciais → ses', () => {
    expect(resolveEmailSetup({ NODE_ENV: 'development', EMAIL_PROVIDER: '  SeS ', ...SES_CREDS }).active).toBe('ses');
  });

  it('dev com EMAIL_PROVIDER=ses sem credenciais completas → log, com o motivo', () => {
    const setup = resolveEmailSetup({ NODE_ENV: 'development', EMAIL_PROVIDER: 'ses', AWS_REGION: 'us-east-2' });
    expect(setup.selected).toBe('ses');
    expect(setup.active).toBe('log');
    expect(setup.reason).toMatch(/credenciais/);
  });

  it('dev com EMAIL_PROVIDER=resend: com chave → resend; sem chave → log', () => {
    expect(resolveEmailSetup({ NODE_ENV: 'development', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x' }).active).toBe('resend');
    expect(resolveEmailSetup({ NODE_ENV: 'development', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: ' ' }).active).toBe('log');
  });

  it('EMAIL_PROVIDER desconhecido → log (defensivo; validateMailConfig já barra o boot)', () => {
    expect(resolveEmailSetup({ NODE_ENV: 'development', EMAIL_PROVIDER: 'mailgun' }).active).toBe('log');
  });

  it('conta os destinatários da allowlist de dev', () => {
    expect(
      resolveEmailSetup({ NODE_ENV: 'development', EMAIL_DEV_ALLOWED_RECIPIENTS: 'a@b.com, c@d.com' }).allowedRecipients,
    ).toEqual(['a@b.com', 'c@d.com']);
  });
});

describe('describeEmailSetup', () => {
  it('produção: só o provedor ativo, sem allowlist nem valores de credenciais', () => {
    const line = describeEmailSetup(resolveEmailSetup(PROD_OK));
    expect(line).toBe('E-mail: provedor ativo = ses');
    expect(line).not.toContain('AKIA_TESTE');
    expect(line).not.toContain('segredo_teste');
  });

  it('dev: traz o TAMANHO da allowlist, nunca os endereços', () => {
    const line = describeEmailSetup(
      resolveEmailSetup({ NODE_ENV: 'development', EMAIL_PROVIDER: 'ses', ...SES_CREDS, EMAIL_DEV_ALLOWED_RECIPIENTS: 'eu@x.com' }),
    );
    expect(line).toBe('E-mail: provedor ativo = ses; destinatários liberados em dev: 1');
    expect(line).not.toContain('eu@x.com');
  });

  it('dev caindo pro log: diz o provedor pedido e o motivo', () => {
    expect(describeEmailSetup(resolveEmailSetup({ NODE_ENV: 'development', EMAIL_PROVIDER: 'ses' }))).toBe(
      'E-mail: provedor ativo = log (selecionado: ses; credenciais da AWS ausentes); destinatários liberados em dev: 0',
    );
  });
});

describe('readDevAllowedRecipients', () => {
  it('separa por vírgula, apara, passa pra minúsculas e ignora vazios', () => {
    expect(readDevAllowedRecipients({ EMAIL_DEV_ALLOWED_RECIPIENTS: ' A@B.com ,, c@d.COM ,' })).toEqual(['a@b.com', 'c@d.com']);
  });

  it('ausente ou vazia → lista vazia', () => {
    expect(readDevAllowedRecipients({})).toEqual([]);
    expect(readDevAllowedRecipients({ EMAIL_DEV_ALLOWED_RECIPIENTS: '  ' })).toEqual([]);
  });
});

describe('readSesRegion', () => {
  it('devolve a região aparada só quando as três variáveis estão preenchidas', () => {
    expect(readSesRegion({ ...SES_CREDS, AWS_REGION: ' us-east-2 ' })).toBe('us-east-2');
    expect(readSesRegion({ ...SES_CREDS, AWS_ACCESS_KEY_ID: ' ' })).toBeUndefined();
    expect(readSesRegion({ ...SES_CREDS, AWS_SECRET_ACCESS_KEY: undefined })).toBeUndefined();
    expect(readSesRegion({ ...SES_CREDS, AWS_REGION: '' })).toBeUndefined();
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
