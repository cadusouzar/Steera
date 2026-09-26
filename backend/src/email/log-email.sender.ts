import { Logger } from '@nestjs/common';
import { EmailMessage, EmailSender } from './email-sender';

// Usado em dev quando RESEND_API_KEY não está configurada (ver email.module.ts)
// — nunca em produção nem em teste. Loga o `text` (que sempre traz o link cru)
// pra ser o jeito de ver/copiar o link de confirmação/convite/redefinição sem
// precisar de uma chave real do Resend.
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(`E-mail NÃO enviado (sem RESEND_API_KEY) para ${message.to}: ${message.subject}`);
    this.logger.warn(message.text);
  }
}
