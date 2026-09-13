import { Injectable, Logger } from '@nestjs/common';
import { ClientStatus, Prisma, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionsBillingService {
  private readonly logger = new Logger(SubscriptionsBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async createChargeForSubscription(subscription: {
    id: string;
    clientId: string;
    companyId: string;
    description: string;
    amount: Prisma.Decimal;
    dueDay: number;
  }) {
    const now = new Date();
    const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), subscription.dueDay));
    const monthLabel = now.toLocaleString('pt-BR', { month: 'long' });
    return this.prisma.receivable.create({
      data: {
        clientId: subscription.clientId,
        companyId: subscription.companyId,
        subscriptionId: subscription.id,
        referenceYear: now.getFullYear(),
        referenceMonth: now.getMonth() + 1,
        description: `${subscription.description} (${monthLabel})`,
        amount: subscription.amount,
        dueDate,
        status: ReceivableStatus.PENDING,
      },
    });
  }

  // Called by BillingSchedulerService once per company, already wrapped in
  // `runWithTenant(companyId, ...)` — the RLS backstop's tenant context
  // means the query below is automatically scoped to that one company at
  // the database level (this method never filters by companyId itself,
  // relying on the same RLS session variable every other request-driven
  // query in the app relies on). This method has no HTTP request/req.user of
  // its own (it runs from a @Cron job / OnApplicationBootstrap), which is
  // exactly why the caller must establish that context explicitly.
  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;
    const lastDayOfMonth = new Date(Date.UTC(referenceYear, referenceMonth, 0)).getUTCDate();
    const effectiveDay = currentDay === lastDayOfMonth ? 31 : currentDay;

    const dueSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        dueDay: { lte: effectiveDay },
        client: { status: { not: ClientStatus.INACTIVE } },
        receivables: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const subscription of dueSubscriptions) {
      try {
        await this.createChargeForSubscription(subscription);
        generated++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue; // outra execução já gerou esta cobrança — esperado, ignorado.
        }
        this.logger.error(
          `Falha ao gerar cobrança da assinatura ${subscription.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return { checked: dueSubscriptions.length, generated };
  }
}
