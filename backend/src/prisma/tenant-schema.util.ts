// Nome do schema de uma empresa é uma função pura e determinística do seu id — nunca armazenado
// em coluna nenhuma (evitaria uma segunda fonte de verdade que poderia dessincronizar) e nunca
// aceito de requisição nenhuma (só calculado a partir do companyId já validado pelo JWT). O
// alfabeto do cuid() do Prisma é minúsculo alfanumérico (ex.: "cm2x9f8j40000abc123defg") — o regex
// abaixo é deliberadamente mais permissivo em tamanho (20-30) do que restrito ao formato exato do
// cuid(), pra não quebrar se o formato de id mudar de leve no futuro, mas continua rejeitando
// qualquer caractere fora de [a-z0-9] — o suficiente pra nunca permitir um nome de schema que
// escape das aspas duplas quando interpolado em SQL bruto.
const SCHEMA_NAME_REGEX = /^tenant_[a-z0-9]{20,30}$/;

export function tenantSchemaName(companyId: string): string {
  return `tenant_${companyId}`;
}

export function assertValidSchemaName(schemaName: string): void {
  if (!SCHEMA_NAME_REGEX.test(schemaName)) {
    throw new Error(`Nome de schema de tenant inválido: ${JSON.stringify(schemaName)}`);
  }
}
