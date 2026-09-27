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

  it('denies with the structured PERMISSION_REQUIRED body and the human pt-BR message', () => {
    const { context, reflector } = makeContext({ permissions: {} }, ['clientes.gerenciar']);
    const guard = new PermissionsGuard(reflector);
    try {
      guard.canActivate(context);
      fail('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        code: 'PERMISSION_REQUIRED',
        message: 'Seu perfil não permite alterar Clientes. Fale com quem administra os acessos da empresa.',
      });
    }
  });

  it('uses the FIRST required code for the message when multiple codes are accepted (OR semantics)', () => {
    const { context, reflector } = makeContext({ permissions: {} }, ['funcionarios.ver', 'funcionarios.gerenciar']);
    const guard = new PermissionsGuard(reflector);
    try {
      guard.canActivate(context);
      fail('expected canActivate to throw');
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        message: 'Seu perfil não permite ver Funcionários. Fale com quem administra os acessos da empresa.',
      });
    }
  });
});
