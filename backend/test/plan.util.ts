import { CompanyPlanTier } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';

// Toda empresa nova nasce GRATIS (sem Ponto/Finanças; 5 cargos, 10 funcionários, 2 logins). Suítes
// que testam outra coisa sobem a empresa de plano logo depois do cadastro — mesmo efeito de um
// `UPDATE "Company" SET "planTier" = ...` manual (PlanGuard lê sem cache).
export async function setCompanyPlan(prisma: PrismaService, companyId: string, tier: CompanyPlanTier): Promise<void> {
  await runAsSystem(() => prisma.company.update({ where: { id: companyId }, data: { planTier: tier } }));
}
