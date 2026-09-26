import { Logger } from '@nestjs/common';
import { EmailMessage, EmailSender } from './email-sender';

// Usado quando nenhum provedor real está ativo (teste, dev sem EMAIL_PROVIDER, provedor sem
// credenciais) e como destino dos destinatários fora da allowlist de dev (AllowlistEmailSender) —
// nunca como provedor em produção (validateMailConfig barra o boot). Loga o `text` (que sempre traz o
// link cru) pra ser o jeito de ver/copiar o link de confirmação/convite/redefinição em dev. `reason`
// diz por que o e-mail não foi enviado de verdade.
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  constructor(private readonly reason = 'nenhum provedor de e-mail real ativo') {}

  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(`E-mail NÃO enviado (${this.reason}) para ${message.to}: ${message.subject}`);
    this.logger.warn(message.text);
  }
}
