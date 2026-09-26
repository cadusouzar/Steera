import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { EmailMessage, EmailSender } from './email-sender';

// Amazon SES (API v2). O client é injetado (ver createEmailSender em email.module.ts) — lá ele é
// montado sem credenciais explícitas, então o SDK usa a cadeia padrão de provedores (AWS_REGION /
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY do ambiente). Nunca loga nem repassa credenciais: o erro
// relançado carrega só o nome/código da AWS e o status HTTP, nunca a mensagem crua do SDK (que pode
// ecoar o access key id em alguns erros de assinatura).
export class SesEmailSender implements EmailSender {
  constructor(
    private readonly client: SESv2Client,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const command = new SendEmailCommand({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: message.html, Charset: 'UTF-8' },
            Text: { Data: message.text, Charset: 'UTF-8' },
          },
        },
      },
    });
    try {
      await this.client.send(command);
    } catch (err) {
      throw new Error(describeSesError(err));
    }
  }
}

function describeSesError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'SES recusou o envio (erro desconhecido)';
  const e = err as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const code = [e.Code, e.code, e.name].find((v) => typeof v === 'string' && v.length > 0) ?? 'erro desconhecido';
  const status = typeof e.$metadata?.httpStatusCode === 'number' ? ` (HTTP ${e.$metadata.httpStatusCode})` : '';
  return `SES recusou o envio: ${String(code)}${status}`;
}
