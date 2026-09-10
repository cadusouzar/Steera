# Lixeira de Clientes (Client Trash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma "lixeira" de clientes — só para o grupo desativado com `includeInRevenueReport=false` — com restauração e purga física automática após 30 dias.

**Architecture:** Reaproveita `Client.status=INACTIVE` como base; adiciona `Client.deactivatedAt` para contar os 30 dias. Dois endpoints novos (`PATCH /clients/:id/restore`, `GET /clients/trash`), um método de purga reaproveitado tanto na leitura da lixeira (purga defensiva) quanto num cron diário (`@nestjs/schedule`). Frontend ganha um botão "Lixeira" que abre um drawer novo (`ClientTrashDrawer`) no mesmo padrão visual do `ClientFinanceDrawer`.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend, já existente); `@nestjs/schedule` (novo); React + TypeScript + Tailwind + framer-motion + lucide-react (frontend, já existente).

**Spec:** `docs/superpowers/specs/2026-09-10-client-trash-design.md`

## Global Constraints

- **Regra de negócio central:** só clientes desativados com `includeInRevenueReport=false` entram na lixeira e são elegíveis para purga. Clientes com `includeInRevenueReport=true` ficam `INACTIVE` para sempre, nunca são purgados, independente de quão antigo for `deactivatedAt`.
- **Nunca commitar automaticamente.** Esta sessão só cria commits quando o usuário pede explicitamente — nenhuma tarefa abaixo inclui passo de commit; ao final de tudo, pergunte ao usuário se quer que os commits sejam feitos.
- **TDD obrigatório em toda mudança de backend** (RED → GREEN), seguindo o padrão já usado em `clients.service.spec.ts`: `PrismaService` mockado como objeto simples de `jest.fn()`, nunca um banco real nos testes unitários.
- **Migrations sempre hand-written**, aplicadas via `npx prisma migrate deploy` (nunca `prisma migrate dev` interativo nem `--shadow-database-url` apontado para `quickflow`/`quickflow_test` — ver o incidente de perda de dados documentado em `[[DECISOES-TECNICAS]]` no vault Obsidian, `B:\Quickflow\Quickflow`).
- **`@nestjs/schedule@^6.1.3`** — versão compatível com o `@nestjs/core@^10.4.6` já instalado (a major mais nova, 12.x, exige Nest 11+).
- Textos de UI em português; ícones só via `lucide-react`; estilização só com classes Tailwind usando os tokens já definidos (`bg-panel`, `text-foreground`, `bg-primary`, etc.), nunca cor hardcoded; navegação interna nunca via `<a>`.
- Backend lint roda com `--max-warnings 0` — tratar warning como erro.
- Preserve todas as funcionalidades existentes (deactivate/edit/relatórios) — nenhuma mudança fora do escopo desta lixeira.
- Documentação (vault Obsidian + `CLAUDE.md`) só é atualizada na Tarefa 12, ao final, e sem duplicar conteúdo já existente.

---

## File Structure

**Backend:**
- Modify: `backend/prisma/schema.prisma` — campo `Client.deactivatedAt`.
- Create: `backend/prisma/migrations/<TIMESTAMP>_add_client_deactivated_at/migration.sql`.
- Modify: `backend/src/clients/clients.service.ts` — `deactivate()` grava `deactivatedAt`; novos métodos `restore()`, `purgeExpiredTrash()`, `findTrash()`, cron `purgeExpiredTrashCron()`.
- Modify: `backend/src/clients/clients.controller.ts` — novas rotas `GET /clients/trash` (antes de `GET /clients/:id`) e `PATCH /clients/:id/restore`.
- Modify: `backend/src/clients/dto/update-client.dto.ts` — remove `status`.
- Modify: `backend/src/app.module.ts` — importa `ScheduleModule.forRoot()`.
- Modify: `backend/package.json` — nova dependência `@nestjs/schedule`.
- Modify (tests): `backend/src/clients/clients.service.spec.ts`, `backend/test/app.e2e-spec.ts`.

**Frontend:**
- Modify: `src/lib/api.ts` — `ClientRecord.deactivatedAt`, `listTrashedClients()`, `restoreClient()`, `updateClient()` sem `status`.
- Create: `src/components/ClientTrashDrawer.tsx`.
- Modify: `src/pages/app/ClientsList.tsx` — botão "Lixeira", estado do drawer, `handleUpdateClient` sem `status`.

**Docs (Tarefa 12):**
- Modify: `B:\Quickflow\Quickflow\BANCO-DE-DADOS.md`, `B:\Quickflow\Quickflow\API.md`, `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`, `C:\Users\cadus\Desktop\product\CLAUDE.md`.

---

### Task 1: Schema + migration — campo `deactivatedAt`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<TIMESTAMP>_add_client_deactivated_at/migration.sql`

**Interfaces:**
- Produces: `Client.deactivatedAt: DateTime | null` — todas as tarefas seguintes (2 a 8) dependem deste campo existir no schema e no banco real (`quickflow` e `quickflow_test`).

