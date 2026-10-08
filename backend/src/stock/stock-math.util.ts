import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getStockUnit } from './stock-units';

// Política de precisão do Estoque v1, sempre com Prisma.Decimal (decimal.js, nunca float) e
// ROUND_HALF_UP:
// - quantidade: 3 casas;
// - custo unitário informado (entrada, custo de referência): até 4 casas; preço de venda: 2 casas;
// - valor do estoque, impacto de cada movimentação e custo médio: guardados com 6 casas, exibidos com
//   2 (valor) e 4 (custo). Com 6 casas internas, uma entrada fixa exatamente o custo informado.
// O valor do estoque (`stockValue`) é a grandeza guardada; o custo médio é derivado dele
// (stockValue / balance). Zerar o saldo sempre zera o valor, sem resíduo de arredondamento.
export type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

export const QTY_DP = 3;
export const INPUT_COST_DP = 4; // custo unitário digitado
export const MONEY_DP = 2; // preço de venda digitado e valores exibidos
export const INTERNAL_DP = 6; // valor do estoque, impacto e custo médio guardados

export function dec(value: Prisma.Decimal.Value): Dec {
  return new D(value);
}

export const ZERO = new D(0);

export function roundQty(value: Dec): Dec {
  return value.toDecimalPlaces(QTY_DP, D.ROUND_HALF_UP);
}
export function roundInternal(value: Dec): Dec {
  return value.toDecimalPlaces(INTERNAL_DP, D.ROUND_HALF_UP);
}
export function roundMoney(value: Dec): Dec {
  return value.toDecimalPlaces(MONEY_DP, D.ROUND_HALF_UP);
}

export function averageCostOf(balance: Dec, stockValue: Dec): Dec {
  return balance.isZero() ? ZERO : roundInternal(stockValue.div(balance));
}

export interface StockState {
  balance: Dec;
  stockValue: Dec;
}

export interface StockEffect {
  quantityDelta: Dec; // com sinal
  valueDelta: Dec; // com sinal
  unitCost: Dec; // custo unitário aplicado (6 casas)
  after: StockState & { averageCost: Dec };
}

// Entrada: incorpora quantidade × custo informado ao valor do estoque.
export function computeIncoming(state: StockState, quantity: Dec, unitCost: Dec): StockEffect {
  const qty = roundQty(quantity);
  const cost = roundInternal(unitCost);
  const valueDelta = roundInternal(qty.mul(cost));
  const balance = state.balance.add(qty);
  const stockValue = state.stockValue.add(valueDelta);
  return { quantityDelta: qty, valueDelta, unitCost: cost, after: { balance, stockValue, averageCost: averageCostOf(balance, stockValue) } };
}

// Saída: avaliada pelo custo médio vigente. Levar o saldo inteiro leva o valor inteiro (sem resíduo);
// uma saída parcial leva valor × qtd / saldo (6 casas).
export function computeOutgoing(state: StockState, quantity: Dec): StockEffect {
  const qty = roundQty(quantity);
  if (qty.gt(state.balance)) {
    throw new BadRequestException('Quantidade maior que o saldo disponível');
  }
  const valueOut = qty.eq(state.balance) ? state.stockValue : roundInternal(state.stockValue.mul(qty).div(state.balance));
  const balance = state.balance.sub(qty);
  const stockValue = state.stockValue.sub(valueOut);
  return {
    quantityDelta: qty.neg(),
    valueDelta: valueOut.neg(),
    unitCost: averageCostOf(state.balance, state.stockValue),
    after: { balance, stockValue, averageCost: averageCostOf(balance, stockValue) },
  };
}

// Estorno: aplica o efeito exatamente oposto ao da movimentação original (nunca ao custo atual).
export function computeReversal(
  state: StockState,
  original: { quantityDelta: Dec; valueDelta: Dec; unitCost: Dec },
): StockEffect {
  const quantityDelta = original.quantityDelta.neg();
  const valueDelta = original.valueDelta.neg();
  const balance = state.balance.add(quantityDelta);
  const stockValue = state.stockValue.add(valueDelta);
  if (balance.isNegative() || stockValue.isNegative()) {
    throw new BadRequestException('O estorno deixaria o saldo ou o valor do estoque negativo');
  }
  return {
    quantityDelta,
    valueDelta,
    unitCost: original.unitCost,
    after: { balance, stockValue, averageCost: averageCostOf(balance, stockValue) },
  };
}

function parseDecimal(raw: string | number, invalidMessage: string): Dec {
  let value: Dec;
  try {
    value = new D(typeof raw === 'string' ? raw.trim().replace(',', '.') : raw);
  } catch {
    throw new BadRequestException(invalidMessage);
  }
  if (!value.isFinite()) throw new BadRequestException(invalidMessage);
  return value;
}

// Converte e valida uma quantidade vinda da requisição para a unidade do produto.
export function parseQuantity(
  raw: string | number,
  unitCode: string,
  opts: { allowZero?: boolean; field?: string } = {},
): Dec {
  const field = opts.field ?? 'Quantidade';
  const value = parseDecimal(raw, `${field} inválida`);
  if (value.isNegative()) throw new BadRequestException(`${field} não pode ser negativa`);
  if (!opts.allowZero && value.isZero()) throw new BadRequestException(`${field} precisa ser maior que zero`);
  if (value.decimalPlaces() > QTY_DP) throw new BadRequestException(`${field} aceita no máximo ${QTY_DP} casas decimais`);
  if (!getStockUnit(unitCode).fractional && !value.isInteger()) {
    throw new BadRequestException(`${field} precisa ser um número inteiro para a unidade ${unitCode}`);
  }
  if (value.gt('999999999999')) throw new BadRequestException(`${field} acima do limite permitido`);
  return value;
}

// Valores em dinheiro/custo vindos da requisição: nunca negativos, no máximo `dp` casas.
export function parseMoney(raw: string | number, field: string, dp: number = MONEY_DP): Dec {
  const value = parseDecimal(raw, `${field} inválido`);
  if (value.isNegative()) throw new BadRequestException(`${field} não pode ser negativo`);
  if (value.decimalPlaces() > dp) throw new BadRequestException(`${field} aceita no máximo ${dp} casas decimais`);
  if (value.gt('100000000')) throw new BadRequestException(`${field} acima do limite permitido`);
  return value;
}
