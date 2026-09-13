import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_DURING_FORCED_PASSWORD_CHANGE_KEY } from '../decorators/allow-during-forced-password-change.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() continua sendo a PRIMEIRA checagem, antes de qualquer coisa
    // relacionada a mustChangePassword — uma rota pública não tem req.user
    // nenhum (ninguém logou ainda), então ler `user.mustChangePassword`
    // antes desta guarda quebraria com um erro de "propriedade de
    // undefined" em vez de simplesmente liberar a rota.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // super.canActivate() é quem valida o JWT em si (assinatura, expiração,
    // algoritmo) e popula req.user via JwtStrategy.validate() — só depois
    // disso existe um `user.mustChangePassword` confiável pra checar.
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    // @AllowDuringForcedPasswordChange(): as duas únicas rotas que um login
    // travado em mustChangePassword precisa continuar alcançando (GET
    // /auth/me e PATCH /auth/me/password) — ver esse decorator.
    const allowedDuringForcedChange = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DURING_FORCED_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowedDuringForcedChange) return true;

    const { user } = context.switchToHttp().getRequest();
    if (user?.mustChangePassword) {
      throw new ForbiddenException('Você precisa trocar sua senha temporária antes de continuar');
    }
    return true;
  }
}
