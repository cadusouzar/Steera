import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppModule } from '@prisma/client';
import { REQUIRED_MODULES_KEY } from '../decorators/require-module.decorator';

@Injectable()
export class ModulesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride (não só .get(handler)) — mesmo padrão de RolesGuard e
    // de JwtAuthGuard.canActivate() pra @Public(). Sem isso, um
    // @RequireModule(...) aplicado no nível da CLASSE (que é como este guard
    // é usado em todo controller de RH/Financeiro) seria ignorado
    // silenciosamente, liberando acesso geral em vez de restringir.
    const required = this.reflector.getAllAndOverride<AppModule[]>(REQUIRED_MODULES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    // Semântica OR: passa se o login tiver PELO MENOS UM dos módulos
    // exigidos, não todos.
    const hasAccess = required.some((m) => user?.modules?.includes(m));
    if (!hasAccess) throw new ForbiddenException('Seu login não tem acesso a este módulo');
    return true;
  }
}
