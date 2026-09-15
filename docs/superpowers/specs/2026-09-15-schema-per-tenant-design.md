# Isolamento Físico por Schema PostgreSQL (Schema-per-Tenant) — Design

## Contexto e motivação

O QuickFlow ERP hoje isola empresas (tenants) por duas camadas dentro de um único schema
PostgreSQL compartilhado (`public`):

1. **Aplicação:** 19 dos 23 models têm uma coluna `companyId` + índice, filtrada explicitamente
   pelos services via `CompanyContextService.getCurrentCompanyId()`.
2. **Banco de dados (Row-Level Security):** desde 13/09/2026, toda tabela de tenant tem
   `ENABLE`/`FORCE ROW LEVEL SECURITY` com uma policy `tenant_isolation` que só libera linhas onde
   `"companyId" = current_setting('app.current_company_id')`. Isso é aplicado por uma extensão
   Prisma (`tenant-rls.extension.ts`) que embrulha toda operação de todo model numa mini-transação
   `[set_config(...), query]`, alimentada por um `AsyncLocalStorage` (`tenant-context.ts`) que um
   interceptor HTTP global (`TenantContextInterceptor`) popula a partir do JWT em toda requisição
   autenticada. Sem contexto de tenant = zero linhas visíveis (fail-safe por padrão).

Este design migra a estratégia de isolamento de "uma tabela compartilhada, filtrada por coluna"
para "um schema PostgreSQL físico por empresa" — preparando o sistema para: maior isolamento entre
tenants, campos/colunas customizadas por empresa no futuro, backup/restore por empresa, evolução
independente de schema por tenant, e redução da superfície de um vazamento cross-tenant a zero (uma
query pra `tenant_a` estruturalmente não enxerga tabelas em `tenant_b`, não depende de nenhum
`WHERE` estar correto).

**Motivadores concretos que levaram a esta decisão** (das duas lacunas reais do desenho atual):
- Cadastro de campos personalizados por empresa exigiria hoje uma coluna `Json`/EAV compartilhada
  entre todos os tenants — schema físico por tenant permite, no futuro, colunas físicas reais
  (`ALTER TABLE tenant_x.clients ADD COLUMN custom_cracha ...`) só na empresa que pediu, sem afetar
  as demais.
- RLS já é um bom backstop, mas ainda depende de toda query aplicar corretamente um filtro — schema
  físico remove essa dependência: o isolamento passa a ser estrutural, não uma regra que precisa ser
  respeitada em toda query nova.

## Escopo desta spec — Fase 1 apenas

Esta migração é grande o suficiente para justificar duas fases com riscos bem diferentes:

- **Fase 1 (esta spec):** infraestrutura de schema-por-tenant + toda empresa **nova** já nasce no
  modelo novo, validado e testado de ponta a ponta. Nenhuma empresa/dado existente é tocado.
- **Fase 2 (spec separada, futura, feita só depois da Fase 1 validada em produção):** migrar os
  dados das empresas já existentes (hoje só dados de teste/desenvolvimento, confirmado com o
  usuário) para seus próprios schemas, e desativar o modelo compartilhado antigo.

Justificativa da separação: a Fase 1 e a Fase 2 têm perfis de risco completamente diferentes — a
Fase 1 é aditiva (nada existente muda de comportamento, só empresas novas passam a usar o caminho
novo), a Fase 2 é uma migração de dados reais com potencial de perda/mistura se malfeita. Tratá-las
juntas arriscaria misturar os dois níveis de cautela num plano só.

**Fora do escopo desta spec, explicitamente:**
- Migração dos dados das empresas já existentes (Fase 2).
- Remoção de qualquer coluna `companyId` ou de qualquer policy de RLS existente (mantidas como
  estão, ver seção "RLS" abaixo).
- A feature de campos personalizados em si (esta spec só prepara a base física pra ela existir no
  futuro — nenhuma UI/API de campo customizado é construída aqui).
- Qualquer mudança em `Departamentos`/hierarquia organizacional (iniciativa futura separada, já
  identificada e adiada em conversa anterior).
- Qualquer infraestrutura de cache/fila (o projeto não usa Redis/Bull hoje — confirmado por
  inspeção do `package.json` — e nada aqui exige introduzir isso).

