import { Prisma } from '@prisma/client';
import { assertValidSchemaName, buildTenantSchemaName, generateCompanyId } from '../prisma/tenant-schema.util';

export type SchemaNameAvailabilityTx = Pick<Prisma.TransactionClient, 'company' | '$queryRaw'>;

const MAX_ATTEMPTS = 5;

// Chamado DENTRO do register(), depois do pg_advisory_xact_lock('tenant_provisioning') — cadastros
// são serializados globalmente, então "conferir livre → criar" não tem corrida. Como o sufixo do
// schema são os 8 finais do id, colisão de nome se resolve gerando OUTRO id. Confere também
// pg_namespace: um schema órfão (ex.: sobra de teste) com o mesmo nome faria o CREATE SCHEMA falhar.
export async function pickCompanyIdentity(
  tx: SchemaNameAvailabilityTx,
  sourceName: string,
  newId: () => string = generateCompanyId,
): Promise<{ companyId: string; schemaName: string }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const companyId = newId();
    const schemaName = buildTenantSchemaName(sourceName, companyId);
    assertValidSchemaName(schemaName);
    const takenByCompany = await tx.company.findUnique({ where: { schemaName }, select: { id: true } });
    if (takenByCompany) continue;
    const existing = await tx.$queryRaw<unknown[]>`SELECT 1 AS exists FROM pg_namespace WHERE nspname = ${schemaName}`;
    if (existing.length === 0) return { companyId, schemaName };
  }
  throw new Error(`Não foi possível escolher um nome de schema livre para "${sourceName}" após ${MAX_ATTEMPTS} tentativas`);
}
