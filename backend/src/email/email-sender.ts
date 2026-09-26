// Contrato mínimo pra qualquer forma de enviar e-mail neste projeto — trocado via injeção de
// dependência (EMAIL_SENDER, ver createEmailSender em email.module.ts) entre Amazon SES, Resend, log
// (dev/teste — nada sai) e fake (testes), com a allowlist de dev (AllowlistEmailSender) por cima de
// um provedor real fora de produção, sem nenhuma outra parte do código saber qual está em uso.
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
