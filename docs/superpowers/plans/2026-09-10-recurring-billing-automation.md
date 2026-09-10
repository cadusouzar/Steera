# Cobrança Automática Recorrente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `Subscription` (Clientes) e `EmployeeRecurringPayment` (Funcionários) gerarem sua cobrança do mês sozinhas, sem clique manual, através de um cron diário + uma checagem no boot da aplicação — sem duplicar nenhuma lógica de `generateCharge()` já existente e testada.

**Architecture:** Cada service ganha um método `generateDueCharges()` que só decide *quais* recorrências chamar `generateCharge()` agora (query declarativa: `ACTIVE`, `dueDay` já alcançado, sem cobrança no mês corrente, dono não inativo) — a criação da cobrança em si continua 100% no método já existente. Um `BillingSchedulerService` novo, isolado num módulo próprio, dispara os dois `generateDueCharges()` via `@Cron` diário e via `OnApplicationBootstrap`, com falhas isoladas por serviço (uma falha nunca impede a outra nem derruba o processo).

**Tech Stack:** NestJS, `@nestjs/schedule` (já usado no projeto pela purga da lixeira de clientes), Prisma, Jest.

**Spec:** `docs/superpowers/specs/2026-09-10-recurring-billing-automation-design.md`

## Global Constraints

- Nenhuma lógica de criação/idempotência de cobrança é duplicada — `generateCharge()` em ambos os services permanece intocado.
- Um erro num serviço (`SubscriptionsService` ou `EmployeeRecurringPaymentsService`) nunca impede a chamada do outro nem derruba o processo — cada chamada tem seu próprio try/catch, nunca um try/catch único envolvendo as duas.
- Um `ConflictException` (409, corrida entre duas execuções) é esperado e silenciosamente ignorado pelo catch-up; qualquer outro erro é logado.
- Sem catch-up retroativo de múltiplos meses — só o mês corrente é verificado a cada execução.
- Nenhuma migration nova (nenhum model/campo novo no schema).
- Nenhuma rota HTTP nova — isso é automação de fundo, não um recurso da API.
- Não alterar `generateCharge()`, DTOs, controllers ou qualquer comportamento já testado dos módulos `SubscriptionsModule`/`EmployeeRecurringPaymentsModule` além do estritamente necessário (adicionar um método novo a cada service, e um `exports` que falta num módulo).
- Design deve funcionar igualmente bem localmente (liga/desliga) e num servidor 24/7 — não hardcodar nenhuma suposição de "só roda localmente".

---

## Task 1: `SubscriptionsService.generateDueCharges()`

**Files:**
- Modify: `backend/src/subscriptions/subscriptions.service.ts`
- Modify: `backend/src/subscriptions/subscriptions.service.spec.ts`

**Interfaces:**
- Produces: `SubscriptionsService.generateDueCharges(): Promise<{ checked: number; generated: number }>`, consumido pelo `BillingSchedulerService` (Task 3).

- [ ] **Step 1: Escrever os testes (falha esperada)**

Adicionar ao final de `backend/src/subscriptions/subscriptions.service.spec.ts` (dentro do `describe('SubscriptionsService', ...)` existente, como um novo `describe`):

```ts
  describe('generateDueCharges', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('queries only ACTIVE subscriptions whose dueDay has arrived, whose client is not inactive, and that have no charge for the current reference month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.generateDueCharges();

      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          dueDay: { lte: 15 },
          client: { status: { not: 'INACTIVE' } },
          receivables: { none: { referenceYear: 2026, referenceMonth: 6 } },
        },
      });
    });

    it('calls generateCharge for each subscription returned and counts how many succeeded', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' });
      prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
      prisma.receivable.create.mockResolvedValue({ id: 'rec-1' });

      const result = await service.generateDueCharges();

      expect(prisma.receivable.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ checked: 2, generated: 2 });
    });

    it('ignores a ConflictException from one subscription and still processes the rest', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' });
      prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
      prisma.receivable.create
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002', clientVersion: '5.22.0', meta: { target: ['subscriptionId', 'referenceYear', 'referenceMonth'] },
          }),
        )
        .mockResolvedValueOnce({ id: 'rec-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
    });

    it('logs but does not throw when a non-conflict error occurs, and still processes the remaining subscriptions', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' });
      prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
      prisma.receivable.create
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ id: 'rec-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
    });
  });
```

