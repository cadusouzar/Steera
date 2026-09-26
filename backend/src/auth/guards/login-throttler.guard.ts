import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerLimitDetail } from '@nestjs/throttler';
import { accountLockedError } from '../account-lock.util';
import { loginEmailTracker } from '../login-throttle.util';
import { FriendlyThrottlerGuard } from './friendly-throttler.guard';

// Só em POST /auth/login. O throttler "login-email" (chave = e-mail, conta e-mail inexistente
// também) responde EXATAMENTE como o bloqueio temporário de uma conta real (AuthService.login,
// ver account-lock.util.ts) — anti-enumeração: quem está chutando não distingue conta real travada
// de e-mail inventado. O throttler "default" (por IP) segue com o 429 amigável de sempre.
//
// Como saber QUAL throttler estourou: `ThrottlerLimitDetail` (6.5.0) não traz o nome do throttler,
// mas traz `tracker` — conferido em node_modules/@nestjs/throttler/dist/throttler.guard.js
// (handleRequest): é o valor devolvido pelo `getTracker` efetivo daquele throttler, e o
// `getTracker` do @Throttle({...}) do handler tem precedência sobre o do módulo
// (`routeOrClassGetTracker || namedThrottler.getTracker || commonOptions.getTracker`). Então o
// tracker do "login-email" é exatamente `loginEmailTracker(req)`, e o do "default" é `req.ip`.
// Recalcular `loginEmailTracker(req)` aqui e comparar é determinístico. O `includes('@')` cobre o
// único caso em que os dois poderiam coincidir: corpo sem e-mail, em que loginEmailTracker cai no
// IP — aí é sempre o 429 comum (um IP nunca contém '@'). Comparar `detail.limit` (a alternativa)
// quebraria em silêncio no dia em que os dois limites fossem iguais.
@Injectable()
export class LoginThrottlerGuard extends FriendlyThrottlerGuard {
  protected async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const req = context.switchToHttp().getRequest();
    const emailKey = loginEmailTracker(req);
    if (emailKey.includes('@') && detail.tracker === emailKey) {
      throw accountLockedError(detail.timeToBlockExpire);
    }
    return super.throwThrottlingException(context, detail);
  }
}