- [ ] **Step 1: Adicionar o campo ao model `Client` em `schema.prisma`**

Trocar o bloco `model Client { ... }` por:

```prisma
model Client {
  id            String         @id @default(cuid())
  name          String
  category      String?
  contact       String
  email         String?
  status        ClientStatus   @default(ACTIVE)
  // Independent of `status`: whether this client's receivables/subscriptions
  // count toward the company-wide financial report (GET /reports/financial-summary).
  // Set explicitly when deactivating a client (PATCH /clients/:id/deactivate) —
  // never inferred from `status`. An inactive client can still have this true
  // (kept in reports) and, in principle, an active client could have it false.
  includeInRevenueReport Boolean @default(true)
  // Null while status=ACTIVE. Set to now() by /deactivate, cleared by /restore.
  // Only clients with includeInRevenueReport=false are ever purged based on
  // this timestamp (see ClientsService.purgeExpiredTrash) — clients kept in
  // the report (includeInRevenueReport=true) stay inactive forever, never purged.
  deactivatedAt DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  receivables   Receivable[]
  subscriptions Subscription[]

  @@index([status])
  @@index([deactivatedAt])
}
```

- [ ] **Step 2: Atualizar os comentários de `onDelete: Cascade`, agora alcançáveis de verdade**

Em `model Receivable`, trocar o comentário acima de `client Client @relation(...)`:
```prisma
  // Cascade is reachable via ClientsService.purgeExpiredTrash (the client
  // trash — 30-day auto-purge for clients deactivated with
  // includeInRevenueReport=false) — deleting a Client there deletes its
  // receivables/subscriptions too.
```

Em `model Subscription`, trocar o mesmo comentário (idêntico hoje) pelo mesmo texto acima.

- [ ] **Step 3: Gerar o timestamp e criar a migration à mão**

```bash
date +%Y%m%d%H%M%S
```

Use o valor impresso como `<TIMESTAMP>` e crie
`backend/prisma/migrations/<TIMESTAMP>_add_client_deactivated_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Client" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Client_deactivatedAt_idx" ON "Client"("deactivatedAt");
```

- [ ] **Step 4: Aplicar contra `quickflow` e `quickflow_test` (processo seguro, sem shadow database)**

```bash
cd backend
npx prisma migrate deploy
```

Depois, repita contra o banco de teste (substitua o nome do banco no
`DATABASE_URL`, sem tocar no `.env` real):

```bash
DATABASE_URL="<mesma_url_com_/quickflow_test_no_lugar_de_/quickflow>" npx prisma migrate deploy
```

```bash
npx prisma generate
```

- [ ] **Step 5: Verificar**

```bash
npx prisma migrate status
DATABASE_URL="<...quickflow_test...>" npx prisma migrate status
```

Ambos devem imprimir "Database schema is up to date!".

---

### Task 2: `deactivate()` grava `deactivatedAt`

**Files:**
- Modify: `backend/src/clients/clients.service.ts`
- Test: `backend/src/clients/clients.service.spec.ts`

**Interfaces:**
- Consumes: `deactivate(id, dto: DeactivateClientDto)` já existente.
- Produces: `prisma.client.update` agora sempre inclui `deactivatedAt: new Date()` no `data` — Tarefa 3 (`restore`) e Tarefa 4 (`purgeExpiredTrash`) dependem desse valor estar populado.

- [ ] **Step 1: Escrever os testes que falham**

Dentro de `describe('deactivate', ...)`, atualize as DUAS expectativas de `data:` já existentes para incluírem `deactivatedAt`, e adicione um teste novo:

```ts
    it('deactivates the client and pauses its active subscriptions in one transaction, storing the chosen revenue flag', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false });
      prisma.subscription.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.deactivate('1', { includeInRevenueReport: false });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'INACTIVE', includeInRevenueReport: false, deactivatedAt: expect.any(Date) },
      });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { clientId: '1', status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
      expect(result).toEqual({ id: '1', status: 'INACTIVE', includeInRevenueReport: false });
    });

    it('preserves includeInRevenueReport=true when that is the chosen option', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: true });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await service.deactivate('1', { includeInRevenueReport: true });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'INACTIVE', includeInRevenueReport: true, deactivatedAt: expect.any(Date) },
      });
    });

    it('records deactivatedAt as the current time', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false, deactivatedAt: new Date() });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await service.deactivate('1', { includeInRevenueReport: false });
      const after = Date.now();

      const passedAt: Date = (prisma.client.update as jest.Mock).mock.calls[0][0].data.deactivatedAt;
      expect(passedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(passedAt.getTime()).toBeLessThanOrEqual(after);
    });
```

