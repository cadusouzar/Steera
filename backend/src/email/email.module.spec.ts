import { AllowlistEmailSender } from './allowlist-email.sender';
import { createEmailSender } from './email.module';
import { LogEmailSender } from './log-email.sender';
import { ResendEmailSender } from './resend-email.sender';
import { SesEmailSender } from './ses-email.sender';

// Só instancia senders — nenhum teste aqui chama send(), então nada toca a rede (o SESv2Client é
// criado de forma preguiçosa pelo SDK, sem nenhuma chamada na construção).
const SES_CREDS = { AWS_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'AKIA_TESTE', AWS_SECRET_ACCESS_KEY: 'segredo_teste' };

describe('createEmailSender', () => {
  // C1 ("Acesso e sessões", fix final): ConfigModule.forRoot() completa o process.env com o
  // backend/.env de dev — um e2e herdava credenciais REAIS. Em NODE_ENV=test (o Jest sempre seta) a
  // fábrica nunca monta um provedor real.
  it('NODE_ENV=test com qualquer provedor/credencial → LogEmailSender', () => {
    expect(createEmailSender({ NODE_ENV: 'test', RESEND_API_KEY: 're_chave_real' })).toBeInstanceOf(LogEmailSender);
    expect(createEmailSender({ NODE_ENV: 'test', EMAIL_PROVIDER: 'ses', ...SES_CREDS })).toBeInstanceOf(LogEmailSender);
    expect(createEmailSender({ NODE_ENV: 'test', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x' })).toBeInstanceOf(
      LogEmailSender,
    );
  });

  describe('produção (sem allowlist — envia pra qualquer destinatário)', () => {
    it('sem EMAIL_PROVIDER → SesEmailSender', () => {
      expect(createEmailSender({ NODE_ENV: 'production', ...SES_CREDS })).toBeInstanceOf(SesEmailSender);
    });

    it('EMAIL_PROVIDER=resend → ResendEmailSender com a chave aparada', () => {
      const sender = createEmailSender({
        NODE_ENV: 'production', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '  re_chave_real \n',
      }) as unknown as { apiKey: string };
      expect(sender).toBeInstanceOf(ResendEmailSender);
      expect(sender.apiKey).toBe('re_chave_real');
    });

    it('usa MAIL_FROM quando definido, senão o remetente padrão da Steera', () => {
      const withFrom = createEmailSender({ NODE_ENV: 'production', ...SES_CREDS, MAIL_FROM: 'X <x@y.com>' }) as unknown as {
        from: string;
      };
      expect(withFrom.from).toBe('X <x@y.com>');
      const noFrom = createEmailSender({ NODE_ENV: 'production', ...SES_CREDS }) as unknown as { from: string };
      expect(noFrom.from).toBe('Steera <no-reply@steera.com.br>');
    });
  });

  describe('fora de produção', () => {
    it('sem EMAIL_PROVIDER → LogEmailSender, mesmo com credenciais e chave no ambiente', () => {
      expect(createEmailSender({ NODE_ENV: 'development', ...SES_CREDS, RESEND_API_KEY: 're_x' })).toBeInstanceOf(
        LogEmailSender,
      );
    });

    it('EMAIL_PROVIDER=ses com credenciais → allowlist em volta do SesEmailSender', () => {
      const sender = createEmailSender({
        NODE_ENV: 'development', EMAIL_PROVIDER: 'ses', ...SES_CREDS, EMAIL_DEV_ALLOWED_RECIPIENTS: 'eu@x.com',
      }) as unknown as { inner: unknown; allowed: Set<string> };
      expect(sender).toBeInstanceOf(AllowlistEmailSender);
      expect(sender.inner).toBeInstanceOf(SesEmailSender);
      expect([...sender.allowed]).toEqual(['eu@x.com']);
    });

    it('EMAIL_PROVIDER=resend com chave → allowlist em volta do ResendEmailSender', () => {
      const sender = createEmailSender({
        NODE_ENV: 'development', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x',
      }) as unknown as { inner: unknown };
      expect(sender).toBeInstanceOf(AllowlistEmailSender);
      expect(sender.inner).toBeInstanceOf(ResendEmailSender);
    });

    it('EMAIL_PROVIDER real sem credenciais → LogEmailSender', () => {
      expect(createEmailSender({ NODE_ENV: 'development', EMAIL_PROVIDER: 'ses', AWS_REGION: 'us-east-2' })).toBeInstanceOf(
        LogEmailSender,
      );
      expect(createEmailSender({ NODE_ENV: 'development', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '  ' })).toBeInstanceOf(
        LogEmailSender,
      );
    });
  });
});
