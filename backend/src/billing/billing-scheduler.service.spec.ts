import { Test } from '@nestjs/testing';
import { EmployeeRecurringPaymentsBillingService } from '../employee-recurring-payments/employee-recurring-payments-billing.service';
import { SubscriptionsBillingService } from '../subscriptions/subscriptions-billing.service';
import { BillingSchedulerService } from './billing-scheduler.service';

describe('BillingSchedulerService', () => {
  let service: BillingSchedulerService;
  let subscriptionsBilling: { generateDueCharges: jest.Mock };
  let employeeRecurringPaymentsBilling: { generateDueCharges: jest.Mock };

  beforeEach(async () => {
    subscriptionsBilling = { generateDueCharges: jest.fn() };
    employeeRecurringPaymentsBilling = { generateDueCharges: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        BillingSchedulerService,
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
});