(Substitua os dois testes já existentes com esse mesmo nome pelo texto acima — eles só ganham o campo `deactivatedAt: expect.any(Date)` na expectativa; o terceiro teste é novo.)

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd backend && npx jest clients.service.spec.ts -t deactivate
```
Esperado: FAIL nos dois testes atualizados (o `data` real ainda não inclui `deactivatedAt`).

- [ ] **Step 3: Implementar**

Em `clients.service.ts`, dentro de `deactivate()`, trocar o objeto `data` do `client.update`:

```ts
    const [updatedClient] = await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id },
        data: {
          status: ClientStatus.INACTIVE,
          includeInRevenueReport: dto.includeInRevenueReport,
          deactivatedAt: new Date(),
        },
      }),
      this.prisma.subscription.updateMany({
        where: { clientId: id, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.INACTIVE },
      }),
    ]);
```

- [ ] **Step 4: Rodar e confirmar sucesso**

```bash
npx jest clients.service.spec.ts
```
Esperado: PASS em todos os testes do arquivo.

---

### Task 3: `restore()` + `PATCH /clients/:id/restore`

**Files:**
- Modify: `backend/src/clients/clients.service.ts`
- Modify: `backend/src/clients/clients.controller.ts`
- Test: `backend/src/clients/clients.service.spec.ts`

**Interfaces:**
- Consumes: `assertExists(id)` (privado, já existe em `ClientsService`).
- Produces: `restore(id): Promise<Client>` — usado pela Tarefa 11 (frontend, via `PATCH /clients/:id/restore`) e testado em e2e na Tarefa 8.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar depois de `describe('deactivate', ...)`, dentro do mesmo arquivo:

```ts
  describe('restore', () => {
    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(service.restore('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the client is already active', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      await expect(service.restore('1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it('reactivates the client and clears deactivatedAt, without touching includeInRevenueReport', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'ACTIVE', includeInRevenueReport: false, deactivatedAt: null });

      const result = await service.restore('1');

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'ACTIVE', deactivatedAt: null },
      });
      expect(result).toEqual({ id: '1', status: 'ACTIVE', includeInRevenueReport: false, deactivatedAt: null });
    });
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx jest clients.service.spec.ts -t restore
```
Esperado: FAIL (`service.restore is not a function`).

- [ ] **Step 3: Implementar o método no serviço**

Em `clients.service.ts`, adicionar logo depois do método `deactivate(...)`:

```ts
  // Reverses a deactivation — works for either group (kept in reports or
  // not). Never touches includeInRevenueReport: that decision stays
  // whatever it was set to at the last /deactivate call, independent of
  // status.
  async restore(id: string) {
    const client = await this.assertExists(id);
    if (client.status === ClientStatus.ACTIVE) {
      throw new ConflictException(`Cliente ${id} já está ativo`);
    }
    return this.prisma.client.update({
      where: { id },
      data: { status: ClientStatus.ACTIVE, deactivatedAt: null },
    });
  }
```

- [ ] **Step 4: Adicionar a rota no controller**

Em `clients.controller.ts`, adicionar logo depois da rota `deactivate`:

```ts
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.clientsService.restore(id);
  }
```

- [ ] **Step 5: Rodar e confirmar sucesso**

```bash
npx jest clients.service.spec.ts
```
Esperado: PASS em todos os testes.

---

### Task 4: `purgeExpiredTrash()`

**Files:**
- Modify: `backend/src/clients/clients.service.ts`
- Test: `backend/src/clients/clients.service.spec.ts`

**Interfaces:**
- Produces: `purgeExpiredTrash(): Promise<number>` — usado pela Tarefa 5 (`findTrash`, purga defensiva) e pela Tarefa 7 (cron diário).

- [ ] **Step 1: Adicionar `deleteMany` ao mock de `prisma.client` no `beforeEach`**

No topo do arquivo, dentro do objeto `prisma.client` construído em `beforeEach`, adicionar a chave que falta:

```ts
      client: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
```

- [ ] **Step 2: Escrever os testes que falham**

```ts
  describe('purgeExpiredTrash', () => {
    it('deletes only clients inactive for more than 30 days with includeInRevenueReport=false', async () => {
      prisma.client.deleteMany.mockResolvedValue({ count: 2 });

      const count = await service.purgeExpiredTrash();

      expect(prisma.client.deleteMany).toHaveBeenCalledWith({
        where: {
          status: 'INACTIVE',
          includeInRevenueReport: false,
          deactivatedAt: { lt: expect.any(Date) },
        },
      });
      expect(count).toBe(2);
    });

    it('the cutoff passed to Prisma is approximately 30 days in the past', async () => {
      prisma.client.deleteMany.mockResolvedValue({ count: 0 });
      const before = Date.now();

      await service.purgeExpiredTrash();

      const cutoff: Date = prisma.client.deleteMany.mock.calls[0][0].where.deactivatedAt.lt;
      const expectedCutoff = before - 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
    });
  });
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
npx jest clients.service.spec.ts -t purgeExpiredTrash
```
Esperado: FAIL (`service.purgeExpiredTrash is not a function`).

- [ ] **Step 4: Implementar**

Em `clients.service.ts`, adicionar depois de `restore(...)`:

```ts
  // Only the "not kept in reports" group is ever auto-purged — clients
  // deactivated with includeInRevenueReport=true stay inactive forever
  // (purging them would destroy the history the user explicitly asked to
  // keep in the financial report). The FK cascade on Receivable/Subscription
  // (onDelete: Cascade) takes care of deleting their historical data too.
  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const result = await this.prisma.client.deleteMany({
      where: {
        status: ClientStatus.INACTIVE,
        includeInRevenueReport: false,
        deactivatedAt: { lt: cutoff },
      },
    });
    return result.count;
  }
