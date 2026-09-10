import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmployeeRecurringPaymentsService } from '../employee-recurring-payments/employee-recurring-payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

interface DueChargesResult {
  checked: number;
  generated: number;
}

@Injectable()
export class BillingSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly employeeRecurringPaymentsService: EmployeeRecurringPaymentsService,
  ) {}

  // Cobre o caso do processo ter ficado fora do ar quando o cron deveria ter
  // rodado (queda, restart, deploy, ambiente local desligado) — a checagem
  // roda de novo assim que a aplicação sobe, sem esperar o próximo 3h.
  async onApplicationBootstrap() {
    await this.runCatchUp('inicialização');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCron() {
    await this.runCatchUp('cron diário');
  }

  private async runCatchUp(trigger: string) {
    // Cada serviço tem seu próprio try/catch — uma falha em um nunca deve
    // impedir a execução do outro.
    const subs = await this.safeGenerate(
      () => this.subscriptionsService.generateDueCharges(),
      'assinaturas de clientes',
      trigger,
    );
    const employees = await this.safeGenerate(
      () => this.employeeRecurringPaymentsService.generateDueCharges(),
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
