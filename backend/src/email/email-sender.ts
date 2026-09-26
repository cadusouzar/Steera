// Contrato mínimo pra qualquer forma de enviar e-mail neste projeto — trocado
// via injeção de dependência (EMAIL_SENDER, ver email.module.ts) entre Resend
// (produção/dev com chave), log (dev sem chave) e fake (testes), sem nenhuma
// outra parte do código saber qual das três está em uso.
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