Run: `cd backend && npx jest --testPathIgnorePatterns=test/ --testPathPattern=subscriptions.service`
Expected: FAIL ("service.generateDueCharges is not a function")

- [ ] **Step 2: Implementar `generateDueCharges()`**

Em `backend/src/subscriptions/subscriptions.service.ts`, atualizar o import do topo:

```ts
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClientStatus, Prisma, ReceivableStatus, Subscription, SubscriptionStatus } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
```

Adicionar o campo `logger` e o método novo à classe (a classe existente e todos os métodos atuais — `create`/`findAllForClient`/`findOne`/`update`/`remove`/`generateCharge` — continuam exatamente como estão, sem nenhuma outra alteração):

```ts
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ...métodos existentes sem alteração...

  // Só decide QUAIS assinaturas chamar generateCharge() agora — a criação da
  // cobrança em si (incluindo a proteção contra duplicidade via constraint
  // única) continua inteiramente em generateCharge(), sem duplicação.
  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;

    const dueSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        dueDay: { lte: currentDay },
        client: { status: { not: ClientStatus.INACTIVE } },
        receivables: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const subscription of dueSubscriptions) {
      try {
        await this.generateCharge(subscription.id);
        generated++;
      } catch (err) {
        // 409 = outra execução já gerou esta cobrança (corrida entre cron e
        // bootstrap, ou dois restarts próximos) — esperado, ignorado.
        if (!(err instanceof ConflictException)) {
          this.logger.error(
            `Falha ao gerar cobrança da assinatura ${subscription.id}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
    return { checked: dueSubscriptions.length, generated };
  }
}
```

- [ ] **Step 3: Rodar os testes para confirmar que passam**

Run: `cd backend && npx jest --testPathIgnorePatterns=test/ --testPathPattern=subscriptions.service`
Expected: PASS (4 novos testes, mais os já existentes)

- [ ] **Step 4: Rodar a suíte completa (garantir que nada quebrou)**

Run: `cd backend && npm run test`
Expected: PASS (todos os testes, incluindo os de outros módulos)

- [ ] **Step 5: Commit**

```bash
git add backend/src/subscriptions/subscriptions.service.ts backend/src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat(backend): add SubscriptionsService.generateDueCharges for automatic monthly billing"
```

---

## Task 2: `EmployeeRecurringPaymentsService.generateDueCharges()`

**Files:**
- Modify: `backend/src/employee-recurring-payments/employee-recurring-payments.service.ts`
- Modify: `backend/src/employee-recurring-payments/employee-recurring-payments.service.spec.ts`
- Modify: `backend/src/employee-recurring-payments/employee-recurring-payments.module.ts` (adicionar `exports`)

**Interfaces:**
- Produces: `EmployeeRecurringPaymentsService.generateDueCharges(): Promise<{ checked: number; generated: number }>`, consumido pelo `BillingSchedulerService` (Task 3) — que por sua vez exige que `EmployeeRecurringPaymentsModule` exporte o service (hoje não exporta).

- [ ] **Step 1: Escrever os testes (falha esperada)**

Adicionar ao final de `backend/src/employee-recurring-payments/employee-recurring-payments.service.spec.ts` (novo `describe`, mesmo padrão do Task 1, adaptado para este domínio):

```ts
  describe('generateDueCharges', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('queries only ACTIVE recurring payments whose dueDay has arrived, whose employee is not inactive, and that have no payment for the current reference month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([]);

      await service.generateDueCharges();

      expect(prisma.employeeRecurringPayment.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          dueDay: { lte: 15 },
          employee: { status: { not: 'INACTIVE' } },
          payments: { none: { referenceYear: 2026, referenceMonth: 6 } },
        },
      });
    });

    it('calls generateCharge for each recurring payment returned and counts how many succeeded', async () => {
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([
        { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
        id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
      });
      employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
      prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1' });

      const result = await service.generateDueCharges();

      expect(prisma.employeePayment.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ checked: 1, generated: 1 });
    });

    it('ignores a ConflictException from one recurring payment and still processes the rest', async () => {
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([
        { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
        { id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.employeeRecurringPayment.findFirst
        .mockResolvedValueOnce({ id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' });
      employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
      prisma.employeePayment.create
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002', clientVersion: '5.22.0', meta: { target: ['recurringPaymentId', 'referenceYear', 'referenceMonth'] },
          }),
        )
        .mockResolvedValueOnce({ id: 'payment-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
    });

    it('logs but does not throw when a non-conflict error occurs, and still processes the remaining recurring payments', async () => {
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([
        { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
        { id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.employeeRecurringPayment.findFirst
        .mockResolvedValueOnce({ id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' });
      employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
      prisma.employeePayment.create
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ id: 'payment-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
    });
  });
```

Confirme que o `beforeEach` deste arquivo já injeta um `CompanyContextService` mockado com `getCurrentCompanyId` resolvendo `'company-1'` (adicionado na Task 5 do plano de RH) — os testes acima dependem disso para o `assertExists` interno funcionar.

Run: `cd backend && npx jest --testPathIgnorePatterns=test/ --testPathPattern=employee-recurring-payments.service`
Expected: FAIL ("service.generateDueCharges is not a function")

- [ ] **Step 2: Implementar `generateDueCharges()`**

Em `backend/src/employee-recurring-payments/employee-recurring-payments.service.ts`, atualizar o import do topo:

```ts
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmployeeRecurringPayment, Prisma } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeRecurringPaymentDto } from './dto/create-employee-recurring-payment.dto';
import { UpdateEmployeeRecurringPaymentDto } from './dto/update-employee-recurring-payment.dto';
```

Adicionar o campo `logger` e o método novo (o resto da classe — `create`/`findAllForEmployee`/`assertExists`/`findOne`/`update`/`remove`/`generateCharge` — permanece exatamente como está):

```ts
@Injectable()
export class EmployeeRecurringPaymentsService {
  private readonly logger = new Logger(EmployeeRecurringPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // ...métodos existentes sem alteração...

  // Mesmo raciocínio de SubscriptionsService.generateDueCharges(): só decide
  // QUAIS recorrências chamar generateCharge() agora — nenhuma lógica de
  // criação/idempotência é duplicada.
  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;

    const dueRecurringPayments = await this.prisma.employeeRecurringPayment.findMany({
      where: {
        status: 'ACTIVE',
        dueDay: { lte: currentDay },
        employee: { status: { not: 'INACTIVE' } },
        payments: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const recurring of dueRecurringPayments) {
      try {
        await this.generateCharge(recurring.id);
        generated++;
      } catch (err) {
        if (!(err instanceof ConflictException)) {
          this.logger.error(
            `Falha ao gerar pagamento da recorrência ${recurring.id}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
    return { checked: dueRecurringPayments.length, generated };
  }
}
```

- [ ] **Step 3: Rodar os testes para confirmar que passam**

Run: `cd backend && npx jest --testPathIgnorePatterns=test/ --testPathPattern=employee-recurring-payments.service`
Expected: PASS (4 novos testes, mais os já existentes)

- [ ] **Step 4: Adicionar o `exports` que falta no módulo**

`EmployeeRecurringPaymentsModule` hoje não exporta `EmployeeRecurringPaymentsService` — o `BillingModule` (Task 3) precisa injetá-lo. Em `backend/src/employee-recurring-payments/employee-recurring-payments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeeRecurringPaymentsController } from './employee-recurring-payments.controller';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';

@Module({
  imports: [EmployeesModule, CompanyModule],
  controllers: [EmployeeRecurringPaymentsController],
  providers: [EmployeeRecurringPaymentsService],
  exports: [EmployeeRecurringPaymentsService],
})
export class EmployeeRecurringPaymentsModule {}
```

(única mudança: a linha `exports: [EmployeeRecurringPaymentsService],`)

- [ ] **Step 5: Rodar a suíte completa (garantir que nada quebrou)**

Run: `cd backend && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/employee-recurring-payments/employee-recurring-payments.service.ts backend/src/employee-recurring-payments/employee-recurring-payments.service.spec.ts backend/src/employee-recurring-payments/employee-recurring-payments.module.ts
git commit -m "feat(backend): add EmployeeRecurringPaymentsService.generateDueCharges and export the service"
```

---

## Task 3: `BillingSchedulerService` + `BillingModule`

**Files:**
- Create: `backend/src/billing/billing-scheduler.service.ts`
- Create: `backend/src/billing/billing-scheduler.service.spec.ts`
- Create: `backend/src/billing/billing.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SubscriptionsService.generateDueCharges()` (Task 1), `EmployeeRecurringPaymentsService.generateDueCharges()` (Task 2).

- [ ] **Step 1: Escrever os testes (falha esperada)**

Criar `backend/src/billing/billing-scheduler.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { EmployeeRecurringPaymentsService } from '../employee-recurring-payments/employee-recurring-payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BillingSchedulerService } from './billing-scheduler.service';

describe('BillingSchedulerService', () => {
  let service: BillingSchedulerService;
  let subscriptionsService: { generateDueCharges: jest.Mock };
  let employeeRecurringPaymentsService: { generateDueCharges: jest.Mock };

  beforeEach(async () => {
    subscriptionsService = { generateDueCharges: jest.fn() };
    employeeRecurringPaymentsService = { generateDueCharges: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        BillingSchedulerService,
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: EmployeeRecurringPaymentsService, useValue: employeeRecurringPaymentsService },
      ],
    }).compile();
    service = module.get(BillingSchedulerService);
  });

  it('onApplicationBootstrap calls both services\' generateDueCharges', async () => {
    subscriptionsService.generateDueCharges.mockResolvedValue({ checked: 2, generated: 1 });
    employeeRecurringPaymentsService.generateDueCharges.mockResolvedValue({ checked: 1, generated: 0 });

    await service.onApplicationBootstrap();

    expect(subscriptionsService.generateDueCharges).toHaveBeenCalledTimes(1);
    expect(employeeRecurringPaymentsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('an error from one service does not prevent the other from running, and does not throw', async () => {
    subscriptionsService.generateDueCharges.mockRejectedValue(new Error('db down'));
    employeeRecurringPaymentsService.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });

    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

    expect(employeeRecurringPaymentsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('an error from the second service does not affect the result of the first', async () => {
    subscriptionsService.generateDueCharges.mockResolvedValue({ checked: 1, generated: 1 });
    employeeRecurringPaymentsService.generateDueCharges.mockRejectedValue(new Error('db down'));

    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

    expect(subscriptionsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });

  it('runDailyCron triggers the same catch-up logic as onApplicationBootstrap', async () => {
    subscriptionsService.generateDueCharges.mockResolvedValue({ checked: 0, generated: 0 });
    employeeRecurringPaymentsService.generateDueCharges.mockResolvedValue({ checked: 0, generated: 0 });

    await service.runDailyCron();

    expect(subscriptionsService.generateDueCharges).toHaveBeenCalledTimes(1);
    expect(employeeRecurringPaymentsService.generateDueCharges).toHaveBeenCalledTimes(1);
  });
});
```

Run: `cd backend && npx jest --testPathIgnorePatterns=test/ --testPathPattern=billing-scheduler`
Expected: FAIL ("Cannot find module './billing-scheduler.service'")

- [ ] **Step 2: Implementar `BillingSchedulerService`**

Criar `backend/src/billing/billing-scheduler.service.ts`:

```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmployeeRecurringPaymentsService } from '../employee-recurring-payments/employee-recurring-payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

interface DueChargesResult {
  checked: number;
  generated: number;
}

@Injectable()
export class BillingSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly employeeRecurringPaymentsService: EmployeeRecurringPaymentsService,
  ) {}

  // Cobre o caso do processo ter ficado fora do ar quando o cron deveria ter
  // rodado (queda, restart, deploy, ambiente local desligado) — a checagem
  // roda de novo assim que a aplicação sobe, sem esperar o próximo 3h.
  async onApplicationBootstrap() {
    await this.runCatchUp('inicialização');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCron() {
    await this.runCatchUp('cron diário');
  }

  private async runCatchUp(trigger: string) {
    // Cada serviço tem seu próprio try/catch — uma falha em um nunca deve
    // impedir a execução do outro.
    const subs = await this.safeGenerate(
      () => this.subscriptionsService.generateDueCharges(),
      'assinaturas de clientes',
      trigger,
    );
    const employees = await this.safeGenerate(
      () => this.employeeRecurringPaymentsService.generateDueCharges(),
      'recorrências de funcionário',
      trigger,
    );

    const totalGenerated = (subs?.generated ?? 0) + (employees?.generated ?? 0);
    if (totalGenerated > 0) {
      this.logger.log(
        `Cobrança automática (${trigger}): ${subs?.generated ?? 0} assinatura(s), ` +
          `${employees?.generated ?? 0} recorrência(s) de funcionário geradas.`,
      );
    }
  }

  private async safeGenerate(
    fn: () => Promise<DueChargesResult>,
    label: string,
    trigger: string,
  ): Promise<DueChargesResult | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `Falha na cobrança automática de ${label} (${trigger})`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }
}
```

- [ ] **Step 3: Rodar os testes para confirmar que passam**

Run: `cd backend && npx jest --testPathIgnorePatterns=test/ --testPathPattern=billing-scheduler`
Expected: PASS (4 testes)

- [ ] **Step 4: Criar o módulo e registrar no `AppModule`**

Criar `backend/src/billing/billing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EmployeeRecurringPaymentsModule } from '../employee-recurring-payments/employee-recurring-payments.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BillingSchedulerService } from './billing-scheduler.service';

@Module({
  imports: [SubscriptionsModule, EmployeeRecurringPaymentsModule],
  providers: [BillingSchedulerService],
})
export class BillingModule {}
```

Em `backend/src/app.module.ts`, adicionar o import e a entrada em `imports` (`ScheduleModule.forRoot()` já está registrado — nenhuma dependência nova):

```ts
import { BillingModule } from './billing/billing.module';
```

```ts
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CompanyModule,
    RolesModule,
    EmployeesModule,
    EmployeeWarningsModule,
    EmployeeRecurringPaymentsModule,
    EmployeePaymentsModule,
    VacationsModule,
    BillingModule,
    ClientsModule,
    ReceivablesModule,
    SubscriptionsModule,
    ReportsModule,
  ],
```

(única mudança: a linha `BillingModule,` adicionada após `VacationsModule,` — nada mais reordenado ou removido)

- [ ] **Step 5: Rodar a suíte completa e o build**

Run: `cd backend && npm run test && npm run lint && npm run build`
Expected: PASS / 0 warnings / build limpo

- [ ] **Step 6: Commit**

```bash
git add backend/src/billing backend/src/app.module.ts
git commit -m "feat(backend): add BillingSchedulerService for automatic monthly billing (cron + bootstrap catch-up)"
```

---

## Task 4: Validação final + documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify: `B:\Quickflow\Quickflow\ARQUITETURA.md`, `API.md`, `DECISOES-TECNICAS.md`

- [ ] **Step 1: Rodar a suíte completa, lint e build uma última vez**

Run: `cd backend && npm run test && npm run lint && npm run build`
Expected: tudo limpo

- [ ] **Step 2: Testar manualmente o catch-up no boot**

Com o backend rodando localmente e pelo menos uma assinatura de cliente `ACTIVE` com `dueDay` já alcançado no mês corrente e sem fatura gerada ainda (pode usar uma existente do Prisma Studio, `http://localhost:5555`), reiniciar o processo do backend (`npm run start:dev`) e conferir no log a linha `Cobrança automática (inicialização): ...` — confirmar no Prisma Studio que o `Receivable` foi criado.

- [ ] **Step 3: Atualizar `CLAUDE.md`**

Na seção `## Backend`, adicionar uma linha citando o `BillingModule`/`BillingSchedulerService` e explicando que assinaturas de clientes e recorrências de funcionário agora geram sua cobrança do mês sozinhas (cron diário + checagem no boot), sem precisar do botão manual — que continua existindo como ação complementar.

- [ ] **Step 4: Atualizar as notas do vault**

Usar as skills `obsidian-markdown`/`obsidian-cli`:
- `ARQUITETURA.md`: adicionar `BillingModule` ao mapa de módulos e de pastas.
- `API.md`: uma nota (não uma rota nova — isso não expõe endpoint) explicando que faturas de assinatura e pagamentos recorrentes de funcionário podem aparecer sem ação manual, geradas pelo `BillingSchedulerService`.
- `DECISOES-TECNICAS.md`: nova entrada explicando a decisão de duas camadas (cron + bootstrap), por que não há catch-up retroativo de múltiplos meses, e que o design foi pensado para funcionar igual num ambiente 24/7 futuro.

- [ ] **Step 5: Commit final da documentação**

```bash
git add CLAUDE.md
git commit -m "docs: document automatic recurring billing (cron + bootstrap catch-up)"
```
