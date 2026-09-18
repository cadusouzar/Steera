import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function makeContext(user: any, handlerMeta?: string[], classMeta?: string[]) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(handlerMeta ?? classMeta);
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('PermissionsGuard', () => {
  it('allows when no @RequirePermission is set', () => {
    const { context, reflector } = makeContext({ permissions: {} }, undefined);
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows when the user has at least one of the required permissions', () => {
    const { context, reflector } = makeContext({ permissions: { 'funcionarios.ver': 'EMPRESA' } }, ['funcionarios.ver', 'funcionarios.gerenciar']);
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies with 403 when the user has none of the required permissions', () => {
    const { context, reflector } = makeContext({ permissions: {} }, ['funcionarios.gerenciar']);
    const guard = new PermissionsGuard(reflector);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
