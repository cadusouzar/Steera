import { ForbiddenException } from '@nestjs/common';
import { CompanyPlanTier } from '@prisma/client';
import { planLimit, planLimitMessage, PlanLimitKind } from './plan-catalog';

interface CompanyReader {
  company: { findUniqueOrThrow(args: { where: { id: string }; select: { planTier: true } }): Promise<{ planTier: CompanyPlanTier }> };
}

// Checa o limite de quantidade do plano ANTES de criar/reativar. Sem trava de concorrência (mesmo
// rigor da checagem de logins que já existia): uma corrida pode passar do teto em 1 — aceito.
export async function assertBelowPlanLimit(
  prisma: CompanyReader,
  companyId: string,
  kind: PlanLimitKind,
  countActive: () => Promise<number>,
): Promise<void> {
  const { planTier } = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planTier: true } });
  const max = planLimit(planTier, kind);
  if (max === null) return;
  if ((await countActive()) >= max) throw new ForbiddenException(planLimitMessage(planTier, kind));
}
