# QuickFlow Backend — Módulo de Clientes, Lançamentos, Assinaturas e Relatórios

Data: 2026-09-09
Status: Aprovado para implementação

## Contexto

O frontend do QuickFlow (`C:\Users\cadus\Desktop\product`, React + TypeScript + Vite) hoje não tem
backend: todos os dados são mockados em `useState` (com exceção do módulo de Analytics, que usa
`localStorage`). Este spec cobre a primeira etapa de um backend real em NestJS + Prisma + PostgreSQL,
começando pelo domínio de **Clientes**, **Lançamentos (Receivables)**, **Assinaturas (Subscriptions)**
e **Relatórios** — o que hoje vive em `src/pages/app/ClientsList.tsx`,
`src/components/ClientFinanceDrawer.tsx` e `src/components/ClientReportModal.tsx`.

Não há autenticação/autorização nesta etapa (o projeto ainda não tem essa estrutura no frontend).

## Contrato herdado do frontend

```ts
// src/pages/app/ClientsList.tsx
interface Client {
  id: string;
  name: string;
  category: string;      // opcional na prática ("" quando não informado)
  contact: string;
  email?: string;
  status: 'active' | 'inactive';
  receivables: Receivable[];
  subscriptions: Subscription[];
}

interface Receivable {
  id: string;
  description: string;
  amount: number;
  dueDate: string;                          // yyyy-mm-dd
  status: 'paid' | 'pending' | 'overdue';    // 'overdue' é recalculado em certas mutações, não é
                                              // continuamente atualizado com o tempo no frontend
}

interface Subscription {
  id: string;
  description: string;
  amount: number;
  dueDay: number;        // 1-31
  status: 'active' | 'inactive';
}
```

Operações observadas no frontend: criar cliente; buscar por nome/categoria/contato; abrir drawer
financeiro de um cliente; criar lançamento avulso; criar assinatura; marcar/desmarcar lançamento como
pago; excluir lançamento (hard delete, com confirmação); excluir assinatura (hard delete, com
confirmação); "gerar fatura do mês" a partir de uma assinatura (cria um novo lançamento com o valor e
descrição da assinatura); relatório agregado (`ClientReportModal`) com totais pago/pendente/atrasado/
recorrente e ranking de inadimplência (top 5).

## Decisões (confirmadas com o usuário)

1. **Local do código**: `C:\Users\cadus\Desktop\product\backend` — mesmo repositório git do
   frontend (monorepo simples). O vault do Obsidian em `B:\Quickflow\Quickflow` permanece só para
   documentação, nunca para código.
2. **Escopo**: Clientes + Lançamentos avulsos + Assinaturas recorrentes + Relatório agregado, todos
   na mesma etapa.
3. **Regra de "atraso"**: `Receivable.status` no banco só tem `PENDING`/`PAID`. "Overdue" é **derivado
   em tempo de leitura** (status `PENDING` e `dueDate` no passado), nunca persistido. Evita a
   necessidade de um job/cron para manter o estado em dia.
4. **Exclusão**: `Client` nunca é hard-deletado — só inativado (`PATCH /clients/:id` com
   `status: INACTIVE`), reaproveitando o campo que já existe no frontend (hoje sem tela para
   alterá-lo). `Receivable`/`Subscription` são hard-deletados, batendo com o comportamento atual do
   frontend (fluxo de "Confirmar Exclusão").
5. **`paidAt`**: campo novo em `Receivable` (não existe no frontend hoje), só para registrar quando
   foi marcado como pago. Não afeta contrato do frontend, é aditivo.
6. **ORM/Banco**: Prisma + PostgreSQL local (serviço nativo do Windows, sem Docker), pois o projeto
   ainda não usa nenhum ORM.
7. **Relatórios**: expostos via endpoint dedicado (`GET /reports/financial-summary`) em vez de ficarem
   só no cliente, reaproveitando a mesma regra de "atraso" centralizada no domínio de Receivables.

## Arquitetura do backend