```

- [ ] **Step 5: Rodar e confirmar sucesso**

```bash
npx jest clients.service.spec.ts
```
Esperado: PASS em todos os testes.

---

### Task 5: `findTrash()` + `GET /clients/trash`

**Files:**
- Modify: `backend/src/clients/clients.service.ts`
- Modify: `backend/src/clients/clients.controller.ts`
- Test: `backend/src/clients/clients.service.spec.ts`

**Interfaces:**
- Consumes: `purgeExpiredTrash()` (Tarefa 4).
- Produces: `findTrash(): Promise<Client[]>` — consumido pelo frontend na Tarefa 9 (`listTrashedClients`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
  describe('findTrash', () => {
    it('purges expired entries first, then returns only INACTIVE clients with includeInRevenueReport=false, oldest deactivation first', async () => {
      prisma.client.deleteMany.mockResolvedValue({ count: 0 });
      const trashed = [{ id: '1', status: 'INACTIVE', includeInRevenueReport: false, deactivatedAt: new Date('2026-09-01') }];
      prisma.client.findMany.mockResolvedValue(trashed);

      const result = await service.findTrash();

      expect(prisma.client.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { status: 'INACTIVE', includeInRevenueReport: false },
        orderBy: { deactivatedAt: 'asc' },
      });
      expect(result).toEqual(trashed);
    });
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx jest clients.service.spec.ts -t findTrash
```
Esperado: FAIL (`service.findTrash is not a function`).

- [ ] **Step 3: Implementar**

Em `clients.service.ts`, adicionar depois de `purgeExpiredTrash(...)`:

```ts
  // The "Lixeira" view — only ever shows the group that's actually subject
  // to the 30-day auto-purge (includeInRevenueReport=false). Runs a
  // defensive purge first so the list — and the purge itself — stays
  // correct even if the daily cron missed a run (this is a local app, not
  // always running).
  async findTrash() {
    await this.purgeExpiredTrash();
    return this.prisma.client.findMany({
      where: { status: ClientStatus.INACTIVE, includeInRevenueReport: false },
      orderBy: { deactivatedAt: 'asc' },
    });
  }
```

- [ ] **Step 4: Adicionar a rota — ANTES de `@Get(':id')`**

Em `clients.controller.ts`, inserir logo depois de `@Get() findAll(...)` e **antes** de `@Get(':id') findOne(...)` (ordem importa: o Nest resolve rotas na ordem declarada, senão `trash` seria capturado como `:id`):

```ts
  @Get('trash')
  findTrash() {
    return this.clientsService.findTrash();
  }
```

- [ ] **Step 5: Rodar e confirmar sucesso**

```bash
npx jest clients.service.spec.ts
```
Esperado: PASS em todos os testes.

---

### Task 6: Fechar a brecha — `status` sai de `UpdateClientDto`

**Files:**
- Modify: `backend/src/clients/dto/update-client.dto.ts`
- Modify: `backend/src/clients/clients.service.spec.ts`
- Modify: `backend/test/app.e2e-spec.ts`

**Interfaces:**
- Produces: `UpdateClientDto` sem `status` — o `ValidationPipe` global (`forbidNonWhitelisted: true`) passa a rejeitar `status` em `PATCH /clients/:id` com 400, verificado em e2e na Tarefa 8.

- [ ] **Step 1: Remover `status` do DTO**

Trocar o conteúdo de `update-client.dto.ts` por:

```ts
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() @MinLength(1) contact?: string;
  @IsOptional() @IsEmail() email?: string;
}
```

- [ ] **Step 2: Corrigir o teste unitário que dependia de `status`**

Em `clients.service.spec.ts`, trocar o teste `'updates only after confirming the client exists'` por:

```ts
  it('updates only after confirming the client exists', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: '1' });
    prisma.client.update.mockResolvedValue({ id: '1', name: 'Ana Nova' });

    const result = await service.update('1', { name: 'Ana Nova' });

    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { name: 'Ana Nova' },
    });
    expect(result).toEqual({ id: '1', name: 'Ana Nova' });
  });
```

- [ ] **Step 3: Rodar e confirmar sucesso**

```bash
npx jest clients.service.spec.ts
```
Esperado: PASS em todos os testes.

- [ ] **Step 4: Adicionar o teste e2e da validação (roda de verdade só na Tarefa 8, junto com o resto do e2e)**

Em `backend/test/app.e2e-spec.ts`, adicionar um novo `it` (pode ir logo antes do fechamento do `describe`):

