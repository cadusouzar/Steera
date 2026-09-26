import { EmailMessage, EmailSender } from './email-sender';

// Usado só em testes (nunca em produção/dev) — guarda tudo em memória em vez
// de enviar de verdade, pra asserções não precisarem mockar `fetch`/Resend em
// cada teste que dispara um e-mail.
export class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  clear(): void {
    this.sent = [];
  }

  lastTo(email: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === email);
  }
}
