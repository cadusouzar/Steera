import { ForbiddenException } from '@nestjs/common';
import { assertBelowPlanLimit } from './plan-limits.util';

describe('assertBelowPlanLimit', () => {
  function makePrisma(planTier: string) {
    return { company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ planTier }) } };
  }

  it('GRATIS com 4 cargos ativos não lança (abaixo do teto de 5)', async () => {
    const prisma = makePrisma('GRATIS');
    const countActive = jest.fn().mockResolvedValue(4);
    await expect(assertBelowPlanLimit(prisma, 'c1', 'roles', countActive)).resolves.toBeUndefined();
  });

  it('GRATIS com 5 cargos ativos lança ForbiddenException com a mensagem exata', async () => {
    const prisma = makePrisma('GRATIS');
    const countActive = jest.fn().mockResolvedValue(5);
    await expect(assertBelowPlanLimit(prisma, 'c1', 'roles', countActive)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertBelowPlanLimit(prisma, 'c1', 'roles', countActive)).rejects.toThrow(
      'Limite do plano Grátis: até 5 cargos ativos. Faça upgrade para cadastrar mais.',
    );
  });

  it('BASICO com 1000 funcionários não lança e nem chama countActive (teto null = sem limite)', async () => {
    const prisma = makePrisma('BASICO');
    const countActive = jest.fn().mockResolvedValue(1000);
    await expect(assertBelowPlanLimit(prisma, 'c1', 'employees', countActive)).resolves.toBeUndefined();
    expect(countActive).not.toHaveBeenCalled();
  });

  it('PRO com 50 logins de funcionário ativos lança (teto do plano Pro)', async () => {
    const prisma = makePrisma('PRO');
    const countActive = jest.fn().mockResolvedValue(50);
    await expect(assertBelowPlanLimit(prisma, 'c1', 'employeeLogins', countActive)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
