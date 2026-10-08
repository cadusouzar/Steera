import { Prisma } from '@prisma/client';
import { stockSituationOf } from './stock-situation.util';

const base = { status: 'ACTIVE' as const, trashedAt: null, archivedAt: null };
const d = (v: string) => new Prisma.Decimal(v);

describe('stockSituationOf', () => {
  it('saldo zero é esgotado, mesmo com mínimo configurado', () => {
    expect(stockSituationOf({ ...base, balance: d('0'), minStock: d('5') })).toBe('OUT_OF_STOCK');
  });
  it('saldo positivo até o mínimo é baixo', () => {
    expect(stockSituationOf({ ...base, balance: d('5'), minStock: d('5') })).toBe('LOW');
  });
  it('sem mínimo não alerta', () => {
    expect(stockSituationOf({ ...base, balance: d('1'), minStock: null })).toBe('NO_MIN_ALERT');
  });
  it('acima do mínimo é normal', () => {
    expect(stockSituationOf({ ...base, balance: d('6'), minStock: d('5') })).toBe('NORMAL');
  });
  it('inativo, na lixeira ou arquivado não entra em situação', () => {
    expect(stockSituationOf({ ...base, status: 'INACTIVE', balance: d('0'), minStock: d('1') })).toBe('NOT_APPLICABLE');
    expect(stockSituationOf({ ...base, trashedAt: new Date(), balance: d('0'), minStock: null })).toBe('NOT_APPLICABLE');
    expect(stockSituationOf({ ...base, archivedAt: new Date(), balance: d('0'), minStock: null })).toBe('NOT_APPLICABLE');
  });
});
