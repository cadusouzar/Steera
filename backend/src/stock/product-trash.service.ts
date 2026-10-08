import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../prisma/tenant-context';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { lockProduct } from './stock-movements.service';
import { TRASH_RETENTION_DAYS } from './products.service';

// Fim do prazo da lixeira de produtos (30 dias). Diferente da lixeira de clientes, NUNCA apaga quem
// tem histórico: produto com movimentações vira "arquivado permanente" (registro preservado para o
// histórico e os relatórios); só produto sem nenhuma movimentação é excluído de verdade, junto da
// foto que era só dele. Mesma infraestrutura da lixeira de clientes: cron das 3h por empresa (com
// runWithTenant, senão o RLS devolveria zero linhas em silêncio) + execução ao abrir a lixeira.
@Injectable()
export class ProductTrashService {
  private readonly logger = new Logger(ProductTrashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async processExpiredTrashCron() {
    const companies = await this.prisma.company.findMany({ select: { id: true, name: true } });
    let deleted = 0;
    let archived = 0;
    for (const company of companies) {
      try {
        const result = await runWithTenant(company.id, () => this.processExpiredTrash(company.id));
        deleted += result.deleted;
        archived += result.archived;
      } catch (err) {
        this.logger.error(
          `Falha ao processar a lixeira de produtos da empresa ${company.name}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    if (deleted + archived > 0) {
      this.logger.log(`Lixeira de produtos: ${deleted} excluído(s) definitivamente, ${archived} arquivado(s)`);
    }
  }

  // Precisa rodar com o contexto de tenant da empresa já estabelecido (requisição autenticada ou
  // runWithTenant no cron).
  async processExpiredTrash(companyId: string): Promise<{ deleted: number; archived: number }> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.product.findMany({
      where: { companyId, trashedAt: { lt: cutoff }, archivedAt: null },
      select: { id: true },
    });
    let deleted = 0;
    let archived = 0;
    for (const { id } of expired) {
      // Sob a trava do produto: uma restauração simultânea ou um envio já desfeito são relidos aqui.
      const outcome = await runTenantInteractiveTransaction(this.prisma, async (tx) => {
        const product = await lockProduct(tx, companyId, id);
        if (!product.trashedAt || product.archivedAt || product.trashedAt >= cutoff) return null;
        const movementCount = await tx.stockMovement.count({ where: { productId: id } });
        if (movementCount === 0) {
          await tx.product.delete({ where: { id } });
          return { kind: 'deleted' as const, photoAssetId: product.photoAssetId };
        }
        await tx.product.update({ where: { id }, data: { archivedAt: new Date() } });
        return { kind: 'archived' as const, photoAssetId: null };
      });
      if (outcome?.kind === 'deleted') {
        deleted += 1;
        if (outcome.photoAssetId) await this.files.deleteAsset(outcome.photoAssetId, companyId);
      }
      if (outcome?.kind === 'archived') archived += 1;
    }
    return { deleted, archived };
  }
}