## Decisões de arquitetura (resumo das aprovadas em conversa)

### 1. Central vs. Tenant

**Central (schema `public`, continua compartilhado — só dados de identidade/roteamento, nunca dado
operacional):**

| Model | Por quê |
|---|---|
| `Company` | É o próprio registro do tenant — precisa existir antes de saber qual schema abrir. |
| `User` | Login é por e-mail globalmente único, resolvido **antes** de se saber a que empresa o usuário pertence (`AuthService.login()`/`refresh()` já fazem essa busca cross-tenant hoje, via `runAsSystem`). |
| `RefreshToken` | Depende de `User` pelo mesmo motivo (`POST /auth/refresh` localiza o usuário antes de resolver tenant). |
| `Holiday` (só os escopos `NATIONAL`/`STATE`) | Catálogo compartilhado por todo o sistema, sem dono de empresa nenhum — não são dado operacional de tenant algum. |

Justificativa de segurança para manter esse schema mínimo (decidido explicitamente após discussão
de trade-off com o usuário): a alternativa ("zero schema compartilhado", tenant identificado via
subdomínio/slug antes da senha) introduziria uma superfície de ataque nova — um valor
influenciado/fornecido pelo cliente decidindo qual schema abrir antes da autenticação — sem nenhum
ganho de isolamento de dado (o isolamento físico é idêntico nas duas opções). A opção escolhida
mantém a mesma regra de confiança já auditada neste projeto: nenhum identificador de tenant nunca
vem do cliente, só de uma consulta feita pelo próprio backend após autenticar.

`User.email` continua com a constraint `@unique` do banco, cobrindo o sistema inteiro — nenhuma
mudança de código necessária; um e-mail usado pela Empresa A nunca pode ser reaproveitado pela
Empresa B, seja no cadastro inicial (`POST /auth/register`) ou no painel de criação de login
(`POST /companies/me/users`).

**Tenant (um schema físico por empresa):** todos os demais 19 models — `Client`, `Receivable`,
`Subscription`, `Role`, `Employee`, `EmployeeWarning`, `EmployeeRecurringPayment`,
`EmployeePayment`, `VacationSchedule`, `LeaveSchedule`, `TimeTrackingSettings`, `TimeEvent`,
`WorkSchedule`, `WorkLocation`, `TimeAdjustmentRequest`, `TimeCorrection`, `TimeJustification`,
`FileAsset`, `AuditLog`, e `Holiday` (só o escopo `COMPANY`, customizado por empresa).

**Sobre `companyId`:** todas as colunas `companyId` existentes nos 19 models de tenant são
**mantidas intactas nesta fase** — nenhuma removida. Dentro do próprio schema do tenant, a coluna é
redundante para fins de isolamento (todo dado ali já pertence a uma única empresa, por construção),
mas continua tendo duas utilidades reais: (a) é o que a policy de RLS (mantida como backstop, ver
abaixo) ainda lê; (b) remover uma coluna usada em dezenas de `where`/`select` explícitos em toda a
base de código é um trabalho grande, de risco desnecessário, e fora do escopo desta fase — decisão
explícita de não mexer, revisitável só depois que o modelo novo estiver validado em produção por um
bom tempo.

### 2. Nome do schema — derivado, nunca armazenado, nunca vindo do cliente

O nome do schema de uma empresa é uma função pura e determinística do seu `id` (já um `cuid()`
único e imutável): `tenant_<companyId>`. Não existe uma coluna `Company.schemaName` — não há
necessidade: armazenar um valor derivável de outro já existente criaria uma segunda fonte de
verdade que poderia (em teoria) dessincronizar; a função pura elimina essa classe de bug por
construção. Uma única função utilitária centraliza essa regra (`tenantSchemaName(companyId): string`,
em `backend/src/prisma/tenant-schema.util.ts`) — nenhum service, controller ou repository nunca
constrói esse nome manualmente.

