import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClientStatus, Prisma, ReceivableStatus, Subscription, SubscriptionStatus } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

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

  // Só decide QUAIS assinaturas chamar generateCharge() agora — a criação da
  // cobrança em si (incluindo a proteção contra duplicidade via constraint
  // única) continua inteiramente em generateCharge(), sem duplicação.
  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;

    const dueSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        dueDay: { lte: currentDay },
        client: { status: { not: ClientStatus.INACTIVE } },
        receivables: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const subscription of dueSubscriptions) {
      try {
        await this.generateCharge(subscription.id);
        generated++;
      } catch (err) {
        // 409 = outra execução já gerou esta cobrança (corrida entre cron e
        // bootstrap, ou dois restarts próximos) — esperado, ignorado.
        if (!(err instanceof ConflictException)) {
          this.logger.error(
            `Falha ao gerar cobrança da assinatura ${subscription.id}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
    return { checked: dueSubscriptions.length, generated };
  }
}
