import { Prisma } from '@prisma/client';
import { averageCostOf, computeIncoming, computeOutgoing, computeReversal, dec, parseMoney, parseQuantity, ZERO } from './stock-math.util';

const s = (balance: string, value: string) => ({ balance: dec(balance), stockValue: dec(value) });

describe('stock-math', () => {
  it('entrada recalcula o custo médio ponderado', () => {
    const first = computeIncoming(s('0', '0'), dec(10), dec('2.50'));
    expect(first.after.balance.toString()).toBe('10');
    expect(first.after.stockValue.toString()).toBe('25');
    expect(first.after.averageCost.toString()).toBe('2.5');
    const second = computeIncoming(first.after, dec(10), dec('3.50'));
    expect(second.after.stockValue.toString()).toBe('60');
    expect(second.after.averageCost.toString()).toBe('3');
  });

  it('entrada com custo zero informado é aceita e dilui o custo médio', () => {
    const effect = computeIncoming(s('10', '30'), dec(10), dec(0));
    expect(effect.valueDelta.toString()).toBe('0');
    expect(effect.after.averageCost.toString()).toBe('1.5');
  });

  it('saída usa o custo médio vigente', () => {
    const out = computeOutgoing(s('3', '10'), dec(1));
    expect(out.valueDelta.toString()).toBe('-3.333333');
    expect(out.unitCost.toString()).toBe('3.333333');
    expect(out.after.stockValue.toString()).toBe('6.666667');
    expect(out.after.balance.toString()).toBe('2');
  });

  it('zerar o saldo zera o valor sem resíduo', () => {
    let state = s('3', '10');
    for (let i = 0; i < 3; i++) state = computeOutgoing(state, dec(1)).after;
    expect(state.balance.isZero()).toBe(true);
    expect(state.stockValue.isZero()).toBe(true);
    expect(averageCostOf(state.balance, state.stockValue).toString()).toBe('0');
  });

  it('nova entrada após saldo zero estabelece o custo pela própria entrada', () => {
    const effect = computeIncoming({ balance: ZERO, stockValue: ZERO }, dec(4), dec('7.1234'));
    expect(effect.after.averageCost.toString()).toBe('7.1234');
    expect(effect.after.stockValue.toString()).toBe('28.4936');
  });

  it('bloqueia saída maior que o saldo', () => {
    expect(() => computeOutgoing(s('2', '4'), dec(3))).toThrow('Quantidade maior que o saldo disponível');
  });

  it('estorno devolve exatamente o estado anterior', () => {
    const before = s('5', '12.35');
    const exit = computeOutgoing(before, dec(2));
    const reversal = computeReversal(exit.after, exit);
    expect(reversal.after.balance.toString()).toBe('5');
    expect(reversal.after.stockValue.toString()).toBe('12.35');
  });

  it('estorno que deixaria saldo negativo é recusado', () => {
    expect(() => computeReversal(s('1', '1'), { quantityDelta: dec(2), valueDelta: dec(2), unitCost: dec(1) })).toThrow();
  });

  it('valida quantidade conforme a unidade', () => {
    expect(() => parseQuantity('1.5', 'UN')).toThrow('inteiro');
    expect(parseQuantity('1,25', 'KG').toString()).toBe('1.25');
    expect(() => parseQuantity('0.0001', 'KG')).toThrow('3 casas');
    expect(() => parseQuantity('0', 'UN')).toThrow('maior que zero');
    expect(parseQuantity('0', 'UN', { allowZero: true }).isZero()).toBe(true);
    expect(() => parseQuantity('-1', 'UN')).toThrow('negativa');
    expect(() => parseQuantity('abc', 'UN')).toThrow('inválida');
  });

  it('valida valores em dinheiro', () => {
    expect(parseMoney('10,5', 'Preço').toString()).toBe('10.5');
    expect(() => parseMoney('1.001', 'Preço')).toThrow('2 casas');
    expect(() => parseMoney('-1', 'Preço')).toThrow('negativo');
  });

  it('nunca usa ponto flutuante: 0.1 + 0.2 em quantidade fica exato', () => {
    const a = computeIncoming(s('0', '0'), new Prisma.Decimal('0.1'), dec(1));
    const b = computeIncoming(a.after, new Prisma.Decimal('0.2'), dec(1));
    expect(b.after.balance.toString()).toBe('0.3');
  });
});
