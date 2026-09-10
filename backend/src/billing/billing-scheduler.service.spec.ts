import { Test } from '@nestjs/testing';
import { EmployeeRecurringPaymentsService } from '../employee-recurring-payments/employee-recurring-payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BillingSchedulerService } from './billing-scheduler.service';

describe('BillingSchedulerService', () => {
  let service: BillingSchedulerService;
  let subscriptionsService: { generateDueCharges: jest.Mock };
  let employeeRecurringPaymentsService: { generateDueCharges: jest.Mock };

  beforeEach(async () => {
    subscriptionsService = { generateDueCharges: jest.fn() };
    employeeRecurringPaymentsService = { generateDueCharges: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        BillingSchedulerService,
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: EmployeeRecurringPaymentsService, useValue: employeeRecurringPaymentsService },
      ],
    }).compile();
    service = module.get(BillingSchedulerService);
  });

  it('onApplicationBootstrap calls both services\' generateDueCharges', async () => {
    subscriptionsService.generateDueCharges.mockResolvedValue({ checked: 2, generated: 1 });
    employeeRecurringPaymentsService.generateDueCharges.mockResolvedValue({ checked: 1, generated: 0 });

    await service.onApplicationBootstrap();

    expect(subscriptionsService.generateDueCharges).toHaveBeenCalledTimes(1);
    expect(employeeRecurringPaymentsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('an error from one service does not prevent the other from running, and does not throw', async () => {
    subscriptionsService.generateDueCharges.mockRejectedValue(new Error('db down'));
    employeeRecurringPaymentsService.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });

    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

    expect(employeeRecurringPaymentsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('an error from the second service does not affect the result of the first', async () => {
    subscriptionsService.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });
    employeeRecurringPaymentsService.generateDueCharges.mockRejectedValue(new Error('db down'));

    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

    expect(subscriptionsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('runDailyCron triggers the same catch-up logic as onApplicationBootstrap', async () => {
    subscriptionsService.generateDueCharges.mockResolvedValue({ checked: 0, generated: 0 });
    employeeRecurringPaymentsService.generateDueCharges.mockResolvedValue({ checked: 0, generated: 0 });

    await service.runDailyCron();

    expect(subscriptionsService.generateDueCharges).toHaveBeenCalledTimes(1);
    expect(employeeRecurringPaymentsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });
});
