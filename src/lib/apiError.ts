// Erro de API com status HTTP + `code` opcional do backend (ex.: `ACCOUNT_TEMPORARILY_LOCKED`,
// `EMAIL_NOT_VERIFIED`) — sem isso, o único jeito de reagir a um erro específico era comparar o
// texto da mensagem (frágil, muda se o texto mudar). Estende `Error`, então todo `catch (err) {
// err.message }`/`err instanceof Error` já existente no projeto continua funcionando sem mudança.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
