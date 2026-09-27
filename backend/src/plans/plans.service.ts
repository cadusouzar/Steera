import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getPlan, PLAN_CATALOG } from './plan-catalog';
import { PLAN_COUNTED_LOGIN_STATUSES } from './plan-limits.util';
import { SUBSCRIPTION_MANAGE_PERMISSION } from '../permissions/protected-permissions';

// Quantos contatos de cobrança `GET /plans/me` devolve pra quem NÃO pode gerenciar a assinatura.
const MAX_BILLING_CONTACTS = 3;

// Sem cache de propósito (mesma decisão de PlanGuard) — o plano/uso é lido do banco a cada
// chamada, então mudar `Company.planTier` no banco (hoje manual; no futuro, o checkout) aparece na
// próxima vez que o frontend consulta `GET /plans/me`, sem atraso nenhum.
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyPlan(companyId: string, userId: string) {
    const { planTier } = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { planTier: true },
    });
    // As três contagens usam a MESMA regra do teto aplicado nos pontos de criação (PlanGuard/
    // assertBelowPlanLimit): Role.active, Employee.status ACTIVE, e User (login) role EMPLOYEE com
    // status em PLAN_COUNTED_LOGIN_STATUSES (ACTIVE + convite pendente INVITED). `companyId` explícito em cada uma é defesa em profundidade junto do RLS/roteamento por
    // tenant, mesmo padrão já usado em roles.service.ts/employees.service.ts/users.service.ts.
    // Quem gerencia a assinatura (27/09/2026): `User`/`Profile`/`ProfilePermission` são centrais
    // (FORCE RLS por `companyId`, roteadas pelo client central). Lido do BANCO, não do claim
    // `permissions` do JWT — o claim pode estar até 15min defasado depois de uma troca de perfil, e
    // aqui não há custo em ler o valor atual. `companyId` no próprio perfil é defesa em
    // profundidade (não existe FK composta garantindo que User.profileId aponte pra um perfil da
    // mesma empresa — mesmo cuidado de AuthorizationService.getEffectivePermissions).
    const grantsSubscription = {
      companyId,
      permissions: { some: { permissionCode: SUBSCRIPTION_MANAGE_PERMISSION } },
    };
    const [roles, employees, employeeLogins, self, billingContacts] = await Promise.all([
      this.prisma.role.count({ where: { companyId, active: true } }),
      this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { companyId, role: 'EMPLOYEE', status: { in: PLAN_COUNTED_LOGIN_STATUSES } } }),
      this.prisma.user.findFirst({
        where: { id: userId, companyId, profile: grantsSubscription },
        select: { id: true },
      }),
      // Só login ACTIVE — um convite pendente ou login bloqueado não é alguém a quem pedir o upgrade.
      // Só nome/e-mail (nunca id/papel/etc.): é o que a tela mostra pra quem não pode comprar.
      this.prisma.user.findMany({
        where: { companyId, status: 'ACTIVE', profile: grantsSubscription },
        select: { name: true, email: true },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        take: MAX_BILLING_CONTACTS,
      }),
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
      // O frontend esconde as ações de compra ("Fazer upgrade"/"Quero o plano X") quando false, e
      // mostra `billingContacts` no lugar. Hoje nenhuma rota muda o plano — isto é só a regra de
      // quem vê a ação; a futura rota de checkout precisa exigir a mesma permissão no backend.
      canManageSubscription: self !== null,
      billingContacts: billingContacts.map((c) => ({ name: c.name, email: c.email })),
    };
  }
}
