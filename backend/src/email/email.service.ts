import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_SENDER, EmailMessage, EmailSender } from './email-sender';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

  // Nunca lança: e-mail é efeito colateral — a ação principal (cadastro, convite, bloqueio) já
  // aconteceu e segue valendo; a tela oferece "Reenviar". Nunca loga o corpo (tem o token).
  async send(message: EmailMessage, context: string): Promise<boolean> {
    try {
      await this.sender.send(message);
      return true;
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail (${context}) para ${message.to}: ${(err as Error).message}`);
      return false;
    }
  }
}
