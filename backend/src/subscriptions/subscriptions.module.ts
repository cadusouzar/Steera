import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsBillingService } from './subscriptions-billing.service';

@Module({
  imports: [CompanyModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsBillingService],
  exports: [SubscriptionsService, SubscriptionsBillingService],
})
export class SubscriptionsModule {}