**Segurança:** o nome do schema nunca é aceito de nenhuma requisição — é sempre calculado a partir
do `companyId` que já vem do claim assinado do JWT (mesma garantia já existente hoje para
`companyId`). Uma validação defensiva com regex estrito (`^tenant_[a-z0-9]+$`, casando o alfabeto
de `cuid()`) roda antes de qualquer SQL bruto usar esse valor, como defesa em profundidade contra um
bug futuro que produza um valor malformado — nunca como proteção contra input do usuário, que
estruturalmente nunca chega até aqui.

### 3. Resolução do tenant e extensão do Prisma

`CompanyContextService` não muda de forma nenhuma — `companyId` já é, por construção, o
identificador do tenant, e continua vindo do mesmo lugar de sempre (`req.user.companyId`, populado
pelo `JwtAuthGuard`). A "evolução" pedida (de "qual é o companyId" para "qual é o schema atual")
acontece inteiramente dentro da extensão do Prisma — o único lugar que já traduz contexto em comando
de banco.

A extensão (`tenant-rls.extension.ts`) passa a rodar **dois comandos** antes de cada query, na mesma
mini-transação que já existe hoje:
```sql
SET search_path TO "tenant_<companyId>", public;
SELECT set_config('app.current_company_id', '<companyId>', true);
-- (a query original)
```
O `, public` no final do `search_path` é o que permite uma mesma extensão atender consultas centrais
e de tenant sem nenhum código especial: uma consulta a `"Client"` (não-qualificada) encontra
`tenant_x."Client"`; uma consulta a `"User"` (que só existe em `public`) não encontra nada em
`tenant_x` e o PostgreSQL segue a busca pro próximo item da lista, achando `public."User"`.

Todo o resto do mecanismo de propagação (`AsyncLocalStorage`, `TenantContextInterceptor`,
`runWithTenant`/`runAsSystem`, `runTenantTransaction`/`runTenantInteractiveTransaction`) permanece
**sem nenhuma alteração** — já resolve exatamente o problema de propagar o contexto certo através de
código assíncrono, incluindo a sutileza documentada de `AsyncLocalStorage` que motivou o
`runInStore`'s `async () => fn()` shim.

### 4. Row-Level Security — mantida como backstop, não substituída

RLS não é retirada. Physical schema separation passa a ser a camada **primária** de isolamento
(estrutural — uma query pra `tenant_a` não enxerga uma tabela em `tenant_b`, nem existe a hipótese
de "esqueceram um WHERE"); RLS continua exatamente como está hoje — nenhuma mudança de migration,
nenhuma mudança de policy — como uma segunda camada independente: se algum bug futuro (uma extensão
com defeito, uma query crua fora do Prisma) falhar em trocar o `search_path` corretamente, a policy
de RLS ainda impede que uma linha de outra empresa seja lida/escrita. Isso é essencialmente de graça
— zero trabalho novo, dado que `companyId` e as policies continuam intactos.

### 5. Provisionamento de empresa nova

Função interna compartilhada, usada tanto pra empresa nova quanto pra atualizar empresas
existentes:

```ts
// backend/src/prisma/tenant-migration.util.ts
async function applyMigrations(
  prisma: PrismaClient | Prisma.TransactionClient,
  schemaName: string,
  migrationNames: string[],
): Promise<void>
```
Lê o texto de cada `migration.sql` (os mesmos arquivos que `npx prisma migrate dev` já gera hoje —
nenhuma mudança em como migrations são escritas) na pasta `prisma/migrations/<migrationName>/`, e
executa cada um via `$executeRawUnsafe` contra o `search_path` já definido pro schema alvo, em
ordem — a lista de `migrationNames` é derivada listando os diretórios de `prisma/migrations/`
(ignorando explicitamente `migration_lock.toml`, que não é uma migration). Registra cada uma
aplicada numa tabela central nova (`TenantMigration`, sem RLS — é metadado central sobre tenants,
consultada sempre via `runAsSystem`/sem contexto de tenant, no mesmo espírito de `Company`):

```prisma
model TenantMigration {
  id            String   @id @default(cuid())
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  migrationName String
  appliedAt     DateTime @default(now())

  @@unique([companyId, migrationName])
  @@index([companyId])
}
```

`AuthService.register()` é reescrito para, dentro de **uma única transação PostgreSQL** (a mesma
`runTenantInteractiveTransaction`/`runAsSystem` que já usa hoje, sem trocar de mecanismo):

