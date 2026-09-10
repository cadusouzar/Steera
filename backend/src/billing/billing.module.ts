import { Module } from '@nestjs/common';
import { EmployeeRecurringPaymentsModule } from '../employee-recurring-payments/employee-recurring-payments.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BillingSchedulerService } from './billing-scheduler.service';

@Module({
  imports: [SubscriptionsModule, EmployeeRecurringPaymentsModule],
  providers: [BillingSchedulerService],
})
export class BillingModule {}
