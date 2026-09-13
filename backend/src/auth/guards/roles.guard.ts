import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride (não só .get(handler)) — mesmo padrão de
    // JwtAuthGuard.canActivate() pra @Public(). Sem isso, um @Roles(...)
    // hipotético aplicado no nível da CLASSE (não do método) seria ignorado
    // silenciosamente, liberando acesso geral em vez de restringir.
    const required = this.reflector.getAllAndOverride<string[]>('roles', [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    return required.includes(user?.role);
  }
}
