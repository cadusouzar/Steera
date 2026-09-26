import { EmailMessage, EmailSender } from './email-sender';

// Sem dependência nova — usa o `fetch` nativo do Node 18+ direto contra a API
// HTTP do Resend (https://resend.com/docs/api-reference/emails/send-email),
// sem o SDK oficial (`resend`), que traria uma dependência inteira só pra um
// POST simples.
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend respondeu ${res.status}`);
  }
}