```ts
  it('rejects status in PATCH /clients/:id — lifecycle changes only go through /deactivate and /restore', async () => {
    const clientRes = await request(app.getHttpServer())
      .post('/clients')
      .send({ name: 'Cliente E2E Status Bloqueado', contact: '(11) 93333-3333' })
      .expect(201);

    try {
      await request(app.getHttpServer())
        .patch(`/clients/${clientRes.body.id}`)
        .send({ status: 'INACTIVE' })
        .expect(400);
    } finally {
      await prisma.client.delete({ where: { id: clientRes.body.id } });
    }
  });
```

---

### Task 7: Cron diário (`@nestjs/schedule`)

**Files:**
- Modify: `backend/package.json` (via `npm install`)
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/clients/clients.service.ts`

**Interfaces:**
- Consumes: `purgeExpiredTrash()` (Tarefa 4).
- Produces: nenhuma interface nova consumida por outras tarefas — é só o gatilho de fundo. A Tarefa 8 (e2e) depende do `AppModule` continuar bootando corretamente com `ScheduleModule` importado.

- [ ] **Step 1: Instalar a dependência**

```bash
cd backend
npm install @nestjs/schedule@^6.1.3
```

- [ ] **Step 2: Importar `ScheduleModule` no `AppModule`**

Em `app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { ReportsModule } from './reports/reports.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    // Must come first: loads backend/.env into process.env before PrismaService
    // (and anything else reading DATABASE_URL) is instantiated.
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ClientsModule,
    ReceivablesModule,
    SubscriptionsModule,
    ReportsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Adicionar o método agendado em `ClientsService`**

No topo de `clients.service.ts`, ajustar os imports:

```ts
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientStatus, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
```

Dentro da classe, adicionar um `Logger` e o método agendado (antes do `constructor` ou logo abaixo dele):

```ts
@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Daily safety net for the 30-day trash purge — findTrash() already
  // purges defensively on every read, so this only matters when nobody
  // opens the Lixeira for a while. Errors are logged, never thrown: a
  // failed purge attempt must not crash the whole backend process.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredTrashCron() {
    try {
      const count = await this.purgeExpiredTrash();
      if (count > 0) this.logger.log(`Purged ${count} client(s) from the trash`);
    } catch (err) {
      this.logger.error('Failed to purge expired client trash', err instanceof Error ? err.stack : String(err));
    }
  }

  ...
```

(mantenha o restante da classe como está — só adiciona o `Logger` e este método novo.)

- [ ] **Step 4: Confirmar que os testes unitários existentes continuam passando com o decorator novo**

```bash
npx jest clients.service.spec.ts
```
Esperado: PASS — `Test.createTestingModule` sem `ScheduleModule` ainda instancia `ClientsService` normalmente; o decorator `@Cron` só registra de verdade quando o módulo é bootado via `ScheduleModule` (o que só acontece nos testes e2e, Tarefa 8).

- [ ] **Step 5: Rodar a suíte completa de unitários**

```bash
npx jest
```
Esperado: PASS em todos os arquivos.

---

### Task 8: Testes e2e da lixeira (fluxo completo + purga real)

**Files:**
- Modify: `backend/test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: todas as rotas/métodos das Tarefas 2-7, contra um `PrismaService` real (banco `quickflow_test`).

- [ ] **Step 1: Escrever o teste completo**

Adicionar ao final do `describe`, depois do teste da Tarefa 6:

```ts
  it('client trash: deactivating with includeInRevenueReport=false enters the trash, can be restored, and purges for real after 30 days — while includeInRevenueReport=true never gets purged', async () => {
    const server = app.getHttpServer();

    const trashed = (
      await request(server).post('/clients').send({ name: 'Cliente E2E Lixeira', contact: '(11) 94444-4444' }).expect(201)
    ).body;
    const kept = (
      await request(server).post('/clients').send({ name: 'Cliente E2E Mantido', contact: '(11) 95555-5555' }).expect(201)
    ).body;

    try {
      await request(server).patch(`/clients/${trashed.id}/deactivate`).send({ includeInRevenueReport: false }).expect(200);
      await request(server).patch(`/clients/${kept.id}/deactivate`).send({ includeInRevenueReport: true }).expect(200);

      // Rule: only the "not kept in reports" client shows up in the trash.
      const trashListing = await request(server).get('/clients/trash').expect(200);
      const trashIds = trashListing.body.map((c: { id: string }) => c.id);
      expect(trashIds).toContain(trashed.id);
      expect(trashIds).not.toContain(kept.id);

      // Rule: restoring reactivates and removes it from the trash.
      await request(server).patch(`/clients/${trashed.id}/restore`).expect(200);
      const afterRestore = await request(server).get('/clients/trash').expect(200);
      expect(afterRestore.body.map((c: { id: string }) => c.id)).not.toContain(trashed.id);
      const activeListing = await request(server).get('/clients?status=ACTIVE&pageSize=100').expect(200);
      expect(activeListing.body.items.map((c: { id: string }) => c.id)).toContain(trashed.id);

      // Restoring an already-active client is rejected.
      await request(server).patch(`/clients/${trashed.id}/restore`).expect(409);

      // Put it back in the trash, then simulate 31 days having passed.
      await request(server).patch(`/clients/${trashed.id}/deactivate`).send({ includeInRevenueReport: false }).expect(200);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 31);
      await prisma.client.update({ where: { id: trashed.id }, data: { deactivatedAt: cutoff } });
      await prisma.client.update({ where: { id: kept.id }, data: { deactivatedAt: cutoff } });

      // Opening the trash triggers the defensive purge: `trashed` (flag=false,
      // past the cutoff) is really gone; `kept` (flag=true) survives untouched
      // even though its deactivatedAt is just as old.
      await request(server).get('/clients/trash').expect(200);
      await request(server).get(`/clients/${trashed.id}`).expect(404);
      await request(server).get(`/clients/${kept.id}`).expect(200);
    } finally {
      await prisma.receivable.deleteMany({ where: { clientId: { in: [trashed.id, kept.id] } } });
      await prisma.client.deleteMany({ where: { id: { in: [trashed.id, kept.id] } } });
    }
  });
