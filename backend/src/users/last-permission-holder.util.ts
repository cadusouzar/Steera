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
  // Achado na validação final da task-9 (authorization-architecture): esta query rodava sem
  // qualificar o schema (`"User"`/`"ProfilePermission"` soltos, confiando no `search_path` da
  // conexão). SQL bruto (`$queryRawUnsafe`) nunca passa pela extensão de roteamento por tenant
  // deste projeto (mesma limitação já documentada em Custom Fields/schema-per-tenant) e, ao
  // contrário de uma chamada `.model.op()` — que o engine do Prisma sempre qualifica pelo schema
  // do PRÓPRIO client, nunca pelo `search_path` de runtime —, SQL bruto solto fica à mercê do
  // `search_path` que a conexão física tiver NO MOMENTO, o que sob PgBouncer em `pool_mode =
  // transaction` (ver backend/pgbouncer/pgbouncer.ini) não é garantido ser `public`: a mesma
  // entrada de banco do PgBouncer é compartilhada por TODOS os clients Prisma desta empresa
  // (central + todos os de tenant), então uma conexão física pode ter sido devolvida ao pool por
  // um client de TENANT com `search_path=tenant_x` ainda ativo. Reproduzido ao vivo rodando a
  // suíte e2e completa (nunca isolado — só aparece sob o volume de conexões/schemas trocando de
  // mão da suíte inteira): `PATCH .../block` e `DELETE .../users/:id` falhavam com 500
  // ("relação User não existe") sempre que a transação central deste arquivo acabava herdando uma
  // conexão cujo search_path apontava pra um schema de tenant. `User`/`ProfilePermission` são
  // tabelas CENTRAIS (só existem em `public`) — qualificar o schema aqui explicitamente resolve
  // na raiz, sem depender de nenhum chamador lembrar de reemitir `SET LOCAL search_path`.
  // Achado crítico (C2) na revisão final da branch: a contagem abaixo rodava INCONDICIONALMENTE,
  // mesmo quando o alvo não detinha a permissão protegida. Duas consequências reais (não latentes):
  // (1) antes de `UsersService.create()` passar a atribuir perfil e do backfill rodar, NINGUÉM
  // detém permissão nenhuma por este join — a contagem dava sempre 0 e block()/remove() rejeitavam
  // TODA ação de TODA empresa; (2) mesmo depois, bloquear um login EMPLOYEE (que nunca detém
  // `usuarios.gerenciar`) batia neste guard sem motivo. Remover quem nunca deteve a permissão não
  // pode reduzir o conjunto de detentores — então a checagem é um no-op nesse caso, e a contagem
  // (mais cara) nem chega a rodar.
  const targetHoldsIt = await tx.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM "public"."User" u
       JOIN "public"."ProfilePermission" pp ON pp."profileId" = u."profileId"
       WHERE u.id = $1 AND pp."permissionCode" = $2
     ) as exists`,
    excludingUserId,
    permissionCode,
  );
  if (!targetHoldsIt[0]?.exists) return;

  const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint as count
     FROM "public"."User" u
     JOIN "public"."ProfilePermission" pp ON pp."profileId" = u."profileId"
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

/**
 * Variante de `assertNotLastHolderOfPermission` para quando MÚLTIPLOS usuários perdem a permissão
 * SIMULTANEAMENTE por causa da edição de um Perfil compartilhado (não de uma ação individual sobre
 * UM usuário) — ver ProfilesService.update()/reassignAndDelete(). A pergunta certa aqui não é
 * "excluindo este usuário, sobra alguém?" (não faz sentido quando TODOS os usuários daquele
 * perfil perdem a permissão ao mesmo tempo) — é "existe algum usuário ativo, em QUALQUER OUTRO
 * perfil, que ainda concede esta permissão?". Filtra por `profileId`, não pela existência atual de
 * uma linha — por isso funciona corretamente rodando ANTES ou DEPOIS da reescrita das
 * `ProfilePermission` do perfil sendo editado (ao contrário de `assertNotLastHolderOfPermission`,
 * que depende de rodar ANTES por causa do seu próprio pré-check `targetHoldsIt`).
 *
 * Achado real (revisão de segurança pós-Task 4, ver task-4-report.md "Rodada de correção"):
 * `assertNotLastHolderOfPermission`, chamada uma vez por usuário afetado ANTES da reescrita em
 * lote das `ProfilePermission` do perfil, sempre enxergava os OUTROS usuários do mesmo perfil como
 * "ainda detentores" (a reescrita ainda não tinha rodado), deixando passar um lote que zerava por
 * completo os detentores da empresa assim que a reescrita de fato acontecia. Reordenar a chamada
 * pra DEPOIS da reescrita também não resolve — o pré-check `targetHoldsIt` daquela função passaria
 * a ver o próprio alvo como não-detentor (o perfil dele já não concede mais nada) e virar um no-op
 * silencioso pra todos, pior que o bug original. Esta função não sofre de nenhum dos dois problemas
 * porque nunca olha pra uma linha específica de um usuário — sempre pergunta pelo `profileId` sendo
 * editado como um todo, contra todos os OUTROS perfis da empresa.
 */
export async function assertOtherProfileGrantsPermission(
  tx: Prisma.TransactionClient,
  companyId: string,
  permissionCode: string,
  excludingProfileId: string,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint as count
     FROM "public"."User" u
     JOIN "public"."ProfilePermission" pp ON pp."profileId" = u."profileId"
     WHERE u."companyId" = $1
       AND u.status = 'ACTIVE'
       AND u."profileId" != $2
       AND pp."permissionCode" = $3`,
    companyId,
    excludingProfileId,
    permissionCode,
  );
  if (Number(rows[0]?.count ?? 0) === 0) {
    throw new BadRequestException(
      'A empresa precisa ter pelo menos um login ativo com permissão para gerenciar usuários',
    );
  }
}

