import { CustomFieldType } from '@prisma/client';

const CUSTOM_COLUMN_PREFIX = 'custom_';
const CUSTOM_COLUMN_REGEX = /^custom_[a-z0-9_]{1,50}$/;

export const POSTGRES_TYPE_BY_FIELD_TYPE: Record<CustomFieldType, string> = {
  TEXT: 'TEXT',
  LONG_TEXT: 'TEXT',
  NUMBER: 'NUMERIC',
  CURRENCY: 'NUMERIC(14,2)',
  DATE: 'DATE',
  DATETIME: 'TIMESTAMP',
  BOOLEAN: 'BOOLEAN',
  SELECT: 'TEXT',
  MULTI_SELECT: 'TEXT[]',
  EMAIL: 'TEXT',
  PHONE: 'TEXT',
  CPF: 'TEXT',
  CNPJ: 'TEXT',
};

function slugify(displayName: string): string {
  return displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// O nome final é sempre interno (nunca exposto ao usuário, que só vê `displayName`) — colisão
// resolvida com um sufixo numérico automático, sem pedir pro admin escolher outro nome.
export function buildCustomColumnName(displayName: string, existingColumnNames: readonly string[]): string {
  const slug = slugify(displayName);
  const base = `${CUSTOM_COLUMN_PREFIX}${slug || 'campo'}`;
  const existing = new Set(existingColumnNames);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

// Última linha de defesa antes de qualquer SQL bruto — mesmo padrão de paranoia já usado por
// `assertValidSchemaName` (backend/src/prisma/tenant-schema.util.ts).
export function assertValidCustomColumnName(columnName: string): void {
  if (!CUSTOM_COLUMN_REGEX.test(columnName)) {
    throw new Error(`Nome de coluna personalizada inválido: ${JSON.stringify(columnName)}`);
  }
}