```

(o `finally` é seguro mesmo se `trashed` já tiver sido apagado pela purga dentro do próprio teste — `deleteMany` em um id inexistente não lança erro.)

- [ ] **Step 2: Rodar contra o banco de teste e confirmar sucesso**

```bash
cd backend
DATABASE_URL="<mesma_url_com_/quickflow_test_no_lugar_de_/quickflow>" npm run test:e2e
```
Esperado: PASS em todos os testes do arquivo (os já existentes + os dois novos desta plan).

---

### Task 9: Frontend — `src/lib/api.ts`

**Files:**
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: `listTrashedClients(): Promise<ClientRecord[]>`, `restoreClient(id): Promise<ClientRecord>`, `ClientRecord.deactivatedAt: string | null` — consumidos pela Tarefa 10 (`ClientTrashDrawer`) e Tarefa 11 (`ClientsList`).

- [ ] **Step 1: Estender as interfaces**

Em `ApiClient`, adicionar depois de `includeInRevenueReport: boolean;`:
```ts
  deactivatedAt: string | null;
```

Em `ClientRecord`, adicionar depois do comentário/campo `includeInRevenueReport`:
```ts
  // Null unless the client is in the trash (status=inactive AND
  // includeInRevenueReport=false) — only that group has a purge countdown.
  // Clients deactivated with includeInRevenueReport=true stay inactive
  // forever and this stays null-ish for UI purposes (ClientTrashDrawer never
  // shows them, since listTrashedClients() already filters server-side).
  deactivatedAt: string | null;
```

- [ ] **Step 2: Atualizar `mapClient`**

```ts
function mapClient(c: ApiClient): ClientRecord {
  return {
    id: c.id,
    name: c.name,
    category: c.category ?? '',
    contact: c.contact,
    email: c.email ?? undefined,
    status: c.status.toLowerCase() as 'active' | 'inactive',
    includeInRevenueReport: c.includeInRevenueReport,
    deactivatedAt: c.deactivatedAt ?? null,
  };
}
```

- [ ] **Step 3: Remover `status` do tipo de `updateClient`**

```ts
export async function updateClient(
  id: string,
  dto: Partial<{ name: string; category: string; contact: string; email: string }>,
): Promise<ClientRecord> {
  const c = await request<ApiClient>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  return mapClient(c);
}
```

(isso troca a função inteira — o corpo atual já faz `status.toUpperCase()`/desestruturação que não existe mais; o novo corpo é mais simples porque não sobra nenhum campo especial pra tratar.)

- [ ] **Step 4: Adicionar as duas funções novas**

Logo depois de `deactivateClient(...)`:

```ts
// "Lixeira" — só clientes desativados com includeInRevenueReport=false
// aparecem aqui (o backend já filtra isso em GET /clients/trash).
export async function listTrashedClients(): Promise<ClientRecord[]> {
  const items = await request<ApiClient[]>(`/clients/trash`);
  return items.map(mapClient);
}

export async function restoreClient(id: string): Promise<ClientRecord> {
  const c = await request<ApiClient>(`/clients/${id}/restore`, { method: 'PATCH' });
  return mapClient(c);
}
```

- [ ] **Step 5: Verificar**

```bash
cd .. # repo root
npx tsc -b
```
Esperado: nenhum erro novo em `src/lib/api.ts` (os erros pré-existentes em outros arquivos não relacionados a este trabalho continuam, ignore-os).

---

### Task 10: Frontend — `ClientTrashDrawer.tsx`

**Files:**
- Create: `src/components/ClientTrashDrawer.tsx`

**Interfaces:**
- Consumes: `listTrashedClients()`, `restoreClient()`, `ClientRecord` (Tarefa 9).
- Produces: `<ClientTrashDrawer onClose={...} onRestored={...} />` — consumido pela Tarefa 11.

- [ ] **Step 1: Criar o componente**

```tsx
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { listTrashedClients, restoreClient } from '../lib/api';
import type { ClientRecord } from '../lib/api';

