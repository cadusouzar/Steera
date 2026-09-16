# Correção do Roteamento Físico Schema-per-Tenant — Design

## Contexto e motivação

A Fase 1 do plano de isolamento físico por schema (spec
`docs/superpowers/specs/2026-09-15-schema-per-tenant-design.md`, plano
`docs/superpowers/plans/2026-09-15-schema-per-tenant.md`, 11 tasks, todas
implementadas e revisadas individualmente) foi validada de ponta a ponta na
Task 11 (15-16/09/2026). Essa validação encontrou um achado crítico,
verificado de forma independente pelo controlador da execução (não só
aceito do relatório do implementador): **o mecanismo central do design não
funciona para tráfego real de aplicação.**

Causa raiz, confirmada com testes reais contra Postgres (não suposição):
o Prisma Client (`@prisma/client` 5.22.0, engine padrão) fixa o schema de
destino a partir do parâmetro `?schema=` da `DATABASE_URL`, **no momento em
que a query é compilada** — e nunca reavalia o `search_path` real da
conexão/transação em tempo de execução. O `SET LOCAL search_path` que a
Task 5 deste plano adicionou a `tenant-rls.extension.ts` funciona
corretamente do lado do Postgres (confirmado via `current_schema()`, na
MESMA transação), mas é **inerte** para toda chamada feita via a API de
modelo do Prisma (`prisma.<model>.*`) — ou seja, para 100% das
leituras/escritas reais de todo service de negócio do backend. Só SQL bruto
(`$executeRaw*`, usado pela réplica de migrations) respeita o
`search_path` — por isso a infraestrutura de provisionamento (schemas
físicos, tabelas certas, bookkeeping em `TenantMigration`) está correta e
funciona, mas todo dado real de negócio continua sendo escrito em `public`,
isolado só pela RLS pré-existente (nunca removida) — exatamente como antes
deste plano inteiro começar.

Dois candidatos de correção foram testados e descartados com evidência
real, antes de se chegar à abordagem escolhida:

- **Prisma Driver Adapters** (`@prisma/adapter-pg`, preview feature) — testado
  ao vivo (instalado, configurado, versão pareada com o Prisma 5.22.0
  instalado). SQL gerado idêntico ao problema original
  (`FROM "public"."Client"`, sempre). Driver Adapters mudam só a biblioteca
  de conexão de baixo nível, não a camada de compilação de query que decide
  o schema — não resolve o problema.
- **`multiSchema` do Prisma** — já descartado durante o design original
  (Fase 1, 15/09/2026) por exigir mapeamento estático de tabela→schema no
  `schema.prisma`, incompatível com schemas de tenant criados dinamicamente.

O candidato validado com teste real (não suposição): um `PrismaClient`
construído com `datasourceUrl` apontando pro schema do tenant via a própria
URL de conexão (`?schema=tenant_<id>`) compila a query corretamente
qualificada pro schema certo (`FROM "tenant_<id>"."Client"`) e encontra os
dados — confirmado com um diagnóstico real contra Postgres, inserindo uma
linha só dentro do schema do tenant e lendo de volta via a API de modelo
normal do Prisma.

## Escopo desta spec

Esta spec cobre **só a correção do mecanismo de roteamento** — não
reabre nenhuma decisão já validada da Fase 1 original (provisionamento
transacional, `TenantMigrationManagerService`, isolamento de arquivos,
Central vs. Tenant split, RLS como backstop). Fora de escopo, deliberado:

- Migração de dados existentes (Fase 2, já era fora de escopo antes).
- Qualquer remoção de RLS ou de coluna `companyId` (RLS continua como
  defesa em profundidade, agora protegendo inclusive dentro do schema
  físico de cada tenant).
- Estratégia completa de deploy/produção (Dockerização do backend/Postgres
  em produção) — decisão explicitamente adiada para uma conversa própria,
  quando o deploy real for iniciado. Esta spec cobre só o PgBouncer, pela
  ligação direta com o problema de conexões que esta correção introduz.

## Decisões de arquitetura

### 1. Ponto único de mudança: `tenant-rls.extension.ts`

