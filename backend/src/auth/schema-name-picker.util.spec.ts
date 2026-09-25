import { pickCompanyIdentity } from './schema-name-picker.util';

function fakeTx(taken: Set<string>) {
  return {
    company: { findUnique: jest.fn(async ({ where }: any) => (taken.has(where.schemaName) ? { id: 'x' } : null)) },
    $queryRaw: jest.fn(async (): Promise<unknown[]> => []),
  };
}

const ID_A = 'cxxxxxxxxxxxxxxxxaaaaaaaa';
const ID_B = 'cxxxxxxxxxxxxxxxxbbbbbbbb';

describe('pickCompanyIdentity', () => {
  it('usa o primeiro id cujo schema está livre', async () => {
    const tx = fakeTx(new Set());
    expect(await pickCompanyIdentity(tx as any, 'Padaria Central', () => ID_A)).toEqual({
      companyId: ID_A,
      schemaName: 'padaria_central_aaaaaaaa',
    });
  });

  it('gera outro id quando o nome já está em uso', async () => {
    const tx = fakeTx(new Set(['padaria_central_aaaaaaaa']));
    const ids = [ID_A, ID_B];
    expect(await pickCompanyIdentity(tx as any, 'Padaria Central', () => ids.shift()!)).toEqual({
      companyId: ID_B,
      schemaName: 'padaria_central_bbbbbbbb',
    });
  });

  it('considera ocupado um schema que existe no Postgres mesmo sem Company', async () => {
    const tx = fakeTx(new Set());
    tx.$queryRaw.mockResolvedValueOnce([{ exists: 1 }]);
    const ids = [ID_A, ID_B];
    expect((await pickCompanyIdentity(tx as any, 'Loja', () => ids.shift()!)).schemaName).toBe('loja_bbbbbbbb');
  });

  it('desiste depois de 5 tentativas', async () => {
    const tx = fakeTx(new Set(['loja_aaaaaaaa']));
    await expect(pickCompanyIdentity(tx as any, 'Loja', () => ID_A)).rejects.toThrow(/schema/);
  });
});
