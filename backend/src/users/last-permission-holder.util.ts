import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Generaliza assertNotLastActiveAdmin (mesmo espírito, mesma trava por empresa via
// pg_advisory_xact_lock já feita pelo chamador) pra qualquer permissão — hoje só usado pra
// `usuarios.gerenciar`, a permissão cuja perda total travaria a empresa sem ninguém pra
// administrar acesso. `excludingUserId` é o usuário que está prestes a ser bloqueado/excluído/
// reatribuído — a contagem precisa simular o estado DEPOIS da ação, não o de agora.
export async function assertNotLastHolderOfPermission(
  tx: Prisma.TransactionClient,
  companyId: string,
  permissionCode: string,
  excludingUserId: string,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint as count
     FROM "User" u
     JOIN "ProfilePermission" pp ON pp."profileId" = u."profileId"
     WHERE u."companyId" = $1
       AND u.status = 'ACTIVE'
       AND u.id != $2
       AND pp."permissionCode" = $3`,
    companyId,
    excludingUserId,
    permissionCode,
  );
  if (Number(rows[0]?.count ?? 0) === 0) {
    throw new BadRequestException(
      'A empresa precisa ter pelo menos um login ativo com permissão para gerenciar usuários',
    );
  }
}
