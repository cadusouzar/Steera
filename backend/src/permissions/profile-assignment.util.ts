import { Prisma } from '@prisma/client';
import { deriveHasFullPontoAccessFromGrants, deriveModulesFromGrants } from './profile-signature.util';

/**
 * Recalcula e grava `modules`/`hasFullPontoAccess` de UM usuário a partir das permissões atuais do
 * seu perfil ATUAL (não troca `profileId` — isso é responsabilidade de quem chama, ver
 * `reassignUserProfile` abaixo), e revoga os refresh tokens ativos dele. Mesmo motivo que
 * `UsersService.block()` já revoga: um JWT já emitido continua carregando `modules`/permissões
 * antigas por até 15min — revogar força uma sessão nova mais cedo, não elimina a janela por
 * completo (mesmo tradeoff já aceito em outros lugares do projeto pra claims do token).
 *
 * Chamado tanto ao trocar o perfil de alguém quanto ao editar um perfil compartilhado (uma vez por
 * usuário afetado, DENTRO da mesma transação, sempre sequencialmente — nunca `Promise.all`, ver
 * Global Constraints do plano).
 */
export async function recomputeAndSaveUserAccess(
  tx: Pick<Prisma.TransactionClient, 'profilePermission' | 'user' | 'refreshToken'>,
  userId: string,
  profileId: string,
): Promise<void> {
  const grants = await tx.profilePermission.findMany({ where: { profileId } });
  const modules = deriveModulesFromGrants(grants);
  const hasFullPontoAccess = deriveHasFullPontoAccessFromGrants(grants);
  await tx.user.update({ where: { id: userId }, data: { modules, hasFullPontoAccess } });
  await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Troca o `profileId` de um usuário e recalcula `modules`/`hasFullPontoAccess` a partir do perfil
 * NOVO, na mesma transação. Não faz nenhuma checagem de autorização/trava — isso é
 * responsabilidade de quem chama (ver `UsersService.assignProfile`, Task 8), porque a trava de
 * último detentor depende de saber se o perfil ATUAL concedia `usuarios.gerenciar` e o novo não,
 * informação que só o chamador tem antes de invocar esta função.
 */
export async function reassignUserProfile(
  tx: Pick<Prisma.TransactionClient, 'profilePermission' | 'user' | 'refreshToken'>,
  userId: string,
  newProfileId: string,
): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { profileId: newProfileId } });
  await recomputeAndSaveUserAccess(tx, userId, newProfileId);
}
