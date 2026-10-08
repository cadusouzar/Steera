import { Prisma } from '@prisma/client';

// CSV no formato que o Excel em português abre direto: separador ";", decimal com vírgula, UTF-8
// com BOM. Texto livre que começa com = + - @ ganha um apóstrofo na frente (evita fórmula executada
// ao abrir a planilha — injeção de CSV). Números nunca passam por essa proteção.
export type CsvCell = string | number | Prisma.Decimal | Date | boolean | null | undefined;

export function csvNumber(value: number | Prisma.Decimal | null | undefined, decimals?: number): string {
  if (value === null || value === undefined) return '';
  const d = new Prisma.Decimal(value);
  const text = decimals === undefined ? d.toString() : d.toFixed(decimals);
  return text.replace('.', ',');
}

function cellText(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number' || value instanceof Prisma.Decimal) return csvNumber(value);
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escape(text: string): string {
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const BOM = '\uFEFF';

export function buildCsv(header: string[], rows: CsvCell[][]): Buffer {
  const lines = [header, ...rows].map((r) => r.map((c) => escape(cellText(c))).join(';'));
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}

// Data/hora no fuso da empresa, legível na planilha (dd/mm/aaaa hh:mm).
export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}