/**
 * Variante de `assertNotLastHolderOfPermission` (ação de UM usuário só — exclui aquele usuário, não
 * o perfil inteiro) para o acesso total ao Controle de Ponto. Par de
 * `assertOtherAdminGrantsFullPontoAccess` logo abaixo, que é a variante de LOTE.
 *
 * **Por que as duas existem, e por que usar a errada aqui é um bug de verdade (achado ao rodar a
 * suíte e2e completa desta rodada de correção, 22/09/2026):** a brief desta correção mandava usar a
 * variante de LOTE (que exclui o `profileId` inteiro) também em `UsersService.assignProfile()`.
 * Isso é estrito DEMAIS pro caso de um usuário só: excluir o perfil inteiro descarta da contagem os
 * OUTROS ADMINs que compartilham aquele mesmo perfil e que NÃO estão sendo movidos — eles continuam
 * com acesso total depois da ação, mas a checagem fingia que não. Consequência real, não hipotética:
 * mover UM admin pra fora do "Administrador Geral" compartilhado passava a ser rejeitado com 400
 * mesmo com outros 5 admins intactos naquele mesmo perfil (reproduzido por
 * `test/profiles.e2e-spec.ts`, que passava antes e quebrou com a versão da brief). A pergunta certa
 * pra uma ação individual é sempre "tirando ESTE usuário, sobra algum ADMIN ativo com acesso
 * total?" — exatamente o que esta função pergunta.
 */
export async function assertNotLastAdminWithFullPontoAccess(
  tx: Prisma.TransactionClient,
  companyId: string,
  excludingUserId: string,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint as count
     FROM "public"."User" u
     JOIN "public"."ProfilePermission" pp ON pp."profileId" = u."profileId"
     WHERE u."companyId" = $1
       AND u.status = 'ACTIVE'
       AND u.role = 'ADMIN'
       AND u.id != $2
       AND pp."permissionCode" = 'ponto.administrar'
       AND pp.scope = 'EMPRESA'`,
    companyId,
    excludingUserId,
  );
  if (Number(rows[0]?.count ?? 0) === 0) {
    throw new BadRequestException(
      'A empresa precisa manter pelo menos um login ADMIN com acesso total ao Controle de Ponto',
    );
  }
}

/**
 * Variante de `assertOtherProfileGrantsPermission` especificamente para o acesso total ao Controle
 * de Ponto (`hasFullPontoAccess`, agora derivado do Perfil via `ponto.administrar@EMPRESA`, nunca
 * mais um campo editado direto — ver `PATCH .../ponto-access`, removido). Só ADMIN importa aqui
 * (`effectiveHasFullPontoAccess`/`deriveHasFullPontoAccessFromGrants` já tratam EMPLOYEE como
 * sempre `false`, por definição) — por isso o filtro `u.role = 'ADMIN'` explícito, diferente da
 * variante genérica de permissão.
 */
export async function assertOtherAdminGrantsFullPontoAccess(
  tx: Prisma.TransactionClient,
  companyId: string,
  excludingProfileId: string,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint as count
     FROM "public"."User" u
     JOIN "public"."ProfilePermission" pp ON pp."profileId" = u."profileId"
     WHERE u."companyId" = $1
       AND u.status = 'ACTIVE'
       AND u.role = 'ADMIN'
       AND u."profileId" != $2
       AND pp."permissionCode" = 'ponto.administrar'
       AND pp.scope = 'EMPRESA'`,
    companyId,
    excludingProfileId,
  );
  if (Number(rows[0]?.count ?? 0) === 0) {
    throw new BadRequestException(
      'A empresa precisa manter pelo menos um login ADMIN com acesso total ao Controle de Ponto',
    );
  }
}
