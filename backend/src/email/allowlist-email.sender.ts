import { EmailMessage, EmailSender } from './email-sender';

// Trava de custo fora de produção (ver createEmailSender em email.module.ts): com um provedor REAL
// selecionado em dev, só os destinatários de EMAIL_DEV_ALLOWED_RECIPIENTS chegam ao provedor pago —
// qualquer outro vai pro `fallback` (LogEmailSender), que registra no log que NÃO foi enviado. Lista
// vazia = nada real sai. Comparação sem diferenciar maiúsculas e sem espaços nas pontas.
export class AllowlistEmailSender implements EmailSender {
  private readonly allowed: Set<string>;

  constructor(
    private readonly inner: EmailSender,
    private readonly fallback: EmailSender,
    allowed: readonly string[],
  ) {
    this.allowed = new Set(allowed.map(normalizeAddress).filter((a) => a.length > 0));
  }

  send(message: EmailMessage): Promise<void> {
    return this.allowed.has(normalizeAddress(message.to)) ? this.inner.send(message) : this.fallback.send(message);
  }
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}
