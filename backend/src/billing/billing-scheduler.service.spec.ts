import { Test } from '@nestjs/testing';
import { EmployeeRecurringPaymentsBillingService } from '../employee-recurring-payments/employee-recurring-payments-billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsBillingService } from '../subscriptions/subscriptions-billing.service';
import { BillingSchedulerService } from './billing-scheduler.service';

describe('BillingSchedulerService', () => {
  let service: BillingSchedulerService;
  let prisma: { company: { findMany: jest.Mock } };
  let subscriptionsBilling: { generateDueCharges: jest.Mock };
  let employeeRecurringPaymentsBilling: { generateDueCharges: jest.Mock };

  beforeEach(async () => {
    // Single company by default — the RLS backstop requires this scheduler to
    // establish a tenant context per Company row (see billing-scheduler.service.ts)
    // before calling into the per-tenant billing services below; one company
    // keeps the existing "called once" assertions in this file meaningful.
    prisma = { company: { findMany: jest.fn().mockResolvedValue([{ id: 'company-1', name: 'Empresa 1' }]) } };
    subscriptionsBilling = { generateDueCharges: jest.fn() };
    employeeRecurringPaymentsBilling = { generateDueCharges: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        BillingSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsBillingService, useValue: subscriptionsBilling },
        { provide: EmployeeRecurringPaymentsBillingService, useValue: employeeRecurringPaymentsBilling },
      ],
    }).compile();
    service = module.get(BillingSchedulerService);
  });

  it('onApplicationBootstrap calls both services\' generateDueCharges', async () => {
    subscriptionsBilling.generateDueCharges.mockResolvedValue({ checked: 2, generated: 1 });
    employeeRecurringPaymentsBilling.generateDueCharges.mockResolvedValue({ checked: 1, generated: 0 });

    await service.onApplicationBootstrap();

    expect(subscriptionsBilling.generateDueCharges).toHaveBeenCalledTimes(1);
    expect(employeeRecurringPaymentsBilling.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('an error from one service does not prevent the other from running, and does not throw', async () => {
    subscriptionsBilling.generateDueCharges.mockRejectedValue(new Error('db down'));
    employeeRecurringPaymentsBilling.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });

    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

    expect(employeeRecurringPaymentsBilling.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('an error from the second service does not affect the result of the first', async () => {
    subscriptionsBilling.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });
    employeeRecurringPaymentsBilling.generateDueCharges.mockRejectedValue(new Error('db down'));

    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

    expect(subscriptionsBilling.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('runDailyCron triggers the same catch-up logic as onApplicationBootstrap', async () => {
    subscriptionsBilling.generateDueCharges.mockResolvedValue({ checked: 0, generated: 0 });
    employeeRecurringPaymentsBilling.generateDueCharges.mockResolvedValue({ checked: 0, generated: 0 });

    await service.runDailyCron();

    expect(subscriptionsBilling.generateDueCharges).toHaveBeenCalledTimes(1);
    expect(employeeRecurringPaymentsBilling.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('iterates every company, not just one (RLS backstop requires a tenant context per company)', async () => {
    prisma.company.findMany.mockResolvedValue([
      { id: 'company-1', name: 'Empresa 1' },
      { id: 'company-2', name: 'Empresa 2' },
      { id: 'company-3', name: 'Empresa 3' },
    ]);
    subscriptionsBilling.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });
    employeeRecurringPaymentsBilling.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });

    await service.onApplicationBootstrap();

    expect(subscriptionsBilling.generateDueCharges).toHaveBeenCalledTimes(3);
    expect(employeeRecurringPaymentsBilling.generateDueCharges).toHaveBeenCalledTimes(3);
  });
});
