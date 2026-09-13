import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientStatus, Prisma, ReceivableStatus, Subscription } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private async ensureClientExists(clientId: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const client = await this.prisma.client.findFirst({ where: { id: clientId, companyId } });
    if (!client) throw new NotFoundException(`Cliente ${clientId} não encontrado`);
  }

  private async assertExists(id: string): Promise<Subscription> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const found = await this.prisma.subscription.findFirst({ where: { id, client: { companyId } } });
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
    const client = await this.prisma.client.findUnique({ where: { id: subscription.clientId } });
    if (client?.status === ClientStatus.INACTIVE) {
      throw new BadRequestException(`Não é possível gerar fatura para o cliente ${subscription.clientId}: cliente inativo`);
    }
    const now = new Date();
    // UTC midnight to match how `@db.Date` values are stored/read everywhere else
    // (see startOfToday/parseDateOnly in receivables.service.ts).
    const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), subscription.dueDay));
    // Label comes from the CURRENT month, mirroring the frontend
    // (src/pages/app/ClientsList.tsx, handleGenerateSubscriptionCharge) — a dueDay
    // of 29-31 can roll `dueDate` into the next month, which must not change the label.
    const monthLabel = now.toLocaleString('pt-BR', { month: 'long' });
    const referenceYear = now.getFullYear();
    const referenceMonth = now.getMonth() + 1; // 1-12, matches getMonth()'s use above

    try {
      return await this.prisma.receivable.create({
        data: {
          clientId: subscription.clientId,
          subscriptionId: subscription.id,
          referenceYear,
          referenceMonth,
          description: `${subscription.description} (${monthLabel})`,
          amount: subscription.amount,
          dueDate,
          status: ReceivableStatus.PENDING,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation on (subscriptionId, referenceYear, referenceMonth).
      // Caught here (not pre-checked with a SELECT) so a race between two concurrent
      // requests for the same subscription/month is still rejected by the database
      // itself, not just by an application-level check that could lose the race.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe uma fatura gerada para esta assinatura neste mês.');
      }
      throw err;
    }
  }
}
