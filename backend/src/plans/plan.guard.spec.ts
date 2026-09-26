import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { REQUIRED_MODULES_KEY } from '../auth/decorators/require-module.decorator';
import { PlanGuard } from './plan.guard';

// Mesmo estilo de modules.guard.spec.ts: Reflector real (só o método usado é
// mockado) + ExecutionContext fake. PrismaService é reduzido a
// `company.findUnique`, único método que o guard chama.
describe('PlanGuard', () => {
  let guard: PlanGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { company: { findUnique: jest.Mock } };

  // metadata: { isPublic?: boolean; requiredModules?: string[] }
  const buildContext = (companyId: string | undefined, metadata: { isPublic?: boolean; requiredModules?: string[] }) => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return metadata.isPublic;
      if (key === REQUIRED_MODULES_KEY) return metadata.requiredModules;
      return undefined;
    });
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: companyId === undefined ? undefined : { companyId } }),
      }),
    } as any;
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prisma = { company: { findUnique: jest.fn() } };
    guard = new PlanGuard(reflector as unknown as Reflector, prisma as any);
  });

  it('allows a @Public() route through without consulting the database', async () => {
    const context = buildContext('company-1', { isPublic: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it('allows a route without @RequireModule() through without consulting the database', async () => {
    const context = buildContext('company-1', {});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it("throws PLAN_UPGRADE_REQUIRED for @RequireModule('PONTO_REGISTRO') on a GRATIS company", async () => {
    prisma.company.findUnique.mockResolvedValue({ planTier: 'GRATIS' });
    const context = buildContext('company-1', { requiredModules: ['PONTO_REGISTRO'] });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);

    try {
      await guard.canActivate(context);
      throw new Error('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredPlan: 'BASICO',
        message: 'Ponto está disponível a partir do plano Básico. Veja os planos em Minha conta → Assinatura.',
      });
    }
  });

  it("allows @RequireModule('PONTO_REGISTRO') through on a BASICO company", async () => {
    prisma.company.findUnique.mockResolvedValue({ planTier: 'BASICO' });
    const context = buildContext('company-1', { requiredModules: ['PONTO_REGISTRO'] });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows through on OR semantics when the company plan covers at least one required module', async () => {
    prisma.company.findUnique.mockResolvedValue({ planTier: 'GRATIS' });
    const context = buildContext('company-1', { requiredModules: ['PONTO_ADMINISTRACAO', 'RH_FUNCIONARIOS'] });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('queries Company.planTier by the exact shape expected, with no cache across calls', async () => {
    prisma.company.findUnique.mockResolvedValue({ planTier: 'BASICO' });
    const context = buildContext('company-1', { requiredModules: ['PONTO_REGISTRO'] });

    await guard.canActivate(context);
    await guard.canActivate(context);

    expect(prisma.company.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.company.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'company-1' },
      select: { planTier: true },
    });
    expect(prisma.company.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'company-1' },
      select: { planTier: true },
    });
  });
});
