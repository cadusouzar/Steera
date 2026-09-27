import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { buildPermissionDeniedMessage } from '../permission-labels';

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
    if (!hasAccess) {
      // Corpo estruturado (mesmo padrão de PlanGuard/EmailVerifiedGuard/accountLockedError): o
      // frontend distingue pelo `code`, nunca por texto. Pra múltiplos códigos aceitos (semântica
      // OR), a mensagem usa o PRIMEIRO da lista.
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_REQUIRED',
        message: buildPermissionDeniedMessage(required[0]),
      });
    }
    return true;
  }
}
