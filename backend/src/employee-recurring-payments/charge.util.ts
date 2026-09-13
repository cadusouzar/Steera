import { Prisma } from '@prisma/client';

export interface RecurringChargeSource {
  id: string;
  companyId: string;
  employeeId: string;
  description: string;
  amount: Prisma.Decimal;
  dueDay: number;
}

export function buildRecurringChargeData(recurring: RecurringChargeSource, now: Date) {
  const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), recurring.dueDay));
  const monthLabel = now.toLocaleString('pt-BR', { month: 'long' });
  return {
    companyId: recurring.companyId,
    employeeId: recurring.employeeId,
    recurringPaymentId: recurring.id,
    referenceYear: now.getFullYear(),
    referenceMonth: now.getMonth() + 1,
    description: `${recurring.description} (${monthLabel})`,
    amount: recurring.amount,
    dueDate,
    status: 'PENDING' as const,
  };
}