A correção fica inteiramente contida no hook `$allOperations` de
`tenant-rls.extension.ts` — o mesmo ponto de extensão do Prisma já usado
pela Fase 1 original. Nenhuma das ~30 services de negócio que hoje chamam
`this.prisma.<model>.metodo(...)` precisa saber que esse roteamento existe
— elas continuam exatamente como estão, com duas exceções pontuais (ver
seção 4).

Para os 4 modelos centrais (`Company`, `User`, `RefreshToken`,
`TenantMigration`), o comportamento não muda em nada — continuam
resolvendo contra o client global de sempre.

Para os 19 modelos de tenant (reaproveitando `TENANT_TABLE_NAMES`, de
`backend/src/prisma/tenant-table-names.ts`, já existente desde a Task 3 da
Fase 1 — os nomes de modelo do Prisma são idênticos aos nomes de tabela
usados ali, sem `@@map`), o hook resolve o client correto da empresa ativa
(via `TenantPrismaClientRegistry`, seção 2) e despacha a MESMA operação
pra esse client em vez de rodar no client base. O `set_config('app.current_company_id', ..., true)` continua sendo emitido (agora contra o client
do tenant) — a RLS dentro do próprio schema do tenant continua ativa como
defesa em profundidade, mesmo sendo estruturalmente redundante com a
separação física (uma segunda camada de proteção contra um bug futuro,
nunca removida).

### 2. `TenantPrismaClientRegistry` — cache de conexões por empresa

Novo serviço singleton (`backend/src/prisma/tenant-prisma-client-registry.service.ts`),
responsável por criar, reaproveitar e descartar instâncias de
`PrismaClient` — uma por empresa ativa, nunca uma por request.

**Por que cache, e não uma instância por empresa criada de uma vez e
mantida pra sempre:** essa alternativa mais simples foi descartada durante
o design original da Fase 1 (15/09/2026) especificamente por não escalar
para "milhares ou mais" empresas — cada `PrismaClient` abre seu próprio
pool de conexões reais com o Postgres, e o Postgres tem um teto total de
conexões (`max_connections`). Um cache com expulsão do menos usado
recentemente ("LRU") resolve isso: só empresas **genuinamente ativas
agora** ocupam uma conexão real; uma empresa sem atividade recente perde
sua vaga, e volta a ganhar uma (de forma transparente, sem erro pro
usuário) na próxima vez que fizer alguma ação.

**Estrutura de dados:**
```ts
interface TenantClientEntry {
  client: PrismaClient; // já com a extensão de RLS/set_config aplicada
  lastUsedAt: number;
  inFlightOperations: number; // contagem de operações em andamento
  pendingEviction: boolean; // marcado quando escolhido pra sair, mas ainda em uso
}

class TenantPrismaClientRegistry implements OnApplicationShutdown {
  private readonly cache = new Map<string, TenantClientEntry>();
  private readonly inFlightCreation = new Map<string, Promise<PrismaClient>>();
  private readonly maxSize: number; // configurável via env, ver seção 6

  async getClient(companyId: string): Promise<PrismaClient> { /* ... */ }
  private async createClient(companyId: string): Promise<PrismaClient> { /* ... */ }
  private evictLeastRecentlyUsedIfNeeded(): void { /* ... */ }
  async onApplicationShutdown(): Promise<void> { /* desconecta tudo */ }
}
```

**`getClient(companyId)` — fluxo completo:**
1. Se já existe no cache: atualiza `lastUsedAt`, incrementa
   `inFlightOperations`, retorna o client. (O decremento acontece no
   `finally` de quem chamou, ver seção 3.)
2. Se não existe, mas já há uma criação em andamento pra essa empresa
   (`inFlightCreation`): aguarda essa MESMA promise em vez de criar outra —
   evita que duas requisições simultâneas pra uma empresa nunca vista
   abram duas conexões à toa.
3. Se não existe e não há criação em andamento: chama
   `evictLeastRecentlyUsedIfNeeded()` primeiro (ver abaixo), depois cria um
   novo `PrismaClient` com `datasourceUrl` apontando pro schema da empresa
   (via `tenantSchemaName`, já existente desde a Task 1 da Fase 1) e um
   `connection_limit` pequeno e fixo (configurável, ver seção 6),
   registra no cache, remove de `inFlightCreation`, retorna.

