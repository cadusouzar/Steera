import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { ALLOW_UNVERIFIED_EMAIL_KEY } from '../decorators/allow-unverified-email.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Confirmação de e-mail de quem cria a empresa ("Acesso e sessões", 26/09/2026). APP_GUARD global,
// registrado logo depois do JwtAuthGuard (que popula req.user) e antes do PlanGuard. Enquanto o
// fundador não confirmar o e-mail, toda rota autenticada responde 403 EMAIL_NOT_VERIFIED, exceto as
// marcadas com @AllowUnverifiedEmail() e as @Public().
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_EMAIL_KEY, targets)) return true;
    const user = context.switchToHttp().getRequest().user;
    // Claim do JWT só decide SE precisa olhar o banco: confirmado não paga nada; pendente consulta o
    // banco a cada requisição, então confirmar libera na hora (sem esperar o token de 15min expirar).
    if (!user?.emailVerificationPending) return true;
    // runAsSystem: User tem FORCE RLS e os guards rodam ANTES do TenantContextInterceptor — sem
    // bypass a linha viria filtrada (null) e o login ficaria bloqueado mesmo depois de confirmar.
    const fresh = await runAsSystem(() =>
      this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { emailVerifiedAt: true, emailVerificationRequired: true },
      }),
    );
    if (fresh && (!fresh.emailVerificationRequired || fresh.emailVerifiedAt)) return true;
    throw new ForbiddenException({
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Confirme seu e-mail para acessar o sistema.',
    });
  }
}
