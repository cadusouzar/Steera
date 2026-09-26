import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getPlan, PLAN_CATALOG } from './plan-catalog';
import { PLAN_COUNTED_LOGIN_STATUSES } from './plan-limits.util';

// Sem cache de propósito (mesma decisão de PlanGuard) — o plano/uso é lido do banco a cada
// chamada, então mudar `Company.planTier` no banco (hoje manual; no futuro, o checkout) aparece na
// próxima vez que o frontend consulta `GET /plans/me`, sem atraso nenhum.
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyPlan(companyId: string) {
    const { planTier } = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { planTier: true },
    });
    // As três contagens usam a MESMA regra do teto aplicado nos pontos de criação (PlanGuard/
    // assertBelowPlanLimit): Role.active, Employee.status ACTIVE, e User (login) role EMPLOYEE com
    // status em PLAN_COUNTED_LOGIN_STATUSES (ACTIVE + convite pendente INVITED). `companyId` explícito em cada uma é defesa em profundidade junto do RLS/roteamento por
    // tenant, mesmo padrão já usado em roles.service.ts/employees.service.ts/users.service.ts.
    const [roles, employees, employeeLogins] = await Promise.all([
      this.prisma.role.count({ where: { companyId, active: true } }),
      this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { companyId, role: 'EMPLOYEE', status: { in: PLAN_COUNTED_LOGIN_STATUSES } } }),
    ]);
    const current = getPlan(planTier);
    return {
      current: { tier: current.tier, label: current.label, limits: current.limits },
      usage: { roles, employees, employeeLogins },
      // Catálogo inteiro (4 planos), sempre na mesma ordem crescente de PLAN_CATALOG — o frontend
      // usa isso pra desenhar a tela de comparação/upgrade de planos.
      catalog: PLAN_CATALOG.map((plan) => ({
        tier: plan.tier,
        label: plan.label,
        priceLabel: plan.priceLabel,
        modules: plan.modules,
        features: plan.features,
        limits: plan.limits,
      })),
    };
  }
}
