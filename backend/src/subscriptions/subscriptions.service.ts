import { Injectable, NotFoundException } from '@nestjs/common';
import { ReceivableStatus, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Cliente ${clientId} não encontrado`);
  }

  private async assertExists(id: string): Promise<Subscription> {
    const found = await this.prisma.subscription.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Assinatura ${id} não encontrada`);
    return found;
  }

  async create(clientId: string, dto: CreateSubscriptionDto) {
    await this.ensureClientExists(clientId);
    return this.prisma.subscription.create({ data: { ...dto, clientId } });
  }

  async findAllForClient(clientId: string) {
    await this.ensureClientExists(clientId);
    return this.prisma.subscription.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    await this.assertExists(id);
    return this.prisma.subscription.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.subscription.delete({ where: { id } });
    return { id };
  }

  async generateCharge(id: string) {
    const subscription = await this.assertExists(id);
    const now = new Date();
    const dueDate = new Date(now.getFullYear(), now.getMonth(), subscription.dueDay);
    const monthLabel = dueDate.toLocaleString('pt-BR', { month: 'long' });

    return this.prisma.receivable.create({
      data: {
        clientId: subscription.clientId,
        description: `${subscription.description} (${monthLabel})`,
        amount: subscription.amount,
        dueDate,
        status: ReceivableStatus.PENDING,
      },
    });
  }
}
