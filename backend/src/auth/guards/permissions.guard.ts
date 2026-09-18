import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    // Semântica OR, mesmo padrão de ModulesGuard: basta ter PELO MENOS UMA das permissões listadas.
    const hasAccess = required.some((code) => code in (user?.permissions ?? {}));
    if (!hasAccess) throw new ForbiddenException('Seu login não tem esta permissão');
    return true;
  }
}
