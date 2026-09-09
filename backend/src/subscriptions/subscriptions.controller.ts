import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post('clients/:clientId/subscriptions')
  create(@Param('clientId') clientId: string, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(clientId, dto);
  }

  @Get('clients/:clientId/subscriptions')
  findAllForClient(@Param('clientId') clientId: string) {
    return this.subscriptionsService.findAllForClient(clientId);
  }

  @Get('subscriptions/:id')
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch('subscriptions/:id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, dto);
  }

  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.subscriptionsService.remove(id);
  }

  @Post('subscriptions/:id/generate-charge')
  generateCharge(@Param('id') id: string) {
    return this.subscriptionsService.generateCharge(id);
  }
}
