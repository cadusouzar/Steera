import { BadRequestException } from '@nestjs/common';
import {
  assertNotLastAdminWithFullPontoAccess,
  assertNotLastHolderOfPermission,
  assertOtherAdminGrantsFullPontoAccess,
  assertOtherProfileGrantsPermission,
} from './last-permission-holder.util';

// Estes testes inspecionam o TEXTO do SQL e a ORDEM dos parâmetros de propósito. A versão anterior
// só mockava `$queryRawUnsafe` devolvendo um valor e afirmava sobre ele — foi exatamente por isso
// que TRÊS bugs reais e distintos passaram por este arquivo em três rodadas seguidas com a suíte
// mockada 100% verde: schema não qualificado (quebrava sob PgBouncer em pool_mode=transaction),
// binding de parâmetro trocado, e a checagem incondicional corrigida nesta rodada.
describe('assertNotLastHolderOfPermission', () => {
  function makeTx(...results: unknown[]) {
    const fn = jest.fn();
    for (const r of results) fn.mockResolvedValueOnce(r);
    return { $queryRawUnsafe: fn };
  }

  it('não lança quando outro login ativo ainda detém a permissão', async () => {
    const tx = makeTx([{ exists: true }], [{ count: 2n }]);
    await expect(
      assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1'),
    ).resolves.toBeUndefined();
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('lança quando excluir este login deixaria zero detentores', async () => {
    const tx = makeTx([{ exists: true }], [{ count: 0n }]);
    await expect(
      assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('é um no-op quando o próprio alvo não detém a permissão — a contagem nem chega a rodar', async () => {
    const tx = makeTx([{ exists: false }]);
    await expect(
      assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1'),
    ).resolves.toBeUndefined();
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('é um no-op quando a consulta de existência volta vazia (defesa contra linha ausente)', async () => {
    const tx = makeTx([]);
    await expect(
      assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1'),
    ).resolves.toBeUndefined();
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  describe('SQL emitido', () => {
    it('a consulta de existência qualifica o schema e recebe (userId, permissionCode) nessa ordem', async () => {
      const tx = makeTx([{ exists: true }], [{ count: 5n }]);
      await assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1');

      const [sql, ...params] = tx.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"public"."User"');
      expect(sql).toContain('"public"."ProfilePermission"');
      expect(sql).toContain('EXISTS');
      // Ordem dos binds: $1 = id do usuário-alvo, $2 = código da permissão.
      expect(params).toEqual(['user-1', 'usuarios.gerenciar']);
      expect(sql.indexOf('u.id = $1')).toBeGreaterThan(-1);
      expect(sql.indexOf('pp."permissionCode" = $2')).toBeGreaterThan(-1);
    });

    it('a consulta de contagem qualifica o schema e recebe (companyId, excludingUserId, permissionCode) nessa ordem', async () => {
      const tx = makeTx([{ exists: true }], [{ count: 5n }]);
      await assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1');

      const [sql, ...params] = tx.$queryRawUnsafe.mock.calls[1];
      expect(sql).toContain('"public"."User"');
      expect(sql).toContain('"public"."ProfilePermission"');
      expect(params).toEqual(['company-1', 'user-1', 'usuarios.gerenciar']);
      expect(sql).toContain('u."companyId" = $1');
      expect(sql).toContain('u.id != $2');
      expect(sql).toContain('pp."permissionCode" = $3');
      // Só conta logins ATIVOS — um login bloqueado não segura o invariante.
      expect(sql).toContain("u.status = 'ACTIVE'");
    });

    it('nenhuma das duas consultas usa tabela sem qualificação de schema (regressão de PgBouncer)', async () => {
      const tx = makeTx([{ exists: true }], [{ count: 5n }]);
      await assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1');
      for (const call of tx.$queryRawUnsafe.mock.calls) {
        const sql = call[0] as string;
        expect(sql).not.toMatch(/FROM\s+"User"/);
        expect(sql).not.toMatch(/JOIN\s+"ProfilePermission"/);
      }
    });
  });
});

// Adicionada na rodada de correção de segurança da Task 4 (authorization-profiles-screen): a
// versão original de ProfilesService.update() chamava `assertNotLastHolderOfPermission` uma vez
// POR USUÁRIO afetado ANTES de reescrever as ProfilePermission do perfil editado — cada chamada
// via os OUTROS usuários do MESMO perfil ainda "detentores" (a reescrita em lote ainda não tinha
// acontecido), deixando passar um lote que zerava por completo os detentores ativos da empresa
// assim que a reescrita de fato rodava. Reordenar (reescrever primeiro, checar depois) também não
// resolve — o pré-check `targetHoldsIt` de `assertNotLastHolderOfPermission` passaria a ver o
// próprio alvo como não-detentor e virar um no-op silencioso pra todos. Esta função pergunta a
// coisa certa pro caso de "todos os usuários de UM perfil perdem a permissão ao mesmo tempo":
// existe algum usuário ativo, em QUALQUER OUTRO perfil, que ainda concede a permissão? — por isso
// funciona corretamente rodando antes OU depois da reescrita.
describe('assertOtherProfileGrantsPermission', () => {
  function makeTx(...results: unknown[]) {
    const fn = jest.fn();
    for (const r of results) fn.mockResolvedValueOnce(r);
    return { $queryRawUnsafe: fn };
  }

  it('não lança quando outro perfil ainda concede a permissão a um login ativo', async () => {
    const tx = makeTx([{ count: 1n }]);
    await expect(
      assertOtherProfileGrantsPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'profile-1'),
    ).resolves.toBeUndefined();
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('lança BadRequestException quando nenhum outro perfil concede a permissão', async () => {
    const tx = makeTx([{ count: 0n }]);
    await expect(
      assertOtherProfileGrantsPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'profile-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('trata a consulta vazia (defesa contra linha ausente) como zero detentores — lança', async () => {
    const tx = makeTx([]);
    await expect(
      assertOtherProfileGrantsPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'profile-1'),
    ).rejects.toThrow(BadRequestException);
  });

  describe('SQL emitido', () => {
    it('qualifica o schema, filtra por profileId (não por usuário) e recebe os binds na ordem certa', async () => {
      const tx = makeTx([{ count: 5n }]);
      await assertOtherProfileGrantsPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'profile-1');

      const [sql, ...params] = tx.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"public"."User"');
      expect(sql).toContain('"public"."ProfilePermission"');
      // Binds: $1 = companyId, $2 = profileId excluído, $3 = permissionCode.
      expect(params).toEqual(['company-1', 'profile-1', 'usuarios.gerenciar']);
      expect(sql).toContain('u."companyId" = $1');
      expect(sql).toContain('u."profileId" != $2');
      expect(sql).toContain('pp."permissionCode" = $3');
      // Só conta logins ATIVOS — um login bloqueado não segura o invariante.
      expect(sql).toContain("u.status = 'ACTIVE'");
    });

    it('não usa tabela sem qualificação de schema (regressão de PgBouncer, mesma classe de bug já corrigida em assertNotLastHolderOfPermission)', async () => {
      const tx = makeTx([{ count: 5n }]);
      await assertOtherProfileGrantsPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'profile-1');
      const sql = tx.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(sql).not.toMatch(/FROM\s+"User"/);
      expect(sql).not.toMatch(/JOIN\s+"ProfilePermission"/);
    });
  });
});

// Adicionada na revisão final da branch (Fase 2a, 22/09/2026): remover `PATCH .../ponto-access`
// apagou junto o invariante "a empresa nunca fica sem NENHUM ADMIN de acesso total ao Ponto".
// Como `hasFullPontoAccess` passou a ser DERIVADO do Perfil (`ponto.administrar` com scope
// `EMPRESA`), o invariante precisa ser reexpresso em cima de `ProfilePermission` — e, ao contrário
// da variante genérica, só ADMIN conta (um EMPLOYEE nunca tem acesso total, por definição).
describe('assertOtherAdminGrantsFullPontoAccess', () => {
  function makeTx(...results: unknown[]) {
    const fn = jest.fn();
    for (const r of results) fn.mockResolvedValueOnce(r);
    return { $queryRawUnsafe: fn };
  }

  it('não lança quando outro ADMIN ativo, em outro perfil, ainda tem ponto.administrar@EMPRESA', async () => {
    const tx = makeTx([{ count: 1n }]);
    await expect(
      assertOtherAdminGrantsFullPontoAccess(tx as any, 'company-1', 'profile-1'),
    ).resolves.toBeUndefined();
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('lança BadRequestException quando nenhum outro perfil dá acesso total a um ADMIN ativo', async () => {
    const tx = makeTx([{ count: 0n }]);
    await expect(
      assertOtherAdminGrantsFullPontoAccess(tx as any, 'company-1', 'profile-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('a mensagem fala de acesso total ao Ponto (não de gerenciar usuários)', async () => {
    const tx = makeTx([{ count: 0n }]);
    await expect(
      assertOtherAdminGrantsFullPontoAccess(tx as any, 'company-1', 'profile-1'),
    ).rejects.toThrow(/acesso total ao Controle de Ponto/);
  });

  it('trata a consulta vazia (defesa contra linha ausente) como zero detentores — lança', async () => {
    const tx = makeTx([]);
    await expect(
      assertOtherAdminGrantsFullPontoAccess(tx as any, 'company-1', 'profile-1'),
    ).rejects.toThrow(BadRequestException);
  });

  describe('SQL emitido', () => {
    it('qualifica o schema, filtra por ADMIN/ACTIVE/scope EMPRESA e recebe os binds na ordem certa', async () => {
      const tx = makeTx([{ count: 3n }]);
      await assertOtherAdminGrantsFullPontoAccess(tx as any, 'company-1', 'profile-1');

      const [sql, ...params] = tx.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"public"."User"');
      expect(sql).toContain('"public"."ProfilePermission"');
      // Binds: $1 = companyId, $2 = profileId excluído. O permissionCode é literal aqui (esta
      // função existe só para `ponto.administrar`), diferente da variante genérica.
      expect(params).toEqual(['company-1', 'profile-1']);
      expect(sql).toContain('u."companyId" = $1');
      expect(sql).toContain('u."profileId" != $2');
      expect(sql).toContain("u.status = 'ACTIVE'");
      // Diferença central em relação a assertOtherProfileGrantsPermission: só ADMIN conta.
      expect(sql).toContain("u.role = 'ADMIN'");
      expect(sql).toContain("pp.\"permissionCode\" = 'ponto.administrar'");
      expect(sql).toContain("pp.scope = 'EMPRESA'");
    });

    it('não usa tabela sem qualificação de schema (regressão de PgBouncer)', async () => {
      const tx = makeTx([{ count: 3n }]);
      await assertOtherAdminGrantsFullPontoAccess(tx as any, 'company-1', 'profile-1');
      const sql = tx.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(sql).not.toMatch(/FROM\s+"User"/);
      expect(sql).not.toMatch(/JOIN\s+"ProfilePermission"/);
    });
  });
});

// Par de UM USUÁRIO da função acima (ver o comentário longo no .ts). A distinção não é cosmética:
// usar a variante de LOTE numa ação individual descarta da contagem os OUTROS admins do MESMO
// perfil que não estão sendo movidos — o que quebrou `test/profiles.e2e-spec.ts` (verde antes,
// vermelho depois) rejeitando com 400 uma reatribuição individual perfeitamente segura.
describe('assertNotLastAdminWithFullPontoAccess', () => {
  function makeTx(...results: unknown[]) {
    const fn = jest.fn();
    for (const r of results) fn.mockResolvedValueOnce(r);
    return { $queryRawUnsafe: fn };
  }

  it('não lança quando outro ADMIN ativo (mesmo que no MESMO perfil) ainda tem acesso total', async () => {
    const tx = makeTx([{ count: 1n }]);
    await expect(
      assertNotLastAdminWithFullPontoAccess(tx as any, 'company-1', 'user-1'),
    ).resolves.toBeUndefined();
  });

  it('lança BadRequestException quando este é o último ADMIN de acesso total', async () => {
    const tx = makeTx([{ count: 0n }]);
    await expect(
      assertNotLastAdminWithFullPontoAccess(tx as any, 'company-1', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('trata a consulta vazia (defesa contra linha ausente) como zero detentores — lança', async () => {
    const tx = makeTx([]);
    await expect(
      assertNotLastAdminWithFullPontoAccess(tx as any, 'company-1', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  describe('SQL emitido', () => {
    it('exclui pelo ID DO USUÁRIO (u.id != $2), nunca pelo profileId — a diferença central', async () => {
      const tx = makeTx([{ count: 3n }]);
      await assertNotLastAdminWithFullPontoAccess(tx as any, 'company-1', 'user-1');

      const [sql, ...params] = tx.$queryRawUnsafe.mock.calls[0];
      expect(params).toEqual(['company-1', 'user-1']);
      expect(sql).toContain('u.id != $2');
      expect(sql).not.toContain('u."profileId" != $2');
      expect(sql).toContain('"public"."User"');
      expect(sql).toContain('"public"."ProfilePermission"');
      expect(sql).toContain("u.status = 'ACTIVE'");
      expect(sql).toContain("u.role = 'ADMIN'");
      expect(sql).toContain("pp.\"permissionCode\" = 'ponto.administrar'");
      expect(sql).toContain("pp.scope = 'EMPRESA'");
    });

    it('não usa tabela sem qualificação de schema (regressão de PgBouncer)', async () => {
      const tx = makeTx([{ count: 3n }]);
      await assertNotLastAdminWithFullPontoAccess(tx as any, 'company-1', 'user-1');
      const sql = tx.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(sql).not.toMatch(/FROM\s+"User"/);
      expect(sql).not.toMatch(/JOIN\s+"ProfilePermission"/);
    });
  });
});
