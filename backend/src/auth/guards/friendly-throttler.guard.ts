import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

// Extraída em função própria pra poder ser testada isoladamente (friendly-throttler.guard.spec.ts)
// sem precisar montar um ExecutionContext/ThrottlerLimitDetail completo — mesmo padrão já usado em
// login-throttle.util.ts.
export function buildThrottleErrorMessage(secondsRemaining: number): string {
  const seconds = Math.max(0, secondsRemaining);
  if (seconds < 60) {
    return 'Muitas tentativas. Tente novamente em menos de 1 minuto.';
  }
  const minutes = Math.ceil(seconds / 60);
  return `Muitas tentativas. Tente novamente em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
}

// O @nestjs/throttler padrão sempre lança a mesma mensagem técnica fixa
// ("ThrottlerException: Too Many Requests"), sem nenhuma indicação de quanto tempo falta — e o
// frontend mostra `err.message` cru (ver `src/lib/api.ts`), então essa string técnica chegava
// direto na tela de login. `timeToBlockExpire` (segundos restantes de bloqueio) já vem calculado
// pelo storage do próprio throttler; só nunca era exposto na mensagem.
@Injectable()
export class FriendlyThrottlerGuard extends ThrottlerGuard {
  protected async getErrorMessage(_context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<string> {
    return buildThrottleErrorMessage(detail.timeToBlockExpire);
  }
}
