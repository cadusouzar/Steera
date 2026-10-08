import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string; // userId
  companyId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
  mustChangePassword: boolean;
  hasFullPontoAccess: boolean;
  permissions: Record<string, string | null>;
  // emailVerificationRequired && !emailVerifiedAt no momento da emissão — ver EmailVerifiedGuard.
  emailVerificationPending: boolean;
  // Faltava aceitar a versão vigente dos Termos/Política no momento da emissão — ver LegalAcceptanceGuard.
  legalAcceptancePending: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Nunca deixar a biblioteca decidir o algoritmo a partir do próprio
      // token — fixa explicitamente HS256, evita ataque de confusão de
      // algoritmo (ex.: um token forjado pedindo "alg: none").
      algorithms: ['HS256'],
      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  validate(payload: JwtPayload) {
    return {
      userId: payload.sub,
      companyId: payload.companyId,
      role: payload.role,
      modules: payload.modules,
      mustChangePassword: payload.mustChangePassword,
      hasFullPontoAccess: payload.hasFullPontoAccess,
      permissions: payload.permissions,
      // Tokens emitidos antes desta claim existir não a carregam: `?? false` = tratar como
      // confirmado (todos os logins anteriores foram marcados confirmados no backfill).
      emailVerificationPending: payload.emailVerificationPending ?? false,
      // Diferente da claim acima, aqui o padrão é `true`: não houve backfill de aceite (contas
      // anteriores a 07/10/2026 NÃO aceitaram), então um token emitido antes desta claim existir
      // manda o LegalAcceptanceGuard consultar o banco — que decide (aceito passa, pendente é barrado).
      legalAcceptancePending: payload.legalAcceptancePending ?? true,
    };
  }
}