```
backend/
  src/
    prisma/
      prisma.module.ts       # @Global(), exporta PrismaService
      prisma.service.ts      # extends PrismaClient, hooks de conexão
    clients/
      clients.module.ts
      clients.controller.ts
      clients.service.ts
      dto/
        create-client.dto.ts
        update-client.dto.ts
        query-clients.dto.ts
    receivables/
      receivables.module.ts
      receivables.controller.ts
      receivables.service.ts
      dto/
        create-receivable.dto.ts
        update-receivable.dto.ts
        query-receivables.dto.ts
    subscriptions/
      subscriptions.module.ts
      subscriptions.controller.ts
      subscriptions.service.ts
      dto/
        create-subscription.dto.ts
        update-subscription.dto.ts
    reports/
      reports.module.ts
      reports.controller.ts
      reports.service.ts
    common/
      filters/http-exception.filter.ts
      pipes (se necessário)
    app.module.ts
    main.ts                  # bootstrap, ValidationPipe global, filtro global
  prisma/
    schema.prisma
    migrations/
  test/
    app.e2e-spec.ts
  .env.example
  package.json
  tsconfig.json
  nest-cli.json
```

`ReceivablesModule` e `SubscriptionsModule` importam `ClientsModule` (ou usam `PrismaService`
diretamente) para validar a existência do cliente antes de criar um registro. `ReportsModule` só lê,
via `PrismaService`, das três entidades — não depende dos outros módulos de domínio.

## Modelo de dados (Prisma)

```prisma
// backend/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ClientStatus {
  ACTIVE
  INACTIVE
}

enum ReceivableStatus {
  PENDING
  PAID
}

enum SubscriptionStatus {
  ACTIVE
  INACTIVE
}

model Client {
  id            String         @id @default(cuid())
  name          String
  category      String?
  contact       String
  email         String?
  status        ClientStatus   @default(ACTIVE)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  receivables   Receivable[]
  subscriptions Subscription[]

  @@index([status])
}

model Receivable {
  id          String           @id @default(cuid())
  clientId    String
  client      Client           @relation(fields: [clientId], references: [id], onDelete: Cascade)
  description String
  amount      Decimal          @db.Decimal(10, 2)
  dueDate     DateTime         @db.Date
  status      ReceivableStatus @default(PENDING)
  paidAt      DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([clientId])
  @@index([dueDate])
  @@index([status])
}

model Subscription {
  id          String             @id @default(cuid())
  clientId    String
  client      Client             @relation(fields: [clientId], references: [id], onDelete: Cascade)
  description String
  amount      Decimal            @db.Decimal(10, 2)
  dueDay      Int
  status      SubscriptionStatus @default(ACTIVE)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@index([clientId])
}
```

## Endpoints

### Clientes
| Método | Rota | Descrição |
|---|---|---|
| POST | `/clients` | Cria cliente (`name`, `contact` obrigatórios; `category`, `email` opcionais) |
| GET | `/clients` | Lista com `search` (nome/categoria/contato), `status`, `page`, `pageSize` |
| GET | `/clients/:id` | Busca por id (404 se não existir), inclui totais básicos |
| PATCH | `/clients/:id` | Atualiza campos e/ou `status` (ACTIVE/INACTIVE) |

### Lançamentos (Receivables)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/clients/:clientId/receivables` | Cria lançamento avulso (valida cliente existente) |
| GET | `/clients/:clientId/receivables` | Lista lançamentos do cliente, com `status` (`pending`/`paid`/`overdue`, sendo `overdue` derivado), `page`, `pageSize`, `sort` |
| GET | `/receivables/:id` | Busca por id |
| PATCH | `/receivables/:id` | Atualiza descrição/valor/vencimento |
| PATCH | `/receivables/:id/pay` | Marca como pago (`status=PAID`, seta `paidAt`) |
| PATCH | `/receivables/:id/unpay` | Desfaz pagamento (`status=PENDING`, limpa `paidAt`) |
| DELETE | `/receivables/:id` | Exclui (hard delete) |

### Assinaturas (Subscriptions)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/clients/:clientId/subscriptions` | Cria assinatura (valida cliente existente) |
| GET | `/clients/:clientId/subscriptions` | Lista assinaturas do cliente |
| GET | `/subscriptions/:id` | Busca por id |
| PATCH | `/subscriptions/:id` | Atualiza descrição/valor/dia de vencimento/status |
| DELETE | `/subscriptions/:id` | Exclui (hard delete) |
| POST | `/subscriptions/:id/generate-charge` | Gera um `Receivable` a partir da assinatura (mês/ano atual) |

