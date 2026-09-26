import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
  mustChangePassword: boolean;
  hasFullPontoAccess: boolean;
  permissions: Record<string, string | null>;
  // Opcional só pra não obrigar todo fixture de teste existente a declarar o campo — JwtStrategy
  // sempre popula (true/false). Ver EmailVerifiedGuard.
  emailVerificationPending?: boolean;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
