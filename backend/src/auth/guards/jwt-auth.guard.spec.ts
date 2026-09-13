import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

// Não existia spec dedicado pra este guard antes deste fix (a checagem de
// @Public() nunca teve cobertura unitária própria neste codebase — só
// indireta via app.e2e-spec.ts). A lógica NOVA de mustChangePassword ganha
// cobertura direta aqui, já que — ao contrário da checagem de RH em
// employees.controller.ts — ela não tem equivalente inline em nenhum
// controller pra testar a esse nível.
describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let superCanActivate: jest.SpyInstance;

  const buildContext = (user?: any) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
    // super.canActivate() (AuthGuard('jwt'), de @nestjs/passport) é quem de
    // fato valida o JWT contra a estratégia — mockado aqui pra isolar só a
    // lógica NOVA deste guard (mustChangePassword), que roda depois que o
    // token já foi validado e req.user já foi populado pela strategy.
    superCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows a @Public() route through without ever touching mustChangePassword', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true); // isPublic
    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(true);
    // Nunca chega a validar o JWT nem ler req.user — uma rota @Public() não
    // tem nenhum dos dois disponível (ninguém logou ainda).
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('blocks a business route with 403 when mustChangePassword is true', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false) // isPublic
      .mockReturnValueOnce(false); // allowedDuringForcedChange
    await expect(
      guard.canActivate(buildContext({ userId: 'u1', mustChangePassword: true })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a route explicitly marked @AllowDuringForcedPasswordChange() even when mustChangePassword is true', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false) // isPublic
      .mockReturnValueOnce(true); // allowedDuringForcedChange
    await expect(
      guard.canActivate(buildContext({ userId: 'u1', mustChangePassword: true })),
    ).resolves.toBe(true);
  });

  it('allows a normal business route through when mustChangePassword is false', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(false);
    await expect(
      guard.canActivate(buildContext({ userId: 'u1', mustChangePassword: false })),
    ).resolves.toBe(true);
  });

  it('returns false (never reaches mustChangePassword check) when the JWT itself is invalid', async () => {
    superCanActivate.mockResolvedValue(false);
    reflector.getAllAndOverride.mockReturnValueOnce(false); // isPublic
    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(false);
  });
});