### Relatórios
| Método | Rota | Descrição |
|---|---|---|
| GET | `/reports/financial-summary?topDefaulters=5` | `totalPaid`, `totalPending`, `totalOverdue`, `totalRecurring`, `topDefaulters[]` |

## Regras de negócio e tratamento de erros

- `ValidationPipe` global (`whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`).
- DTOs com `class-validator` (`@IsString`, `@IsNumber`, `@IsDateString`, `@IsOptional`, `@Min`/`@Max`
  em `dueDay` 1–31, `@IsEnum` para status).
- Filtro de exceção global (`common/filters/http-exception.filter.ts`) padronizando o corpo de erro:
  `{ statusCode, message, error }`.
- 404 (`NotFoundException`) em qualquer busca/atualização/exclusão por id inexistente.
- 404 explícito ao criar `Receivable`/`Subscription` para um `clientId` que não existe (verificação
  antes do insert, nunca depender só da FK do banco para reportar erro amigável).
- `amount` sempre `Decimal(10,2)`; nunca `number`/`float` no schema (evita erro de arredondamento
  monetário).
- Cálculo de "overdue": em `ReceivablesService`, centralizado em um método único reutilizado por
  listagem e por `ReportsService` — `status === PENDING && dueDate < hoje`.

## Ambiente e banco de dados

- PostgreSQL local no Windows, serviço nativo, sem Docker.
- `DATABASE_URL` no formato `postgresql://USUARIO:SENHA@localhost:5432/quickflow?schema=public`.
- Banco de desenvolvimento: `quickflow`. Banco de teste: `quickflow_test` (mesmo servidor local,
  usado só pelos testes de integração, para não misturar dados de dev).
- `backend/.env.example` versionado com valores fictícios; `backend/.env` real nunca versionado.
- `.gitignore` do repo (raiz) atualizado para cobrir `backend/.env`, `backend/dist`, logs e artefatos
  de build do backend, além do que já existe para o frontend.
- Migrations via `npx prisma migrate dev --name init` (e futuras `--name <mudança>`).

## Testes

- Unitários (Jest, padrão do NestJS): `ReceivablesService` (derivação de overdue, pay/unpay),
  `ClientsService`/`ReceivablesService`/`SubscriptionsService` (validação de cliente inexistente),
  `ReportsService` (agregação e ranking).
- 1+ teste e2e (`test/app.e2e-spec.ts`) cobrindo o fluxo: criar cliente → criar lançamento → marcar
  como pago → listar → conferir relatório — rodando contra `quickflow_test`.
- `npm run lint`, `npm run test`, `npm run build` executados ao final e reportados no resumo de
  entrega.

## Documentação

- Atualizar `CLAUDE.md` na raiz do repo (`C:\Users\cadus\Desktop\product\CLAUDE.md`), preservando o
  conteúdo atual, adicionando: seção de backend (stack, comandos, estrutura), variáveis de ambiente
  (sem valores reais), e a regra permanente de verificação de skills (texto fornecido pelo usuário,
  verbatim).
- Criar/atualizar no vault (`B:\Quickflow\Quickflow`, sem tocar em `.obsidian`):
  `ARQUITETURA.md`, `BANCO-DE-DADOS.md`, `API.md`, `AMBIENTE-LOCAL.md`, `DECISOES-TECNICAS.md`, com
  frontmatter (tags/aliases) e `[[wikilinks]]` cruzando os documentos e ligando ao `Indice.md`
  existente e às notas de página já existentes (`ClientsList.md`, etc.), usando as skills
  `obsidian-markdown`/`obsidian-cli`.
- Nenhuma funcionalidade é documentada como "concluída" sem lint/test/build passando de fato.

## Fora de escopo / pendências explícitas

- Autenticação/autorização (projeto ainda não tem essa estrutura).
- Job/cron para persistir `overdue` automaticamente (decisão: derivado em runtime).
- Geração real de boleto/PDF (no frontend hoje é só simulação visual).
- Alteração do frontend para consumir esta API (fica para uma etapa seguinte; qualquer adaptação
  mínima indispensável nesta etapa será avisada antes de ser feita).
