import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { buildRecurringChargeData } from './charge.util';

@Injectable()
export class EmployeeRecurringPaymentsBillingService {
  private readonly logger = new Logger(EmployeeRecurringPaymentsBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;
    const lastDayOfMonth = new Date(Date.UTC(referenceYear, referenceMonth, 0)).getUTCDate();
    const effectiveDay = currentDay === lastDayOfMonth ? 31 : currentDay;

    const dueRecurringPayments = await this.prisma.employeeRecurringPayment.findMany({
      where: {
        status: 'ACTIVE',
        dueDay: { lte: effectiveDay },
        employee: { status: { not: 'INACTIVE' }, salaryRecurrenceEnabled: true },
        payments: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const recurring of dueRecurringPayments) {
      try {
        await this.prisma.employeePayment.create({ data: buildRecurringChargeData(recurring, new Date()) });
        generated++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue;
        }
        this.logger.error(
          `Falha ao gerar pagamento da recorrência ${recurring.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return { checked: dueRecurringPayments.length, generated };
  }
}
