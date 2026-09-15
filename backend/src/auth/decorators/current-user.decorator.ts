import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
  mustChangePassword: boolean;
  hasFullPontoAccess: boolean;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
