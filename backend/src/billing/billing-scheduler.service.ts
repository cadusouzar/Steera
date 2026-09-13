import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmployeeRecurringPaymentsBillingService } from '../employee-recurring-payments/employee-recurring-payments-billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../prisma/tenant-context';
import { SubscriptionsBillingService } from '../subscriptions/subscriptions-billing.service';

interface DueChargesResult {
  checked: number;
  generated: number;
}

@Injectable()
export class BillingSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsBilling: SubscriptionsBillingService,
    private readonly employeeRecurringPaymentsBilling: EmployeeRecurringPaymentsBillingService,
  ) {}

  async onApplicationBootstrap() {
    await this.runCatchUp('inicialização');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCron() {
    await this.runCatchUp('cron diário');
  }

  private async runCatchUp(trigger: string) {
    // Runs from a @Cron job / OnApplicationBootstrap — there is no HTTP
    // request, no req.user, no tenant context of any kind established for
    // this call stack by default. Since the RLS backstop's "no tenant
    // context = see/write nothing" default now applies to every one of
    // subscription/receivable/employeeRecurringPayment/employeePayment's
    // queries, this scheduler MUST explicitly establish a tenant context
    // per company before calling into the per-tenant billing services below
    // — otherwise, post-RLS, it would silently generate zero charges for
    // every company, every day, forever.
    //
    // This also fixes a previously-documented limitation (see CLAUDE.md /
    // DECISOES-TECNICAS "cobra só uma empresa por execução"): iterating
    // every Company row here means this scheduler now genuinely covers every
    // tenant, not just whichever one CompanyContextService's old
    // single-company stub happened to resolve to. Company itself carries no
    // companyId (it IS the tenant) and has no RLS policy, so this initial
    // lookup needs no tenant context of its own.
    const companies = await this.prisma.company.findMany({ select: { id: true, name: true } });

    let totalSubsGenerated = 0;
    let totalEmployeesGenerated = 0;

    for (const company of companies) {
      await runWithTenant(company.id, async () => {
        const subs = await this.safeGenerate(
          () => this.subscriptionsBilling.generateDueCharges(),
          `assinaturas de clientes (empresa ${company.name})`,
          trigger,
        );
        const employees = await this.safeGenerate(
          () => this.employeeRecurringPaymentsBilling.generateDueCharges(),
          `recorrências de funcionário (empresa ${company.name})`,
          trigger,
        );
        totalSubsGenerated += subs?.generated ?? 0;
        totalEmployeesGenerated += employees?.generated ?? 0;
      });
    }

    const totalGenerated = totalSubsGenerated + totalEmployeesGenerated;
    if (totalGenerated > 0) {
      this.logger.log(
        `Cobrança automática (${trigger}): ${totalSubsGenerated} assinatura(s), ` +
          `${totalEmployeesGenerated} recorrência(s) de funcionário geradas (${companies.length} empresa(s) verificada(s)).`,
      );
    }
  }

  private async safeGenerate(
    fn: () => Promise<DueChargesResult>,
    label: string,
    trigger: string,
  ): Promise<DueChargesResult | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `Falha na cobrança automática de ${label} (${trigger})`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }
}
