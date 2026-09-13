import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientTrashService {
  private readonly logger = new Logger(ClientTrashService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredTrashCron() {
    try {
      const count = await this.purgeExpiredTrash();
      if (count > 0) this.logger.log(`Purged ${count} client(s) from the trash`);
    } catch (err) {
      this.logger.error('Failed to purge expired client trash', err instanceof Error ? err.stack : String(err));
    }
  }

  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const result = await this.prisma.client.deleteMany({
      where: {
        status: ClientStatus.INACTIVE,
        includeInRevenueReport: false,
        deactivatedAt: { lt: cutoff },
      },
    });
    return result.count;
  }
}
