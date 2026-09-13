import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModulesGuard } from './modules.guard';

// Mesma estrutura de teste que RolesGuard teria (não existe roles.guard.spec.ts
// hoje neste codebase — a checagem de role é coberta a nível de controller,
// ver employees.controller.spec.ts — mas ModulesGuard é um CanActivate "de
// verdade", sem contraparte inline em nenhum controller, então ganha
// cobertura direta aqui).
describe('ModulesGuard', () => {
  let guard: ModulesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const buildContext = (modules: string[] | undefined) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: modules === undefined ? undefined : { modules } }) }),
    }) as any;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new ModulesGuard(reflector as unknown as Reflector);
  });

  it('allows through when no @RequireModule() metadata is present (opt-in only, same as RolesGuard)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext(['CLIENTES']))).toBe(true);
  });

  it('allows through when @RequireModule() metadata is an empty array', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(buildContext(['CLIENTES']))).toBe(true);
  });

  it('allows a login that has at least one of the required modules (OR semantics)', () => {
    reflector.getAllAndOverride.mockReturnValue(['RH', 'CLIENTES']);
    expect(guard.canActivate(buildContext(['CLIENTES']))).toBe(true);
  });

  it('allows a login whose modules include ALL required modules too', () => {
    reflector.getAllAndOverride.mockReturnValue(['RH']);
    expect(guard.canActivate(buildContext(['RH', 'CLIENTES']))).toBe(true);
  });

  it('rejects a login with none of the required modules', () => {
    reflector.getAllAndOverride.mockReturnValue(['RH']);
    expect(() => guard.canActivate(buildContext(['CLIENTES']))).toThrow(ForbiddenException);
  });

  it('rejects a login with no modules at all', () => {
    reflector.getAllAndOverride.mockReturnValue(['RH']);
    expect(() => guard.canActivate(buildContext([]))).toThrow(ForbiddenException);
  });

  it('rejects when the request has no user at all (defensive — should never happen behind JwtAuthGuard)', () => {
    reflector.getAllAndOverride.mockReturnValue(['RH']);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
  });

  it('reads metadata via getAllAndOverride so a class-level @RequireModule() is honored, not just method-level', () => {
    reflector.getAllAndOverride.mockReturnValue(['RH']);
    const context = buildContext(['RH']);
    guard.canActivate(context);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('requiredModules', [
      context.getHandler(),
      context.getClass(),
    ]);
  });
});
