import { ForbiddenException } from '@nestjs/common';
import { CompanyPlanTier, UserStatus } from '@prisma/client';
import { planLimit, planLimitMessage, PlanLimitKind } from './plan-catalog';

// Status de login EMPLOYEE que ocupam vaga no teto `employeeLogins` do plano ("Acesso e sessões",
// 26/09/2026): ativo + convite pendente (senão dava pra convidar além do limite e cada um "ativar"
// depois, ao aceitar). Fonte ÚNICA pro teto (UsersService) e pro uso exibido (PlansService,
// GET /plans/me) — se os dois divergissem, a tela mostraria vaga sobrando e a criação recusaria.
export const PLAN_COUNTED_LOGIN_STATUSES: UserStatus[] = ['ACTIVE', 'INVITED'];

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
