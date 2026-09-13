import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../prisma/tenant-context';

@Injectable()
export class ClientTrashService {
  private readonly logger = new Logger(ClientTrashService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Runs from a @Cron job — no HTTP request, no req.user, no tenant context
  // of any kind by default. Same failure mode already fixed in
  // BillingSchedulerService: since the RLS backstop's "no tenant context =
  // see/write nothing" default now applies to Client, purgeExpiredTrash()
  // called with no context would silently delete zero rows, every day,
  // forever, with no error at all (deleteMany returns count: 0, not an
  // exception) — breaking the documented 30-day physical-purge retention
  // policy for every company. Iterating every Company and establishing a
  // tenant context per company before purging fixes it, mirroring
  // BillingSchedulerService.runCatchUp exactly.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredTrashCron() {
    const companies = await this.prisma.company.findMany({ select: { id: true, name: true } });
    let totalPurged = 0;
    for (const company of companies) {
      try {
        const count = await runWithTenant(company.id, () => this.purgeExpiredTrash());
        totalPurged += count;
      } catch (err) {
        this.logger.error(
          `Failed to purge expired client trash for company ${company.name}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    if (totalPurged > 0) this.logger.log(`Purged ${totalPurged} client(s) from the trash across ${companies.length} company(ies)`);
  }

  // Called two ways: (1) from purgeExpiredTrashCron above, already wrapped in
  // runWithTenant per company; (2) from ClientsService.findTrash(), which
  // runs inside a real authenticated HTTP request — TenantContextInterceptor
  // has already established that request's own tenant context by the time
  // this runs, so the query below is scoped to the calling company either
  // way, via the same RLS session variable every other request-driven query
  // in the app relies on. This method itself never filters by companyId —
  // it relies entirely on whichever tenant context its caller established.
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