**`evictLeastRecentlyUsedIfNeeded()` — a parte que exige cuidado:**
Quando o cache está no tamanho máximo e uma empresa nova precisa de vaga,
escolhe a entrada com o `lastUsedAt` mais antigo **entre as que têm
`inFlightOperations === 0`** (nunca escolhe uma entrada em uso). Marca
`pendingEviction = true` e chama `client.$disconnect()` de forma
assíncrona, sem bloquear quem está pedindo a vaga nova. Se, por uma
condição de corrida, TODAS as entradas tiverem operação em andamento no
momento da expulsão (extremamente improvável com um cache dimensionado com
folga, mas não impossível), a criação da empresa nova espera até que uma
entrada fique livre, com um timeout de segurança configurável
(`TENANT_CLIENT_EVICTION_TIMEOUT_MS`, padrão sugerido: 5000) — se
nenhuma entrada liberar a tempo, lança um erro explícito em vez de travar
a requisição indefinidamente; nunca estoura o tamanho do cache
silenciosamente.

Quando uma operação em uma entrada `pendingEviction` termina (decrementando
`inFlightOperations` até zero), o código que decrementa verifica esse flag
e, se verdadeiro, dispara o `$disconnect()` ali mesmo (desconexão adiada,
nunca no meio de uma operação).

### 3. Empacotamento do acesso — `inFlightOperations` sempre com `finally`

Todo ponto que pega um client do registry (o hook `$allOperations`, e os
dois helpers de transação, seção 4) precisa garantir o decremento de
`inFlightOperations` mesmo se a operação falhar — sempre via
`try { ... } finally { entry.inFlightOperations--; if (entry.pendingEviction && entry.inFlightOperations === 0) await entry.client.$disconnect(); }`.
Esse é o único ponto de disciplina que todo código que usa o registry
precisa seguir; encapsulado numa função helper única
(`withTenantClient(companyId, fn)`) pra nunca precisar ser reescrito à mão
em mais de um lugar.

### 4. Transações que misturam operações — a restrição nova

**Regra nova, decorrente direta da correção:** uma transação atômica
("tudo ou nada") só pode acontecer dentro de UMA conexão física — ou seja,
nunca pode misturar uma operação num modelo central com uma operação num
modelo de tenant (são clients/conexões diferentes agora). Antes desta
correção, isso não era uma restrição real porque tudo rodava na mesma
conexão via `SET LOCAL search_path` (mesmo esse mecanismo nunca tendo
funcionado pra API de modelo, o design *assumia* uma conexão única).

