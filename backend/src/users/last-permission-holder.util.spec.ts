import { BadRequestException } from '@nestjs/common';
import { assertNotLastHolderOfPermission } from './last-permission-holder.util';

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
