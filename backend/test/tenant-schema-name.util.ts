import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';

// Desde 25/09/2026 o schema não é mais `tenant_<id>` pra empresa nova — sempre ler da coluna.
// Use ANTES de apagar a Company no afterAll (o DROP SCHEMA precisa do nome).
export async function getTenantSchemaName(prisma: PrismaService, companyId: string): Promise<string> {
  const company = await runAsSystem(() =>
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { schemaName: true } }),
  );
  return company.schemaName;
}
