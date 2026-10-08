import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LegalAcceptanceService } from '../../legal/legal-acceptance.service';
import { LEGAL_ACCEPTANCE_REQUIRED_MESSAGE } from '../../legal/legal-versions';
import { runAsSystem } from '../../prisma/tenant-context';
import { ALLOW_PENDING_LEGAL_ACCEPTANCE_KEY } from '../decorators/allow-pending-legal-acceptance.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Aceite dos Termos de uso e da Política de Privacidade (LGPD — Etapa A, 07/10/2026). APP_GUARD
// global, registrado logo depois do EmailVerifiedGuard (mesma estrutura dele). Enquanto o login não
// tiver aceitado a versão vigente dos dois documentos, toda rota autenticada responde 403
// LEGAL_ACCEPTANCE_REQUIRED, exceto as @AllowPendingLegalAcceptance() e as @Public().
@Injectable()
export class LegalAcceptanceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly legal: LegalAcceptanceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_LEGAL_ACCEPTANCE_KEY, targets)) return true;
    const user = context.switchToHttp().getRequest().user;
    // Claim do JWT só decide SE precisa olhar o banco: aceito não paga nada; pendente consulta o banco
    // a cada requisição, então aceitar libera na hora (sem esperar o token de 15min expirar).
    if (!user?.legalAcceptancePending) return true;
    // runAsSystem: mesmo motivo do EmailVerifiedGuard — guards rodam ANTES do
    // TenantContextInterceptor. LegalAcceptance não tem RLS, mas a consulta fica sob o mesmo bypass
    // explícito pra nunca depender de um contexto de tenant que ainda não existe neste ponto.
    const pending = await runAsSystem(() => this.legal.isPending(user.userId));
    if (!pending) return true;
    throw new ForbiddenException({
      statusCode: 403,
      code: 'LEGAL_ACCEPTANCE_REQUIRED',
      message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
    });
  }
}