```text
BEGIN
  INSERT INTO public."Company" (...)                        -- gera o id
  CREATE SCHEMA "tenant_<id>"
  applyMigrations(tx, "tenant_<id>", TODAS as migrations existentes, em ordem)
  INSERT INTO public."User" (primeiro admin, companyId = company.id)
COMMIT
```

Como PostgreSQL tem DDL transacional, uma falha em qualquer passo — criação do schema, uma migration
específica — desfaz a transação inteira: nunca existe uma empresa com schema pela metade, nem um
`Company`/`User` órfão. Retentar após uma falha é sempre seguro (não há sujeira residual pra
limpar), o que mitiga diretamente o risco de negócio de "perder o cadastro" levantado em conversa —
o mecanismo de rollback é do próprio banco, não uma lógica de compensação que precisaríamos escrever
e confiar.

### 6. Atualizando empresas existentes quando uma migration nova é adicionada

```ts
// TenantMigrationManager (novo módulo, backend/src/tenant-migration/)
async applyPendingMigrationsToAllTenants(): Promise<void>
```
Reaproveita literalmente o padrão já usado em `BillingSchedulerService.runCatchUp`/
`ClientTrashService.purgeExpiredTrashCron`: itera todo `Company` (tabela central, sem contexto de
tenant necessário pra lê-la), calcula as migrations pendentes daquela empresa (todas menos as que já
estão em `TenantMigration`), e aplica as pendentes numa transação, via `applyMigrations`. Disparado
pelo mesmo par já estabelecido nesta base de código: `@Cron(CronExpression.EVERY_DAY_AT_3AM)` +
`OnApplicationBootstrap` (auto-cura uma janela de cron perdida assim que o processo sobe) — nenhum
padrão novo de disparo é inventado.

**Tradeoff aceito, mesma classe já documentada para o billing scheduler:** a checagem de bootstrap
roda de forma síncrona antes do app aceitar tráfego; com uma base muito grande de tenants isso pode
atrasar o boot. Aceito por ora (mantém a implementação simples e correta), fica como otimização
futura (lote com concorrência limitada) se algum dia isso for medido como um problema real.

### 7. Trilhas transversais

- **Jobs em background:** nenhuma mudança de padrão — todo `@Cron` que já usa
  `runWithTenant(company.id, ...)` continua funcionando sem tocar em nada, porque a extensão do
  Prisma é o único lugar que muda de comportamento.
- **Arquivos:** `storage/attachments/` (hoje uma pasta única e achatada) passa a
  `storage/attachments/<companyId>/<uuid>`. Muda só `FilesService` (o `join()` de escrita e leitura)
  — nenhuma migration, nenhuma mudança de schema de banco.
- **Logs:** pontos críticos novos (falha de provisionamento de tenant, falha de migration em
  `TenantMigrationManager`) ganham `companyId`/schema como campo estruturado no log de erro,
  seguindo o padrão já usado em `BillingSchedulerService.safeGenerate`.
- **Cache:** não aplicável — confirmado que o projeto não usa nenhuma camada de cache/Redis hoje.

## Testes

**Isolamento cross-tenant (novo e2e, mesmo espírito de `test/rls-tenant-isolation.e2e-spec.ts`, mas
testando separação física):**
- Cria Empresa A (cliente "João", funcionário "Carlos") e Empresa B (cliente "Maria", funcionário
  "Pedro") via `POST /auth/register` real.
- Confirma que toda listagem/filtro/relatório do login de A só retorna João/Carlos, nunca
  Maria/Pedro.
- Tentativa deliberada: login de A pega o `id` real de um registro de B (lido direto do banco no
  setup do teste) e chama `GET /clients/:id`/`GET /employees/:id` com esse id — precisa `404`
  (nunca `403`, mesma convenção já usada em todo o resto do backend).
- Confirma que os dois schemas físicos (`tenant_<a>`, `tenant_<b>`) de fato existem no PostgreSQL
  como schemas distintos (consulta direta a `information_schema.schemata`), não só que a API retorna
  os dados certos.

