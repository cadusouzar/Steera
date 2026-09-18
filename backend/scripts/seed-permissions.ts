import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOG } from '../src/permissions/permission-catalog';

async function main() {
  const prisma = new PrismaClient();
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: { code: p.code, resource: p.resource, action: p.action, labelPt: p.labelPt, validScopes: p.validScopes },
      update: { resource: p.resource, action: p.action, labelPt: p.labelPt, validScopes: p.validScopes },
    });
  }
  console.log(`Seed de permissões concluído: ${PERMISSION_CATALOG.length} entradas.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
