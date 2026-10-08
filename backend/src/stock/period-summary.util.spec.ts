import { PeriodRow, summarizePeriod } from './period-summary.util';

const row = (r: Partial<PeriodRow>): PeriodRow => ({
  type: 'ENTRY', reason: 'MANUAL_ENTRY', origType: null, origReason: null, positive: true,
  unit: 'UN', quantity: '0', value: '0', count: 1, ...r,
});

describe('summarizePeriod', () => {
  it('separa original, estorno e líquido sem dupla contagem', () => {
    const s = summarizePeriod([
      row({ quantity: '10', value: '50' }),
      row({ type: 'REVERSAL', reason: 'REVERSAL', origType: 'ENTRY', origReason: 'MANUAL_ENTRY', quantity: '4', value: '20' }),
    ]);
    expect(s.entries.UN.original.quantity.toString()).toBe('10');
    expect(s.entries.UN.reversed.quantity.toString()).toBe('4');
    expect(s.entries.UN.net.quantity.toString()).toBe('6');
    expect(s.entries.UN.net.value.toString()).toBe('30');
    expect(s.exits).toEqual({}); // o estorno de entrada não vira saída
  });

  it('perda e avaria entram em saídas e também em perdas', () => {
    const s = summarizePeriod([
      row({ type: 'EXIT', reason: 'LOSS', positive: false, quantity: '2' }),
      row({ type: 'EXIT', reason: 'MANUAL_EXIT', positive: false, quantity: '3' }),
    ]);
    expect(s.exits.UN.original.quantity.toString()).toBe('5');
    expect(s.losses.UN.original.quantity.toString()).toBe('2');
  });

  it('ajustes são separados pelo sentido da movimentação original e por unidade', () => {
    const s = summarizePeriod([
      row({ type: 'ADJUSTMENT', reason: 'COUNT_ADJUSTMENT', positive: true, quantity: '1', unit: 'KG' }),
      row({ type: 'ADJUSTMENT', reason: 'COUNT_ADJUSTMENT', positive: false, quantity: '2' }),
      row({ type: 'REVERSAL', reason: 'REVERSAL', origType: 'ADJUSTMENT', origReason: 'COUNT_ADJUSTMENT', positive: false, quantity: '2' }),
    ]);
    expect(s.adjustmentsIn.KG.net.quantity.toString()).toBe('1');
    expect(s.adjustmentsOut.UN.net.quantity.toString()).toBe('0');
    expect(s.adjustmentsOut.UN.reversed.count).toBe(1);
  });
});
