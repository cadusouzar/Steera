// Catálogo fixo de unidades de medida do Estoque v1 (espelhado em src/lib/stockUnits.ts no
// frontend). `fractional` decide se o produto aceita quantidade fracionada (até 3 casas).
export interface StockUnit {
  code: string;
  label: string;
  fractional: boolean;
}

export const STOCK_UNITS: readonly StockUnit[] = [
  { code: 'UN', label: 'Unidade', fractional: false },
  { code: 'PC', label: 'Peça', fractional: false },
  { code: 'CX', label: 'Caixa', fractional: false },
  { code: 'PAR', label: 'Par', fractional: false },
  { code: 'DZ', label: 'Dúzia', fractional: false },
  { code: 'KIT', label: 'Kit', fractional: false },
  { code: 'KG', label: 'Quilograma', fractional: true },
  { code: 'G', label: 'Grama', fractional: true },
  { code: 'L', label: 'Litro', fractional: true },
  { code: 'ML', label: 'Mililitro', fractional: true },
  { code: 'M', label: 'Metro', fractional: true },
  { code: 'CM', label: 'Centímetro', fractional: true },
  { code: 'M2', label: 'Metro quadrado', fractional: true },
  { code: 'M3', label: 'Metro cúbico', fractional: true },
];

export const STOCK_UNIT_CODES = STOCK_UNITS.map((u) => u.code);

export function getStockUnit(code: string): StockUnit {
  const unit = STOCK_UNITS.find((u) => u.code === code);
  if (!unit) throw new Error(`Unidade desconhecida: ${code}`);
  return unit;
}
