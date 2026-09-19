import { PrismaClient } from '@prisma/client';
import { computeProfileSignature, getOrCreateProfileForSignature } from '../src/permissions/profile-signature.util';

// `computeProfileSignature`/`MODULE_TO_PERMISSIONS`/`ProfileSignature` moraram aqui até a revisão
// final da branch de authorization-architecture (18/09/2026). Foram movidos pra
// `src/permissions/profile-signature.util.ts` porque deixaram de ser exclusivos do backfill:
// `UsersService.create()` usa exatamente a mesma derivação pra dar um `Profile` a todo login novo
// criado por um admin (sem isso, todo login criado pela tela de Usuários ficava com
// `permissions: {}` pra sempre — e invisível pra trava do último detentor de `usuarios.gerenciar`).
// Este script segue sendo o caminho de cutover das empresas que já existiam antes do plano.

async function main() {
  const prisma = new PrismaClient();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.rls_bypass', 'on', true)");
    const users = await tx.user.findMany({ where: { profileId: null } });
    const profileIds = new Set<string>();

    for (const user of users) {
      const signature = computeProfileSignature(user);
      // Dedup agora é pelo próprio banco (ver getOrCreateProfileForSignature) em vez de um cache em
      // memória zerado a cada execução — assim o "Administrador Geral" que `register()` já criou pro
      // fundador é reaproveitado, nunca duplicado.
      const profileId = await getOrCreateProfileForSignature(tx, user.companyId, signature);
      profileIds.add(profileId);
      await tx.user.update({ where: { id: user.id }, data: { profileId } });
    }

    console.log(`Backfill concluído: ${users.length} usuários, ${profileIds.size} perfis criados/reaproveitados.`);
  });
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
