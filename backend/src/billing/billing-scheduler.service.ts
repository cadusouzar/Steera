import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmployeeRecurringPaymentsBillingService } from '../employee-recurring-payments/employee-recurring-payments-billing.service';
import { SubscriptionsBillingService } from '../subscriptions/subscriptions-billing.service';

interface DueChargesResult {
  checked: number;
  generated: number;
}

@Injectable()
export class BillingSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
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
    const subs = await this.safeGenerate(
      () => this.subscriptionsBilling.generateDueCharges(),
      'assinaturas de clientes',
      trigger,
    );
    const employees = await this.safeGenerate(
      () => this.employeeRecurringPaymentsBilling.generateDueCharges(),
      'recorrências de funcionário',
      trigger,
    );

    const totalGenerated = (subs?.generated ?? 0) + (employees?.generated ?? 0);
    if (totalGenerated > 0) {
      this.logger.log(
        `Cobrança automática (${trigger}): ${subs?.generated ?? 0} assinatura(s), ` +
          `${employees?.generated ?? 0} recorrência(s) de funcionário geradas.`,
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
