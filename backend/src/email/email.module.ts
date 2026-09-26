import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER } from './email-sender';
import { EmailService } from './email.service';
import { LogEmailSender } from './log-email.sender';
import { ResendEmailSender } from './resend-email.sender';

// Global: EmailService é consumido por módulos bem distintos entre si (auth,
// convite de usuário, bloqueio de conta) sem que cada um precise importar
// EmailModule explicitamente.
@Global()
@Module({
  providers: [
    EmailService,
    {
      provide: EMAIL_SENDER,
      // Sem RESEND_API_KEY (sempre o caso em teste, e o default em dev): cai
      // pro LogEmailSender, nunca tenta uma chamada de rede real. Ver
      // mail-config.util.ts pra checagem que impede isso de acontecer em
      // produção.
      useFactory: () =>
        process.env.RESEND_API_KEY
          ? new ResendEmailSender(process.env.RESEND_API_KEY, process.env.MAIL_FROM || 'Steera <no-reply@steera.com.br>')
          : new LogEmailSender(),
    },
  ],
  exports: [EmailService, EMAIL_SENDER],
})
export class EmailModule {}
