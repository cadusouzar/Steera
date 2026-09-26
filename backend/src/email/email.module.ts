import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER, EmailSender } from './email-sender';
import { EmailService } from './email.service';
import { LogEmailSender } from './log-email.sender';
import { readResendApiKey } from './mail-config.util';
import { ResendEmailSender } from './resend-email.sender';

// NODE_ENV=test (o Jest sempre seta) NUNCA monta o Resend, mesmo com uma chave no ambiente:
// ConfigModule.forRoot() completa o process.env com o backend/.env de dev, então um e2e rodado com
// --env-file=.env.test sem RESEND_API_KEY herdava a chave REAL e mandava e-mail de verdade (fix
// final de "Acesso e sessões"). Sem chave (vazia/só espaços contam como ausente, ver
// readResendApiKey): LogEmailSender, nunca uma chamada de rede. Ver mail-config.util.ts pra
// checagem que impede o LogEmailSender em produção.
export function createEmailSender(env: NodeJS.ProcessEnv): EmailSender {
  const apiKey = readResendApiKey(env);
  if (env.NODE_ENV === 'test' || !apiKey) return new LogEmailSender();
  return new ResendEmailSender(apiKey, env.MAIL_FROM || 'Steera <no-reply@steera.com.br>');
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