**Auditoria de todo código existente (feita durante o brainstorming desta
correção, não presumida):** os 7 pontos do código que hoje fazem uma
transação (`runTenantTransaction`/`runTenantInteractiveTransaction`) foram
lidos um a um. **Nenhum mistura modelo central com modelo de tenant na
mesma transação** — cada um é ou 100% central (`auth.service.ts`'s
`changePassword`, `users.service.ts`'s `block`/`updatePontoAccess`) ou 100%
tenant (`clients.service.ts`'s `deactivate`, `employees.service.ts`'s
`deactivate`, `time-adjustments.service.ts`, `time-clock.service.ts`) ou
central-mais-SQL-bruto (`auth.service.ts`'s `register`,
`tenant-migration-manager.service.ts` — o SQL bruto de DDL não passa pelo
hook `$allOperations`, então não é afetado por esta correção).

**Duas mudanças mecânicas necessárias** (não mudam nenhuma regra de
negócio, só a forma de pedir a operação):

- `clients.service.ts` (método `deactivate`) e `employees.service.ts`
  (método `deactivate`) usam hoje `runTenantTransaction(prisma, [op1, op2])`
  — uma lista de operações já prontas, construídas contra o client central
  antes de saber que precisam ir pro client do tenant. Esse formato é
  incompatível com redirecionar operação por operação depois de já
  montada. A correção: migrar as duas pra `runTenantInteractiveTransaction(prisma, async (tx) => {...})`
  — o MESMO formato de callback que `time-adjustments.service.ts`/
  `time-clock.service.ts` já usam hoje sem problema, onde `tx` é resolvido
  UMA vez (já apontando pro client certo) antes de qualquer operação
  dentro do callback ser construída.
- `runTenantTransaction`/`runTenantInteractiveTransaction`
  (`tenant-rls.extension.ts`) passam a resolver, logo no início de cada
  chamada: se `store.bypass` → client central (sem mudança); se
  `store.companyId` setado → busca o client do tenant no registry (seção
  2) e chama `.$transaction(...)` **nesse** client, não no central — é
  isso que preserva a atomicidade real quando a transação inteira é sobre
  tabelas de tenant.

### 5. `User`/`Company`/`RefreshToken` continuam centralizados — reconfirmado

Discutido explicitamente durante o brainstorming desta correção: mover
`User` para dentro do schema de cada tenant quebraria o login, porque
autenticar exige achar "esse e-mail pertence a qual empresa" **antes** de
saber em qual schema procurar — exatamente o problema que a Fase 1
original já tinha resolvido escolhendo uma identidade central (ver spec
original, seção "Central vs. Tenant"). Confirmado também que "cada empresa
só administra os próprios usuários" já é garantido hoje por
`companyId`+RLS, independente de onde a tabela mora fisicamente — não há
ganho de isolamento real em mover `User`, só o custo de reabrir o problema
de login já resolvido. Nenhuma mudança nesta seção do design original.

### 6. Configuração de conexões e PgBouncer

**Decisão: PgBouncer entra no escopo desta correção**, revisando a
recomendação inicial de adiar essa peça. Motivo: o VPS de destino real
(orçamento de até 8GB de RAM) deixaria pouca folga pra um número de
conexões diretas ao Postgres suficiente pra um crescimento saudável de
empresas simultâneas — o PgBouncer resolve isso deixando centenas (ou
mais) de conexões "lógicas" do lado da aplicação compartilharem um número
pequeno de conexões REAIS com o Postgres, tornando o custo de RAM
praticamente independente do número de empresas ativas.

Viabilidade confirmada por uma propriedade já existente no projeto: toda
configuração de sessão usada por este plano inteiro (`SET LOCAL`,
`set_config(..., true)`) já é, por regra desde a Fase 1 original,
**sempre** transaction-scoped, nunca sessão-scoped — essa é exatamente a
disciplina que torna seguro usar o PgBouncer no modo mais eficiente dele
("transaction pooling"), onde uma conexão real só é emprestada pela
duração de uma transação. Se o projeto tivesse usado `SET` puro em algum
lugar, esse modo vazaria configuração de uma empresa pra outra através de
uma conexão física reaproveitada — não é o caso aqui.

**Mudanças necessárias:**
- Um contêiner Docker novo, só do PgBouncer, tanto localmente (pra testar
  de verdade) quanto em produção depois — nenhuma outra peça do ambiente
  (Postgres local, backend) muda de forma de rodar.
- Toda `DATABASE_URL` (do client central e de cada client de tenant
  criado pelo registry) aponta pro PgBouncer em vez de direto pro Postgres,
  com o parâmetro `pgbouncer=true` que o Prisma exige nesse modo
  (desliga o cache de "prepared statements" do Prisma, que pressupõe uma
  conexão física estável — inválido sob pooling por transação, onde a
  conexão física por trás de uma "conexão" lógica pode mudar a cada
  transação).
- `connection_limit` de cada `PrismaClient` de tenant: valor pequeno e
  configurável via variável de ambiente (`TENANT_CLIENT_CONNECTION_LIMIT`,
  padrão sugerido: 2). Tamanho do cache do registry: configurável
  (`TENANT_CLIENT_CACHE_MAX_SIZE`, dimensionado com folga confortável acima
  do uso simultâneo esperado — calibrado durante o teste de stress, não
  chutado).

**Manual de operação (documentar, não construir uma ferramenta nova
agora):** três sinais concretos pra saber, antes de qualquer reclamação de
cliente, que é hora de aumentar algum limite: (1) contagem de conexões
ativas do Postgres perto do teto; (2) `SHOW POOLS` do PgBouncer mostrando
clientes esperando (`cl_waiting > 0`) com frequência; (3) o erro específico
do Prisma pra timeout de pool (código `P2024`) aparecendo nos logs. Um
script simples de checagem periódica, sem ferramenta paga, é suficiente
pra começar.

## Testes

Requisito explícito do usuário para esta correção: cobertura completa de
segurança, teste de percurso completo, e teste de stress real — não
opcional, e mais rigoroso do que o mínimo que uma correção deste tamanho
exigiria por si só.

- **O teste que faltava (a causa raiz de não ter sido pego antes):** um
  helper reutilizável de teste e2e que cria um dado pela API real (ex.:
  `POST /clients`) e depois lê **diretamente** `tenant_<companyId>."NomeDaTabela"`
  via SQL bruto, confirmando que a linha está fisicamente lá — e ausente da
  tabela pública. Aplicado a, no mínimo, um teste por módulo de negócio
  relevante (Clientes, Funcionários, Ponto), não só um caso isolado.
- **Testes dedicados do `TenantPrismaClientRegistry`:** cache hit/miss,
  ordem de expulsão LRU, deduplicação de criação concorrente (duas
  chamadas simultâneas pra uma empresa nova nunca criam dois clients),
  expulsão nunca desconecta uma entrada com operação em andamento
  (simulado com uma operação lenta controlada no teste).
- **Regressão dos dois arquivos migrados** (`clients.service.ts`,
  `employees.service.ts`): confirmar que uma falha na segunda operação de
  cada transação ainda desfaz a primeira (atomicidade preservada depois da
  mudança de formato).
- **Teste de percurso completo:** login → criar dado → listar → editar →
  desativar, para pelo menos dois módulos de negócio, confirmando o
  caminho inteiro sem mock, contra Postgres real.
- **Teste de stress:** múltiplas empresas reais (não simuladas),
  concorrência real de requisições, validando que o cache de conexões e o
  PgBouncer se comportam como projetado sob carga — não apenas que
  passam um teste unitário isolado.
- **Verificação end-to-end do PgBouncer:** confirmar, contra o contêiner
  real rodando localmente, que `SET LOCAL`/`set_config` continuam
  funcionando corretamente através dele (não presumir da documentação).
- Os testes já existentes (RLS, existência de schema) continuam — provam
  uma camada de proteção que continua ativa, agora complementar à prova
  física nova, não substituída por ela.

## Critérios de conclusão

- Um dado criado via API real, por uma empresa qualquer, é fisicamente
  encontrado dentro do schema físico daquela empresa (não em `public`) —
  provado por teste automatizado, não checagem manual.
- Nenhum teste da suíte completa (unit + e2e) depende só de RLS pra provar
  isolamento — todo teste de isolamento relevante tem a checagem física
  direta também.
- PgBouncer rodando localmente (Docker) e testado end-to-end; ambiente de
  desenvolvimento local, fora essa peça nova, inalterado.
- Teste de stress executado com sucesso, com números reais reportados
  (não estimados) de empresas simultâneas suportadas na configuração
  escolhida.
- `CLAUDE.md`/vault atualizados removendo o aviso de achado crítico da
  Task 11 e documentando o mecanismo real (registry, PgBouncer, o novo
  manual de operação).

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Expulsão de cache desconectar uma conexão em uso | Contagem de operações em voo + desconexão adiada (seção 2/3) — testado explicitamente. |
| `connection_limit`/tamanho do cache mal calibrados na produção | Manual de operação com 3 sinais concretos de alerta (seção 6); valores configuráveis via env, não hardcoded. |
| PgBouncer em modo transação exigir disciplina de nunca usar `SET` puro | Já é uma regra deste projeto desde a Fase 1 original — verificada, não nova. |
| Migração dos 2 arquivos de transação introduzir uma regressão sutil de atomicidade | Teste de regressão dedicado (seção Testes) antes de considerar a correção pronta. |
| Escala real exigir mais que o PgBouncer sozinho oferece (múltiplos servidores de banco, réplicas) | Fora do escopo desta correção — não é o tamanho do problema atual; documentado como possível próximo passo, não resolvido agora. |

## Próximos passos

Após aprovação desta spec: escrever o plano de implementação
(`superpowers:writing-plans`), cobrindo, como tasks separadas e testáveis:
o `TenantPrismaClientRegistry` e seus testes; a reescrita de
`tenant-rls.extension.ts` (incluindo `runTenantTransaction`/
`runTenantInteractiveTransaction`); a migração dos 2 arquivos de serviço;
o PgBouncer local (Docker) + ajuste de `DATABASE_URL`s; o novo helper de
teste de leitura física direta, aplicado às suítes relevantes; o teste de
percurso completo; o teste de stress; e a atualização final de
`CLAUDE.md`/vault removendo o achado crítico documentado na Task 11.