**Replay de migration:** cria um schema descartável do zero, roda `applyMigrations` com o histórico
completo de migrations, confirma que toda tabela esperada existe com a estrutura certa. Roda em CI a
cada mudança — é o mecanismo que pega um bug de migration antes que ele apareça num cadastro real,
respondendo diretamente à preocupação de "perder a venda" levantada em conversa.

**Provisionamento:**
- Sucesso: empresa criada → schema existe → primeiro admin loga com sucesso.
- Falha simulada: injeta um erro no meio do replay de migrations e confirma que **nada** fica pra
  trás — nem `Company`, nem o schema físico, nem `User`. Confirma que uma segunda tentativa (retry)
  após a falha funciona normalmente.

**`TenantMigrationManager`:** cria dois tenants em versões diferentes de migration (um atualizado,
um atrasado por uma migration), roda `applyPendingMigrationsToAllTenants()`, confirma que só o
atrasado foi tocado e que ambos terminam na mesma versão.

## Ambiente de desenvolvimento local

Sem nenhuma peça nova de infraestrutura — continua `npm install` → Postgres local rodando →
`npm run start:dev`. A única diferença prática: o primeiro `POST /auth/register` local já cria um
schema de verdade (`tenant_<id>`) por trás — é a mesma operação de sempre, sem passo manual
adicional. Migrations continuam sendo escritas com `npx prisma migrate dev` exatamente como hoje,
contra o banco de desenvolvimento local; a única mudança é que reiniciar o backend depois de
adicionar uma migration nova já aplica ela automaticamente em qualquer tenant de desenvolvimento
existente, via o mesmo `OnApplicationBootstrap` descrito acima.

## Critérios de conclusão da Fase 1

- Toda empresa criada via `POST /auth/register` nasce com seu próprio schema PostgreSQL físico.
- O schema é resolvido automaticamente pelo backend a partir do JWT — nenhuma requisição consegue
  influenciar qual schema é aberto.
- Uma requisição autenticada da Empresa A estruturalmente não consegue ler/escrever dado da Empresa
  B, mesmo manipulando `companyId`/qualquer campo da requisição — verificado por teste automatizado,
  incluindo tentativa deliberada de acesso por id.
- Uma migration nova aplicada ao histórico do Prisma se propaga automaticamente pra todo tenant
  existente, sem intervenção manual empresa por empresa.
- Todos os módulos/jobs/testes existentes continuam passando sem nenhuma mudança de comportamento
  para as empresas que já existem hoje (que continuam no modelo compartilhado até a Fase 2).
- RLS e as colunas `companyId` permanecem intactas e funcionando, como backstop.
- Falha de provisionamento nunca deixa uma empresa parcialmente criada; retry após falha é sempre
  seguro.

## Riscos conhecidos e mitigação

| Risco | Mitigação |
|---|---|
| Provisionamento de empresa nova fica mais pesado que hoje (histórico de migrations cresce com o tempo) | Aceito por ora — poucas migrations hoje (23); se o tempo de provisionamento crescer a ponto de importar, a otimização futura é clonar um schema-modelo via `pg_dump`/`pg_restore` em vez de reexecutar todo o histórico, sem mudar a interface de `applyMigrations`. |
| Boot do backend fica mais lento com muitos tenants pendentes de migration | Mesmo tradeoff já aceito e documentado para `BillingSchedulerService` — otimização futura (lote com concorrência limitada) se medido como problema real. |
| Um bug na extensão do Prisma falha em trocar o `search_path` corretamente | RLS continua ativa como segunda camada independente — mesmo com esse bug, uma linha de outra empresa não seria retornada. |
| Migration com erro atinge produção e quebra o cadastro de empresas novas | Teste de replay de migration contra schema descartável, rodando em CI a cada mudança — pega o bug antes do deploy, não durante um cadastro real. |

## Próximos passos

Esta spec cobre a Fase 1. Aprovada, o próximo passo é a skill `writing-plans` gerar o plano de
implementação tarefa-a-tarefa. A Fase 2 (migração de dados existentes + cutover do modelo antigo)
será brainstormed como uma spec separada, só depois da Fase 1 estar implementada, testada e validada
— nenhum trabalho de Fase 2 está incluído no plano derivado desta spec.