interface ClientTrashDrawerProps {
  onClose: () => void;
  // Chamado depois de uma restauração bem-sucedida — o pai recarrega a
  // listagem padrão de clientes (mais simples do que reconstruir o estado
  // completo do cliente a partir do payload parcial da lixeira).
  onRestored: () => void;
}

const DAYS_UNTIL_PURGE = 30;

function daysRemaining(deactivatedAt: string | null): number {
  if (!deactivatedAt) return DAYS_UNTIL_PURGE;
  const elapsedMs = Date.now() - new Date(deactivatedAt).getTime();
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  return Math.max(0, DAYS_UNTIL_PURGE - elapsedDays);
}

const ClientTrashDrawer: React.FC<ClientTrashDrawerProps> = ({ onClose, onRestored }) => {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    listTrashedClients()
      .then((items) => { if (!cancelled) setClients(items); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar a lixeira.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleRestore = async (id: string) => {
    if (restoringId) return; // evita duplo clique disparando duas restaurações
    setRestoringId(id);
    setError(null);
    try {
      await restoreClient(id);
      setClients((prev) => prev.filter((c) => c.id !== id));
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível restaurar o cliente.');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-background/80 backdrop-blur-sm flex justify-end"
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ x: '100%', opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0.5 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="bg-background border-l border-border/60 w-full max-w-lg h-full flex flex-col shadow-2xl relative"
        >
          <div className="p-6 md:p-8 border-b border-border/40 shrink-0 bg-secondary/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h2 className="text-lg font-heading font-bold text-foreground">Lixeira de Clientes</h2>
                <p className="text-xs text-muted">Excluídos há menos de 30 dias podem ser restaurados</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
                {error}
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted">
                <Loader2 className="animate-spin" size={24} />
              </div>
            ) : clients.length === 0 ? (
              <div className="text-center py-12 bg-secondary/10 border border-border/40 border-dashed rounded-2xl">
                <Trash2 size={32} className="mx-auto text-muted/50 mb-3" />
                <p className="text-sm font-bold text-foreground">Lixeira vazia</p>
                <p className="text-xs text-muted mt-1">Clientes excluídos sem manter no relatório aparecem aqui por 30 dias.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {clients.map((client) => {
                  const remaining = daysRemaining(client.deactivatedAt);
                  const isRestoring = restoringId === client.id;
                  return (
                    <div key={client.id} className="p-4 rounded-2xl border border-border/40 bg-secondary/10 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{client.name}</p>
                        <p className="text-xs text-muted">
                          {remaining > 0 ? `Expira em ${remaining} dia${remaining === 1 ? '' : 's'}` : 'Expira hoje'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRestore(client.id)}
                        disabled={isRestoring}
                        className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-primary hover:text-white hover:bg-primary px-3 py-2 rounded-lg transition-colors border border-primary/30 disabled:opacity-60"
                      >
                        <RotateCcw size={14} />
                        {isRestoring ? 'Restaurando...' : 'Restaurar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ClientTrashDrawer;
```

- [ ] **Step 2: Verificar**

```bash
npx tsc -b
```
Esperado: nenhum erro em `src/components/ClientTrashDrawer.tsx`.

---

### Task 11: Frontend — ligar o botão "Lixeira" em `ClientsList.tsx`

**Files:**
- Modify: `src/pages/app/ClientsList.tsx`

**Interfaces:**
- Consumes: `ClientTrashDrawer` (Tarefa 10), `loadClients()` (já existente, usado como `onRestored`).

- [ ] **Step 1: Import — adicionar `Trash2` e o componente novo**

Trocar a linha 4:
```tsx
import { Plus, Search, Filter, X, HeartHandshake, FileText, CheckCircle2, AlertCircle, Clock, Loader2, ChevronRight, Trash2 } from 'lucide-react';
```

E adicionar, logo abaixo do import de `ClientReportModal` (linha 6):
```tsx
import ClientTrashDrawer from '../../components/ClientTrashDrawer';
```

- [ ] **Step 2: Estado do drawer**

Logo depois de `const [isReportModalOpen, setIsReportModalOpen] = useState(false);` (linha 34):
```tsx
  const [isTrashOpen, setIsTrashOpen] = useState(false);
```

- [ ] **Step 3: Fechar com Esc e travar o scroll do body**

Trocar o `useEscapeKey` (linhas 41-45):
```tsx
  useEscapeKey(() => {
    setSelectedClient(null);
    setIsNewClientModalOpen(false);
    setIsReportModalOpen(false);
    setIsTrashOpen(false);
  });
```

Trocar o `useEffect` de overflow (linhas 47-56):
```tsx
  useEffect(() => {
    if (selectedClient || isNewClientModalOpen || isReportModalOpen || isTrashOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedClient, isNewClientModalOpen, isReportModalOpen, isTrashOpen]);
```

- [ ] **Step 4: Remover `status` do tipo de `handleUpdateClient`**

Trocar (linhas 143-146):
```tsx
  const handleUpdateClient = async (
    clientId: string,
    dto: Partial<{ name: string; category: string; contact: string; email: string }>,
  ): Promise<boolean> => {
```

- [ ] **Step 5: Botão "Lixeira" no header**

No grupo de botões do header (linhas 266-283), adicionar entre "Relatórios" e "Novo Cliente":
```tsx
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/80 text-foreground font-medium hover:bg-secondary transition-colors shadow-sm text-sm"
          >
            <FileText size={16} />
            Relatórios
          </button>
          <button
            onClick={() => setIsTrashOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/80 text-foreground font-medium hover:bg-secondary transition-colors shadow-sm text-sm"
          >
            <Trash2 size={16} />
            Lixeira
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsNewClientModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 text-sm"
          >
            <Plus size={18} />
            Novo Cliente
          </motion.button>
        </div>
```

- [ ] **Step 6: Renderizar o drawer**

Logo depois do bloco "Report Modal" (linhas 509-515), antes do `</div>` final do componente:
```tsx
      {/* Client Trash Drawer */}
      {isTrashOpen && createPortal(
        <ClientTrashDrawer
          onClose={() => setIsTrashOpen(false)}
          onRestored={loadClients}
        />,
        document.body
      )}
```

- [ ] **Step 7: Verificar**

```bash
npx tsc -b
```
Esperado: nenhum erro novo em `src/pages/app/ClientsList.tsx`.

---

### Task 12: Documentação (vault Obsidian + `CLAUDE.md`)

**Files:**
- Modify: `B:\Quickflow\Quickflow\BANCO-DE-DADOS.md`
- Modify: `B:\Quickflow\Quickflow\API.md`
- Modify: `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`
- Modify: `C:\Users\cadus\Desktop\product\CLAUDE.md`

- [ ] **Step 1: `BANCO-DE-DADOS.md`**

No bloco de schema completo e na seção "Modelos" > `Client`, adicionar o campo `deactivatedAt` (mesmo texto do comentário do Step 1 da Tarefa 1), mencionando o índice novo `@@index([deactivatedAt])` e a regra de que só `includeInRevenueReport=false` é purgado.

- [ ] **Step 2: `API.md`**

Adicionar duas linhas na tabela "Clientes":
- `PATCH /clients/:id/restore` — reativa qualquer cliente `INACTIVE` (dos dois grupos), limpa `deactivatedAt`, não mexe em `includeInRevenueReport`. 404/409.
- `GET /clients/trash` — lista só `status=INACTIVE AND includeInRevenueReport=false`, ordenado por `deactivatedAt` asc; dispara purga defensiva antes de responder.

E ajustar a linha de `PATCH /clients/:id` (já existente) para deixar claro que não aceita mais `status`.

- [ ] **Step 3: `DECISOES-TECNICAS.md`**

Adicionar uma subseção `4.2` (depois da `4.1` já existente sobre `includeInRevenueReport`), cobrindo: por que só o grupo `includeInRevenueReport=false` entra na lixeira (não destruir dados que o usuário pediu pra manter no relatório); o campo `deactivatedAt`; os dois endpoints novos; o mecanismo de purga em duas camadas (cron diário + purga defensiva em `GET /clients/trash`, porque o app não roda 24/7); e o link pra spec completa
(`docs/superpowers/specs/2026-09-10-client-trash-design.md`).

- [ ] **Step 4: `CLAUDE.md`**

Adicionar uma linha curta (mesmo padrão da linha já existente sobre exclusão lógica), mencionando a lixeira de 30 dias e remetendo ao vault pros detalhes.

---

### Task 13: Validação final

- [ ] **Step 1: Migrations**
```bash
cd backend
npx prisma migrate status
DATABASE_URL="<...quickflow_test...>" npx prisma migrate status
```

- [ ] **Step 2: Testes unitários + e2e**
```bash
npx jest
DATABASE_URL="<...quickflow_test...>" npm run test:e2e
```

- [ ] **Step 3: Lint + build do backend**
```bash
npm run lint
npm run build
```

- [ ] **Step 4: Type-check do frontend**
```bash
cd ..
npx tsc -b
```
Confirmar que nenhum erro novo aparece em `src/lib/api.ts`, `src/components/ClientTrashDrawer.tsx` ou `src/pages/app/ClientsList.tsx` (erros pré-existentes em outros arquivos não relacionados a este trabalho não são desta tarefa).

- [ ] **Step 5: Teste manual no browser**

Com os dois servidores (`npm run dev` no frontend, `npm run start:dev` no backend) já rodando: criar um cliente descartável pela UI, abrir seus detalhes, excluí-lo escolhendo "Não, remover dos relatórios", abrir a Lixeira e confirmar que ele aparece com "Expira em 30 dias", clicar "Restaurar" e confirmar que ele some da lixeira e volta a aparecer na listagem normal. Ao final, apagar o cliente de teste do banco (`prisma.client.deleteMany`) pra não sujar os dados reais.

- [ ] **Step 6: Não commitar**

Não criar nenhum commit — só ao final, perguntar ao usuário se ele quer que as mudanças sejam commitadas agora.
