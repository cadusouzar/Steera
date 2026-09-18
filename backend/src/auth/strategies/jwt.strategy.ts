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
    };
  }
}
