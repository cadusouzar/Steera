import { randomInt } from 'crypto';

// Nome de schema de uma empresa: `<slug do nome>_<8 últimos caracteres do id>` pra empresas criadas
// a partir de 25/09/2026 (ex.: "padaria_central_x7k2m9qa") — o id aparece em logs/AuditLog/JWT,
// então quem investiga um log reconhece o schema de cara; empresas anteriores continuam com
// `tenant_<companyId>`. Em ambos os casos o nome fica gravado em `Company.schemaName` — gerado UMA
// vez no cadastro, nunca alterado, nunca aceito de requisição nenhuma (ver
// tenant-schema-name-resolver.ts pra como o roteamento o lê). O alfabeto fechado [a-z0-9_]
// garante que nenhum nome escapa das aspas duplas quando interpolado em SQL bruto; o prefixo pg_
// é reservado pelo Postgres (CREATE SCHEMA recusa).
const SCHEMA_NAME_REGEX = /^[a-z0-9_]{1,63}$/;
const SLUG_MAX_LENGTH = 40;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_RANDOM_LENGTH = 24;
const SUFFIX_LENGTH = 8;

export function slugifyForSchema(name: string): string {
  let slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/_+$/g, '');
  if (!slug) slug = 'empresa';
  // 'pg' sozinho viraria 'pg_<sufixo>' — mesmo problema do prefixo pg_ reservado pelo Postgres.
  if (slug === 'pg' || slug.startsWith('pg_')) slug = `emp_${slug}`;
  return slug;
}

// Id de Company gerado na APLICAÇÃO (não pelo @default(cuid()) do banco) só no register(), porque o
// nome do schema — gravado no mesmo INSERT — depende dele. Mesmo formato do cuid() atual (c + 24
// caracteres [a-z0-9]); sem dependência nova (@paralleldrive/cuid2 v3 é ESM-only, incompatível com
// este backend CommonJS). crypto.randomInt, não Math.random: os 8 finais separam homônimas.
export function generateCompanyId(): string {
  let id = 'c';
  for (let i = 0; i < ID_RANDOM_LENGTH; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

export function buildTenantSchemaName(sourceName: string, companyId: string): string {
  return `${slugifyForSchema(sourceName)}_${companyId.slice(-SUFFIX_LENGTH)}`;
}

export function assertValidSchemaName(schemaName: string): void {
  if (!SCHEMA_NAME_REGEX.test(schemaName) || schemaName.startsWith('pg_')) {
    throw new Error(`Nome de schema de tenant inválido: ${JSON.stringify(schemaName)}`);
  }
}
