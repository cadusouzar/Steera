// Constrói a DATABASE_URL de um client de tenant a partir da URL base (a mesma usada pelo client
// central) — troca só o parâmetro `schema` e adiciona os dois parâmetros que o modo de pooling por
// transação do PgBouncer (Task 7) exige do Prisma. Usar a API real de URL (não concatenação de
// string) evita qualquer bug de escaping em senha/usuário com caracteres especiais.
export function buildTenantDatasourceUrl(
  baseUrl: string,
  schemaName: string,
  connectionLimit: number,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schemaName);
  url.searchParams.set('pgbouncer', 'true');
  url.searchParams.set('connection_limit', String(connectionLimit));
  return url.toString();
}
