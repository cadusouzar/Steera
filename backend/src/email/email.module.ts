import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER, EmailSender } from './email-sender';
import { EmailService } from './email.service';
import { LogEmailSender } from './log-email.sender';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { AllowlistEmailSender } from './allowlist-email.sender';
import { readResendApiKey, readSesRegion, resolveEmailSetup } from './mail-config.util';
import { ResendEmailSender } from './resend-email.sender';
import { SesEmailSender } from './ses-email.sender';

const DEFAULT_FROM = 'Steera <no-reply@steera.com.br>';

// Quem decide o provedor é resolveEmailSetup (mail-config.util.ts): NODE_ENV=test → sempre log (fix
// final de "Acesso e sessões": ConfigModule completa o process.env com o backend/.env de dev, então
// um e2e herdaria credenciais REAIS); produção → ses por padrão; qualquer outro ambiente → log, a
// menos que EMAIL_PROVIDER peça um provedor real explicitamente. Provedor real sem credenciais →
// log em dev (em produção validateMailConfig já barrou o boot). Fora de produção, o provedor real
// SEMPRE vem embrulhado no AllowlistEmailSender: só EMAIL_DEV_ALLOWED_RECIPIENTS recebe de verdade.
export function createEmailSender(env: NodeJS.ProcessEnv): EmailSender {
  const setup = resolveEmailSetup(env);
  if (setup.active === 'log') return new LogEmailSender(setup.reason);

  const from = env.MAIL_FROM || DEFAULT_FROM;
  const real: EmailSender =
    setup.active === 'ses'
      ? // Sem `credentials`: o SDK usa a cadeia padrão (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY do env).
        new SesEmailSender(new SESv2Client({ region: readSesRegion(env) }), from)
      : new ResendEmailSender(readResendApiKey(env) as string, from);

  if (setup.production) return real;
  return new AllowlistEmailSender(
    real,
    new LogEmailSender('destinatário fora de EMAIL_DEV_ALLOWED_RECIPIENTS'),
    setup.allowedRecipients,
  );
}

// Global: EmailService é consumido por módulos bem distintos entre si (auth,
// convite de usuário, bloqueio de conta) sem que cada um precise importar
// EmailModule explicitamente.
@Global()
@Module({
  providers: [
    EmailService,
    {
      provide: EMAIL_SENDER,
      useFactory: () => createEmailSender(process.env),
    },
  ],
  exports: [EmailService, EMAIL_SENDER],
})
export class EmailModule {}
