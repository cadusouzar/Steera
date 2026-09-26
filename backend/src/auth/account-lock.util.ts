import { ForbiddenException } from '@nestjs/common';

// Resposta ÚNICA de "conta travada temporariamente" ("Acesso e sessões", 26/09/2026). Usada pelos
// dois caminhos que podem travar um login — AuthService.login com conta real (User.lockedUntil no
// futuro) e com e-mail sem conta (UnknownLoginFailureTracker, trava em memória) —
// pra que quem está chutando senhas não consiga distinguir uma conta real travada de um e-mail
// inventado: mesmo status, mesmas chaves, mesmo code, mesma mensagem.
export function accountLockedError(retryAfterSeconds: number): ForbiddenException {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new ForbiddenException({
    statusCode: 403,
    code: 'ACCOUNT_TEMPORARILY_LOCKED',
    retryAfterSeconds: seconds,
    message: `Muitas tentativas para esta conta. Tente novamente em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} ou redefina sua senha pelo e-mail.`,
  });
}
