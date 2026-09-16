import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../prisma/tenant-context';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { assertValidSchemaName, tenantSchemaName } from '../prisma/tenant-schema.util';
import { listMigrationNames } from '../prisma/migration-files.util';
import { applyMigrations } from '../prisma/tenant-migration.util';

// process.cwd(), não __dirname — mesmo motivo documentado em auth.service.ts (Task 7): __dirname
// aponta pra dentro de `dist/` depois de compilado, onde `prisma/` não existe.
const TENANT_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'tenant-migrations');

// Mesmo padrão já usado em BillingSchedulerService/ClientTrashService: itera toda Company (tabela
// central, sem RLS, não precisa de contexto de tenant pra ser lida) e processa uma por uma. Aqui,
// "processar" significa "aplicar as migrations de TENANT (prisma/tenant-migrations/, não o
// histórico principal — ver Task 3) que essa empresa ainda não tem" — nenhuma migration nova
// precisa ser rodada manualmente empresa por empresa depois de um deploy.
@Injectable()
export class TenantMigrationManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantMigrationManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.applyPendingMigrationsToAllTenants();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCron() {
    await this.applyPendingMigrationsToAllTenants();
  }

  async applyPendingMigrationsToAllTenants(): Promise<void> {
    const allMigrations = listMigrationNames(TENANT_MIGRATIONS_DIR);
    const companies = await this.prisma.company.findMany({ select: { id: true } });

    for (const company of companies) {
      try {
        await runWithTenant(company.id, async () => {
          const applied = await this.prisma.tenantMigration.findMany({
            where: { companyId: company.id },
            select: { migrationName: true },
          });
          const appliedSet = new Set(applied.map((a) => a.migrationName));
          const pending = allMigrations.filter((name) => !appliedSet.has(name));
          if (pending.length === 0) return;

          const schemaName = tenantSchemaName(company.id);
          assertValidSchemaName(schemaName);
          // runTenantInteractiveTransaction (não um `this.prisma.$transaction` cru) é obrigatório
          // aqui: ele lê o companyId já ativo no AsyncLocalStorage (posto pelo `runWithTenant`
          // acima) e define `SET LOCAL search_path`/`set_config` automaticamente como parte da
          // MESMA transação, além de marcar o contexto como `insideExplicitTx` — sem isso, cada
          // chamada de model dentro de `applyMigrations` (ex.: `tx.tenantMigration.create(...)`)
          // passaria de novo pelo hook da extensão, que tentaria abrir uma SEGUNDA transação
          // aninhada usando o client base em vez de `tx`, quebrando a atomicidade (mesma
          // armadilha já documentada em tenant-rls.extension.ts).
          await runTenantInteractiveTransaction(this.prisma, async (tx) => {
            await applyMigrations(tx, company.id, schemaName, TENANT_MIGRATIONS_DIR, pending);
          });
        });
      } catch (err) {
        this.logger.error(
          `Falha ao aplicar migrations de tenant pendentes na empresa ${company.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
