import { createEmailSender } from './email.module';
import { LogEmailSender } from './log-email.sender';
import { ResendEmailSender } from './resend-email.sender';

// C1 ("Acesso e sessões", fix final): ConfigModule.forRoot() completa o process.env com o
// backend/.env de dev — um e2e rodado sem RESEND_API_KEY no .env.test herdava a chave REAL e
// mandava e-mail de verdade. Em NODE_ENV=test (o Jest sempre seta) a fábrica nunca monta o Resend.
describe('createEmailSender', () => {
  it('NODE_ENV=test com chave definida → nunca ResendEmailSender (LogEmailSender)', () => {
    const sender = createEmailSender({ NODE_ENV: 'test', RESEND_API_KEY: 're_chave_real' });
    expect(sender).not.toBeInstanceOf(ResendEmailSender);
    expect(sender).toBeInstanceOf(LogEmailSender);
  });

  it('fora de teste, com chave → ResendEmailSender', () => {
    expect(createEmailSender({ NODE_ENV: 'production', RESEND_API_KEY: 're_chave_real' })).toBeInstanceOf(ResendEmailSender);
    expect(createEmailSender({ NODE_ENV: 'development', RESEND_API_KEY: 're_chave_real' })).toBeInstanceOf(ResendEmailSender);
  });

  it('chave vazia ou só com espaços conta como ausente → LogEmailSender', () => {
    expect(createEmailSender({ NODE_ENV: 'development', RESEND_API_KEY: '' })).toBeInstanceOf(LogEmailSender);
    expect(createEmailSender({ NODE_ENV: 'development', RESEND_API_KEY: '   ' })).toBeInstanceOf(LogEmailSender);
    expect(createEmailSender({ NODE_ENV: 'development' })).toBeInstanceOf(LogEmailSender);
  });

  it('a chave usada é a versão sem espaços nas pontas', () => {
    const sender = createEmailSender({ NODE_ENV: 'development', RESEND_API_KEY: '  re_chave_real \n' }) as any;
    expect(sender).toBeInstanceOf(ResendEmailSender);
    expect(sender.apiKey).toBe('re_chave_real');
  });
});
