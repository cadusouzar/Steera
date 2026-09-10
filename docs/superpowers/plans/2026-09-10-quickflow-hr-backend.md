# QuickFlow — Backend de RH (Cargos & Funcionários) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar no backend NestJS/Prisma os módulos de Cargos e Funcionários (com dados pessoais/profissionais/financeiros, advertências, pagamentos/recorrência e férias/agendamento), isolados por empresa, sem tocar em Clientes/Lançamentos/Assinaturas/Relatórios nem em outros módulos de RH.

**Architecture:** Segue exatamente o padrão já estabelecido por `ClientsModule`/`ReceivablesModule`/`SubscriptionsModule` (Controller → Service → Prisma, DTOs com `class-validator`, inativação lógica nunca hard delete, unicidade crítica garantida no banco). Como não existe autenticação nem conceito de empresa no projeto hoje, um `CompanyContextService` resolve uma única `Company` semeada automaticamente — todo o resto do código (queries filtradas por `companyId`, checagens de propriedade) já é escrito como se a autenticação fosse real, para que trocar o stub por `req.user.companyId` no futuro não exija tocar em mais nada.

**Tech Stack:** NestJS, Prisma + PostgreSQL local, `class-validator`/`class-transformer`, Jest.

**Spec:** análise e decisões aprovadas na conversa que originou este plano (empresa única fixa/stub; férias com regra básica de 30 dias + adicional constitucional de 1/3 apenas; CPF único por empresa). Ver também `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`, `ARQUITETURA.md`, `BANCO-DE-DADOS.md`, `API.md`.

## Global Constraints

- Nunca aceitar `companyId` vindo do frontend — sempre resolvido via `CompanyContextService`.
- `amount`/`baseValue` sempre `Decimal(10,2)` no schema, nunca `Float`.
- Inativação lógica em `Role`/`Employee` — nunca hard delete; nenhuma cascata apaga advertências, pagamentos ou férias.
- Toda query/checagem de propriedade filtra por `companyId`; recurso de outra empresa sempre responde 404 (nunca 403, para não confirmar existência).
- `ValidationPipe` global já é `whitelist + forbidNonWhitelisted` — nenhum DTO deve aceitar campos não previstos no frontend/spec.
- Nenhuma migration já aplicada é editada; migrations novas são sempre incrementais. **Nunca** apontar `--shadow-database-url` para o banco `quickflow`/`quickflow_test` reais (ver incidente documentado em `DECISOES-TECNICAS.md`).
- Não alterar `src/` do frontend, não alterar `ClientsModule`/`ReceivablesModule`/`SubscriptionsModule`/`ReportsModule` além da extração de utilitários combinada na Task 1.
- Não instalar Docker.

---

## Task 1: Infra — Company (stub) + utilitários de data compartilhados

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/common/date.util.ts`
- Modify: `backend/src/receivables/receivables.service.ts`
- Modify: `backend/src/reports/reports.service.ts`
- Create: `backend/src/company/company-context.service.ts`
- Create: `backend/src/company/company-context.service.spec.ts`
- Create: `backend/src/company/company.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `CompanyContextService.getCurrentCompanyId(): Promise<string>` — usado por todos os services das próximas tasks. `startOfToday(): Date` e `parseDateOnly(value: string): Date` exportados de `common/date.util.ts`.

- [ ] **Step 1: Adicionar o model `Company` ao schema**

Em `backend/prisma/schema.prisma`, adicionar ao final do arquivo:

```prisma
model Company {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd backend && npx prisma migrate dev --name add_company`
Expected: migration criada em `backend/prisma/migrations/`, aplicada no banco `quickflow` local, `npx prisma generate` roda automaticamente como parte do comando.

- [ ] **Step 3: Extrair os utilitários de data para `common/`**

Criar `backend/src/common/date.util.ts`:

```ts
// `dueDate` (e demais colunas `@db.Date`) são sempre lidas pelo Prisma como
// UTC midnight — todo valor "só data" manuseado no app é normalizado para UTC
// midnight também. Usar meia-noite local faria um valor com vencimento "hoje"
// comparar como atrasado em qualquer fuso a oeste de UTC (ex.: UTC-3).
export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
```

- [ ] **Step 4: Atualizar `receivables.service.ts` para reusar o util compartilhado**

Em `backend/src/receivables/receivables.service.ts`, substituir as definições locais de `startOfToday`/`parseDateOnly` (linhas 14-22 do arquivo atual) por um import:

```ts
import { parseDateOnly, startOfToday } from '../common/date.util';
```

Remover as duas funções antigas do arquivo (o resto do arquivo continua igual — `startOfToday()`/`parseDateOnly()` já são chamadas do mesmo jeito).

- [ ] **Step 5: Atualizar o import em `reports.service.ts`**

Em `backend/src/reports/reports.service.ts`, trocar:

```ts
import { startOfToday } from '../receivables/receivables.service';
```

por:

```ts
import { startOfToday } from '../common/date.util';
```

- [ ] **Step 6: Rodar os testes existentes para garantir que a extração não quebrou nada**

Run: `cd backend && npm run test -- receivables reports`
Expected: PASS (mesmo comportamento de antes, só a origem do import mudou).

- [ ] **Step 7: Escrever o teste do `CompanyContextService` (falha esperada)**

Criar `backend/src/company/company-context.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyContextService } from './company-context.service';

describe('CompanyContextService', () => {
  let service: CompanyContextService;
  let prisma: { company: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = { company: { findFirst: jest.fn(), create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [CompanyContextService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CompanyContextService);
  });

  it('returns the existing company id when one already exists', async () => {
    prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    const id = await service.getCurrentCompanyId();
    expect(id).toBe('company-1');
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('creates a default company when none exists yet', async () => {
    prisma.company.findFirst.mockResolvedValue(null);
    prisma.company.create.mockResolvedValue({ id: 'company-2' });
    const id = await service.getCurrentCompanyId();
    expect(id).toBe('company-2');
    expect(prisma.company.create).toHaveBeenCalledWith({ data: { name: 'Empresa Padrão' } });
  });

  it('caches the resolved company id across calls, avoiding repeated lookups', async () => {
    prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    await service.getCurrentCompanyId();
    await service.getCurrentCompanyId();
    expect(prisma.company.findFirst).toHaveBeenCalledTimes(1);
  });
});
```

Run: `cd backend && npm run test -- company-context`
Expected: FAIL ("Cannot find module './company-context.service'")

- [ ] **Step 8: Implementar `CompanyContextService`**

Criar `backend/src/company/company-context.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Substituto temporário para autenticação real — o projeto ainda não tem
// login/sessão em lugar nenhum (ver DECISOES-TECNICAS.md). Todo service de RH
// pede a este serviço "qual é a empresa atual" em vez de confiar num
// companyId enviado pelo cliente. Quando a autenticação existir de verdade,
// só este método precisa mudar (ler req.user.companyId) — toda query/checagem
// de propriedade nos módulos de RH já está escrita como se a auth fosse real.
@Injectable()
export class CompanyContextService {
  private cachedCompanyId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getCurrentCompanyId(): Promise<string> {
    if (this.cachedCompanyId) return this.cachedCompanyId;

    const existing = await this.prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) {
      this.cachedCompanyId = existing.id;
      return existing.id;
    }

    const created = await this.prisma.company.create({ data: { name: 'Empresa Padrão' } });
    this.cachedCompanyId = created.id;
    return created.id;
  }
}
```

Criar `backend/src/company/company.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CompanyContextService } from './company-context.service';

@Module({
  providers: [CompanyContextService],
  exports: [CompanyContextService],
})
export class CompanyModule {}
```

- [ ] **Step 9: Rodar o teste para confirmar que passa**

Run: `cd backend && npm run test -- company-context`
Expected: PASS (3 testes)

- [ ] **Step 10: Registrar `CompanyModule` em `app.module.ts`**

Em `backend/src/app.module.ts`, adicionar o import e incluir `CompanyModule` no array `imports` (antes dos módulos que vão depender dele nas próximas tasks):

```ts
import { CompanyModule } from './company/company.module';
```

```ts
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CompanyModule,
    ClientsModule,
    ReceivablesModule,
    SubscriptionsModule,
    ReportsModule,
  ],
```

- [ ] **Step 11: Commit**

```bash
git add backend/prisma backend/src/common backend/src/company backend/src/receivables/receivables.service.ts backend/src/reports/reports.service.ts backend/src/app.module.ts
git commit -m "feat(backend): add Company stub and shared date utils for HR module"
```

---

## Task 2: Módulo de Cargos (`RolesModule`)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/roles/dto/create-role.dto.ts`
- Create: `backend/src/roles/dto/update-role.dto.ts`
- Create: `backend/src/roles/dto/query-roles.dto.ts`
- Create: `backend/src/roles/roles.service.ts`
- Create: `backend/src/roles/roles.service.spec.ts`
- Create: `backend/src/roles/roles.controller.ts`
- Create: `backend/src/roles/roles.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `CompanyContextService.getCurrentCompanyId()` (Task 1).
- Produces: `RolesService` com `create/findAll/findActive/findOne/update/deactivate/reactivate`, usado pelo `EmployeesModule` (Task 3) para validar `roleId`.

- [ ] **Step 1: Adicionar o model `Role` ao schema**

Em `backend/prisma/schema.prisma`:

```prisma
model Role {
  id          String   @id @default(cuid())
  companyId   String
  name        String
  department  String
  colorHex    String   @default("#2563EB")
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([companyId])
  @@index([active])
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd backend && npx prisma migrate dev --name add_roles`
Expected: migration aplicada, `Role`/`Prisma.RoleCreateInput` etc. disponíveis no client gerado.

- [ ] **Step 3: Escrever os testes do service (falha esperada)**

Criar `backend/src/roles/roles.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;
  let prisma: { role: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      role: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(RolesService);
  });

  it('creates a role scoped to the current company', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue({ id: 'role-1', companyId: 'company-1', name: 'Designer', department: 'Produto' });

    await service.create({ name: 'Designer', department: 'Produto' });

    expect(prisma.role.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', name: 'Designer', colorHex: '#2563EB' }),
    });
  });

  it('rejects an invalid colorHex before hitting the database', async () => {
    // Validação real acontece no DTO via ValidationPipe (e2e); aqui garantimos
    // que o service aceita o valor já validado sem reformatá-lo.
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue({ id: 'role-1' });
    await service.create({ name: 'Designer', department: 'Produto', colorHex: '#111111' });
    expect(prisma.role.create).toHaveBeenCalledWith({ data: expect.objectContaining({ colorHex: '#111111' }) });
  });

  it('rejects creating a duplicate active role name within the same company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-existing' });
    await expect(service.create({ name: 'Designer', department: 'Produto' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException for a role belonging to another company', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    await expect(service.findOne('role-other-company')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.role.findFirst).toHaveBeenCalledWith({ where: { id: 'role-other-company', companyId: 'company-1' } });
  });

  it('deactivating a role does not delete it — only flips active to false', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', active: true, companyId: 'company-1' });
    prisma.role.update.mockResolvedValue({ id: 'role-1', active: false });
    await service.deactivate('role-1');
    expect(prisma.role.update).toHaveBeenCalledWith({ where: { id: 'role-1' }, data: { active: false } });
  });

  it('rejects deactivating a role that is already inactive', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', active: false, companyId: 'company-1' });
    await expect(service.deactivate('role-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
```

Run: `cd backend && npm run test -- roles.service`
Expected: FAIL ("Cannot find module './roles.service'")

- [ ] **Step 4: Criar os DTOs**

`backend/src/roles/dto/create-role.dto.ts`:

```ts
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class CreateRoleDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) department!: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX, { message: 'colorHex deve estar no formato #RRGGBB' }) colorHex?: string;
  @IsOptional() @IsString() description?: string;
}
```

`backend/src/roles/dto/update-role.dto.ts`:

```ts
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { HEX_COLOR_REGEX } from './create-role.dto';

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) department?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX, { message: 'colorHex deve estar no formato #RRGGBB' }) colorHex?: string;
  @IsOptional() @IsString() description?: string;
}
```

`backend/src/roles/dto/query-roles.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryRolesDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
```

- [ ] **Step 5: Implementar `RolesService`**

Criar `backend/src/roles/roles.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // Checagem em nível de aplicação (não uma constraint única no banco): o
  // risco de corrida de um duplo-clique cadastrando dois cargos com o mesmo
  // nome é aceitável aqui — diferente da geração de fatura recorrente, onde
  // duplicidade tem impacto financeiro direto (ver SubscriptionsService).
  private async assertNoActiveDuplicate(companyId: string, name: string, excludeId?: string) {
    const conflict = await this.prisma.role.findFirst({
      where: { companyId, name, active: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (conflict) throw new ConflictException(`Já existe um cargo ativo com o nome "${name}"`);
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    await this.assertNoActiveDuplicate(companyId, dto.name);
    return this.prisma.role.create({
      data: { ...dto, companyId, colorHex: dto.colorHex ?? '#2563EB' },
    });
  }

  async findAll(query: QueryRolesDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { department: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.role.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { name: 'asc' } }),
      this.prisma.role.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findActive() {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.role.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } });
  }

  private async assertExists(id: string): Promise<Role> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const role = await this.prisma.role.findFirst({ where: { id, companyId } });
    if (!role) throw new NotFoundException(`Cargo ${id} não encontrado`);
    return role;
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.assertExists(id);
    if (dto.name && dto.name !== role.name) {
      await this.assertNoActiveDuplicate(role.companyId, dto.name, id);
    }
    return this.prisma.role.update({ where: { id }, data: dto });
  }

  async deactivate(id: string) {
    const role = await this.assertExists(id);
    if (!role.active) throw new ConflictException(`Cargo ${id} já está inativo`);
    return this.prisma.role.update({ where: { id }, data: { active: false } });
  }

  async reactivate(id: string) {
    const role = await this.assertExists(id);
    if (role.active) throw new ConflictException(`Cargo ${id} já está ativo`);
    await this.assertNoActiveDuplicate(role.companyId, role.name, id);
    return this.prisma.role.update({ where: { id }, data: { active: true } });
  }
}
```

- [ ] **Step 6: Rodar os testes para confirmar que passam**

Run: `cd backend && npm run test -- roles.service`
Expected: PASS (6 testes)

- [ ] **Step 7: Controller e módulo**

Criar `backend/src/roles/roles.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryRolesDto) {
    return this.rolesService.findAll(query);
  }

  @Get('active')
  findActive() {
    return this.rolesService.findActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.rolesService.deactivate(id);
  }

  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.rolesService.reactivate(id);
  }
}
```

Criar `backend/src/roles/roles.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [CompanyModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
```

Registrar em `backend/src/app.module.ts` (import + array `imports`, depois de `CompanyModule`):

```ts
import { RolesModule } from './roles/roles.module';
```

- [ ] **Step 8: Commit**

```bash
git add backend/prisma backend/src/roles backend/src/app.module.ts
git commit -m "feat(backend): add Roles module (cargos) with company isolation"
```

---

## Task 3: Módulo de Funcionários (`EmployeesModule`)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/common/cpf.util.ts`
- Create: `backend/src/common/cpf.util.spec.ts`
- Create: `backend/src/employees/dto/create-employee.dto.ts`
- Create: `backend/src/employees/dto/update-employee.dto.ts`
- Create: `backend/src/employees/dto/query-employees.dto.ts`
- Create: `backend/src/employees/employee-response.mapper.ts`
- Create: `backend/src/employees/employees.service.ts`
- Create: `backend/src/employees/employees.service.spec.ts`
- Create: `backend/src/employees/employees.controller.ts`
- Create: `backend/src/employees/employees.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `CompanyContextService.getCurrentCompanyId()`, `RolesService` (só para import do model `Role` do Prisma — a validação de cargo é feita direto via `prisma.role.findFirst`, sem criar dependência de módulo, como `ReceivablesModule` faz com `Client`).
- Produces: `EmployeesService` (usado pelas Tasks 4, 5 e 6 via `assertEmployeeExists`), `toEmployeeListItem`/`toEmployeeDetail` (mapeadores de resposta).

- [ ] **Step 1: Adicionar `ContractType`, `EmployeeStatus` e o model `Employee` ao schema**

Em `backend/prisma/schema.prisma`:

```prisma
enum ContractType {
  CLT
  PJ
  ESTAGIO
}

enum EmployeeStatus {
  ACTIVE
  INACTIVE
}

model Employee {
  id                      String         @id @default(cuid())
  companyId               String
  roleId                  String
  role                    Role           @relation(fields: [roleId], references: [id], onDelete: Restrict)
  fullName                String
  cpf                     String
  email                   String?
  phone                   String?
  address                 String?
  contractType            ContractType
  admissionDate           DateTime       @db.Date
  terminationDate         DateTime?      @db.Date
  status                  EmployeeStatus @default(ACTIVE)
  department              String
  baseValue               Decimal        @db.Decimal(10, 2)
  paymentDueDay           Int
  payOnLastBusinessDay    Boolean        @default(false)
  bankDetails             String?
  salaryRecurrenceEnabled Boolean        @default(true)
  createdAt               DateTime       @default(now())
  updatedAt               DateTime       @updatedAt

  @@unique([companyId, cpf])
  @@index([companyId])
  @@index([roleId])
  @@index([status])
}
```

Adicionar a relação inversa em `Role` (edit no model já criado na Task 2):

```prisma
model Role {
  // ...campos existentes...
  employees Employee[]
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd backend && npx prisma migrate dev --name add_employees`
Expected: migration aplicada; `onDelete: Restrict` em `roleId` impede hard delete de um `Role` referenciado (defensivo — a aplicação nunca faz hard delete de `Role` de qualquer forma).

- [ ] **Step 3: Teste do util de CPF (falha esperada)**

Criar `backend/src/common/cpf.util.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { maskCpf, normalizeCpf } from './cpf.util';

describe('cpf.util', () => {
  it('strips formatting characters and keeps 11 digits', () => {
    expect(normalizeCpf('111.222.333-44')).toBe('11122233344');
  });

  it('rejects a CPF with the wrong number of digits', () => {
    expect(() => normalizeCpf('123')).toThrow(BadRequestException);
  });

  it('masks the middle digits, keeping the first 3 and last 2 visible', () => {
    expect(maskCpf('11122233344')).toBe('111.***.**44');
  });
});
```

Run: `cd backend && npm run test -- cpf.util`
Expected: FAIL ("Cannot find module './cpf.util'")

- [ ] **Step 4: Implementar o util de CPF**

Criar `backend/src/common/cpf.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

export function normalizeCpf(rawCpf: string): string {
  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11) {
    throw new BadRequestException('cpf deve conter 11 dígitos');
  }
  return digits;
}

// LGPD: nunca expor o CPF completo em listagens — mantém os 3 primeiros e os
// 2 últimos dígitos visíveis, mascara o resto.
export function maskCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.***.**${cpf.slice(-2)}`;
}
```

Run: `cd backend && npm run test -- cpf.util`
Expected: PASS

- [ ] **Step 5: DTOs**

Criar `backend/src/employees/dto/create-employee.dto.ts`:

```ts
import { ContractType } from '@prisma/client';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString() @MinLength(1) fullName!: string;
  @IsString() @MinLength(11) cpf!: string;
  @IsString() @MinLength(1) roleId!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsEnum(ContractType) contractType!: ContractType;
  @IsDateString() admissionDate!: string;
  @IsString() @MinLength(1) department!: string;
  @IsNumber() @Min(0.01) baseValue!: number;
  @IsInt() @Min(1) @Max(31) paymentDueDay!: number;
  @IsOptional() @IsBoolean() payOnLastBusinessDay?: boolean;
  @IsOptional() @IsString() bankDetails?: string;
  @IsOptional() @IsBoolean() salaryRecurrenceEnabled?: boolean;
}
```

Criar `backend/src/employees/dto/update-employee.dto.ts`:

```ts
import { ContractType } from '@prisma/client';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength,
} from 'class-validator';

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(1) fullName?: string;
  @IsOptional() @IsString() @MinLength(1) roleId?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(ContractType) contractType?: ContractType;
  @IsOptional() @IsDateString() admissionDate?: string;
  @IsOptional() @IsString() @MinLength(1) department?: string;
  @IsOptional() @IsNumber() @Min(0.01) baseValue?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) paymentDueDay?: number;
  @IsOptional() @IsBoolean() payOnLastBusinessDay?: boolean;
  @IsOptional() @IsString() bankDetails?: string;
  @IsOptional() @IsBoolean() salaryRecurrenceEnabled?: boolean;
}
```

Criar `backend/src/employees/dto/query-employees.dto.ts`:

```ts
import { EmployeeStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryEmployeesDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
```

- [ ] **Step 6: Mapeadores de resposta (LGPD — nunca devolver a entidade Prisma crua)**

Criar `backend/src/employees/employee-response.mapper.ts`:

```ts
import { Employee } from '@prisma/client';
import { maskCpf } from '../common/cpf.util';

// Usado em listagens — sem CPF completo nem dados bancários.
export function toEmployeeListItem(employee: Employee) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    roleId: employee.roleId,
    department: employee.department,
    contractType: employee.contractType,
    status: employee.status,
    cpfMasked: maskCpf(employee.cpf),
    baseValue: Number(employee.baseValue),
  };
}

// Usado no "Detalhes" do funcionário — view autorizada, campos completos.
export function toEmployeeDetail(employee: Employee) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    cpf: employee.cpf,
    roleId: employee.roleId,
    email: employee.email,
    phone: employee.phone,
    address: employee.address,
    contractType: employee.contractType,
    admissionDate: employee.admissionDate,
    terminationDate: employee.terminationDate,
    status: employee.status,
    department: employee.department,
    baseValue: Number(employee.baseValue),
    paymentDueDay: employee.paymentDueDay,
    payOnLastBusinessDay: employee.payOnLastBusinessDay,
    bankDetails: employee.bankDetails,
    salaryRecurrenceEnabled: employee.salaryRecurrenceEnabled,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}
```

- [ ] **Step 7: Testes do service (falha esperada)**

Criar `backend/src/employees/employees.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from './employees.service';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: { employee: Record<string, jest.Mock>; role: Record<string, jest.Mock>; employeeRecurringPayment: Record<string, jest.Mock>; $transaction: jest.Mock };

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      role: { findFirst: jest.fn() },
      employeeRecurringPayment: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(EmployeesService);
  });

  it('rejects creating an employee for a role from another company', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    await expect(
      service.create({
        fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-other-company',
        contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
        baseValue: 5000, paymentDueDay: 5,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects creating an employee with an inactive role', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: false });
    await expect(
      service.create({
        fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
        contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
        baseValue: 5000, paymentDueDay: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate CPF within the same company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: true });
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-existing' });
    await expect(
      service.create({
        fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
        contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
        baseValue: 5000, paymentDueDay: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('normalizes the CPF and scopes creation to the current company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: true });
    prisma.employee.findFirst.mockResolvedValue(null);
    prisma.employee.create.mockResolvedValue({ id: 'employee-1', cpf: '11122233344' });

    await service.create({
      fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
      contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
      baseValue: 5000, paymentDueDay: 5,
    });

    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', cpf: '11122233344' }),
    });
  });

  it('throws NotFoundException for an employee belonging to another company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.findOne('employee-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivating an employee flips status but never deletes the row, and pauses their active recurring payments', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.$transaction.mockResolvedValue([{ id: 'employee-1', status: 'INACTIVE' }, { count: 1 }]);

    await service.deactivate('employee-1');

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
```

Run: `cd backend && npm run test -- employees.service`
Expected: FAIL ("Cannot find module './employees.service'")

- [ ] **Step 8: Implementar `EmployeesService`**

Criar `backend/src/employees/employees.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee, EmployeeStatus, SubscriptionStatus as _unused } from '@prisma/client';
import { normalizeCpf } from '../common/cpf.util';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private async assertRoleUsable(roleId: string, companyId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId } });
    if (!role) throw new NotFoundException(`Cargo ${roleId} não encontrado`);
    if (!role.active) {
      throw new BadRequestException(`Cargo ${roleId} está inativo e não pode ser usado em novos vínculos`);
    }
  }

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    await this.assertRoleUsable(dto.roleId, companyId);
    const cpf = normalizeCpf(dto.cpf);

    const existingCpf = await this.prisma.employee.findFirst({ where: { companyId, cpf } });
    if (existingCpf) throw new ConflictException('Já existe um funcionário com este CPF nesta empresa');

    return this.prisma.employee.create({
      data: {
        companyId,
        roleId: dto.roleId,
        fullName: dto.fullName,
        cpf,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        contractType: dto.contractType,
        admissionDate: parseDateOnly(dto.admissionDate),
        department: dto.department,
        baseValue: dto.baseValue,
        paymentDueDay: dto.paymentDueDay,
        payOnLastBusinessDay: dto.payOnLastBusinessDay ?? false,
        bankDetails: dto.bankDetails,
        salaryRecurrenceEnabled: dto.salaryRecurrenceEnabled ?? true,
      },
    });
  }

  async findAll(query: QueryEmployeesDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' as const } },
              { department: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { fullName: 'asc' } }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async assertExists(id: string): Promise<Employee> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) throw new NotFoundException(`Funcionário ${id} não encontrado`);
    return employee;
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const employee = await this.assertExists(id);

    if (dto.roleId && dto.roleId !== employee.roleId) {
      await this.assertRoleUsable(dto.roleId, employee.companyId);
    }

    let cpf: string | undefined;
    if (dto.cpf !== undefined) {
      cpf = normalizeCpf(dto.cpf);
      const conflict = await this.prisma.employee.findFirst({
        where: { companyId: employee.companyId, cpf, NOT: { id } },
      });
      if (conflict) throw new ConflictException('Já existe um funcionário com este CPF nesta empresa');
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        ...(cpf ? { cpf } : {}),
        ...(dto.admissionDate ? { admissionDate: parseDateOnly(dto.admissionDate) } : {}),
      },
    });
  }

  // Nunca apaga o funcionário — só marca INACTIVE e, na mesma transação,
  // pausa as recorrências ativas dele (mesmo padrão de
  // ClientsService.deactivate, que pausa Subscriptions ativas do cliente).
  async deactivate(id: string) {
    const employee = await this.assertExists(id);
    if (employee.status === EmployeeStatus.INACTIVE) {
      throw new ConflictException(`Funcionário ${id} já está inativo`);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id },
        data: { status: EmployeeStatus.INACTIVE, terminationDate: new Date() },
      }),
      this.prisma.employeeRecurringPayment.updateMany({
        where: { employeeId: id, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      }),
    ]);

    return updated;
  }

  async reactivate(id: string) {
    const employee = await this.assertExists(id);
    if (employee.status === EmployeeStatus.ACTIVE) {
      throw new ConflictException(`Funcionário ${id} já está ativo`);
    }
    return this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.ACTIVE, terminationDate: null },
    });
  }
}
```

> Nota: o import `SubscriptionStatus as _unused` acima é um lembrete de que `EmployeeRecurringPayment` e seu enum de status só existem a partir da Task 5 — ao chegar nesta Task 3, `prisma.employeeRecurringPayment` ainda não existe no client gerado. **Ajuste:** mova o bloco de `deactivate` que mexe em `employeeRecurringPayment` para a Task 5 (depois que o model existir), OU implemente `deactivate` nesta Task 3 sem a segunda operação da transação (só `employee.update`) e adicione a atualização em cascata das recorrências como um Step extra na Task 5, chamando-o de lá. **Este plano segue a segunda opção** — ver Task 5, Step 8.

- [ ] **Step 8 (revisado): Implementar `EmployeesService` sem a etapa de recorrências**

Usar o código do Step 8 acima, mas com `deactivate` simplificado (sem `$transaction`/`employeeRecurringPayment`) nesta task:

```ts
  async deactivate(id: string) {
    const employee = await this.assertExists(id);
    if (employee.status === EmployeeStatus.INACTIVE) {
      throw new ConflictException(`Funcionário ${id} já está inativo`);
    }
    return this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.INACTIVE, terminationDate: new Date() },
    });
  }
```

E ajustar o teste correspondente do Step 7 (`deactivating an employee...`) para não usar `$transaction`:

```ts
  it('deactivating an employee flips status but never deletes the row', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.employee.update.mockResolvedValue({ id: 'employee-1', status: 'INACTIVE' });
    await service.deactivate('employee-1');
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'employee-1' },
      data: { status: 'INACTIVE', terminationDate: expect.any(Date) },
    });
  });
```

(remover `employeeRecurringPayment`/`$transaction` do mock `prisma` do Step 7 também.)

- [ ] **Step 9: Rodar os testes para confirmar que passam**

Run: `cd backend && npm run test -- employees.service`
Expected: PASS (6 testes)

- [ ] **Step 10: Controller e módulo**

Criar `backend/src/employees/employees.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { toEmployeeDetail, toEmployeeListItem } from './employee-response.mapper';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  async create(@Body() dto: CreateEmployeeDto) {
    return toEmployeeDetail(await this.employeesService.create(dto));
  }

  @Get()
  async findAll(@Query() query: QueryEmployeesDto) {
    const { items, total, page, pageSize } = await this.employeesService.findAll(query);
    return { items: items.map(toEmployeeListItem), total, page, pageSize };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return toEmployeeDetail(await this.employeesService.findOne(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return toEmployeeDetail(await this.employeesService.update(id, dto));
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    return toEmployeeDetail(await this.employeesService.deactivate(id));
  }

  @Patch(':id/reactivate')
  async reactivate(@Param('id') id: string) {
    return toEmployeeDetail(await this.employeesService.reactivate(id));
  }
}
```

Criar `backend/src/employees/employees.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [CompanyModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
```

Registrar em `backend/src/app.module.ts` (import + `imports`, depois de `RolesModule`):

```ts
import { EmployeesModule } from './employees/employees.module';
```

- [ ] **Step 11: Commit**

```bash
git add backend/prisma backend/src/common/cpf.util.ts backend/src/common/cpf.util.spec.ts backend/src/employees backend/src/app.module.ts
git commit -m "feat(backend): add Employees module with role linkage and LGPD-aware response DTOs"
```

---

## Task 4: Advertências (`EmployeeWarningsModule`)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/employee-warnings/dto/create-employee-warning.dto.ts`
- Create: `backend/src/employee-warnings/dto/update-employee-warning.dto.ts`
- Create: `backend/src/employee-warnings/employee-warnings.service.ts`
- Create: `backend/src/employee-warnings/employee-warnings.service.spec.ts`
- Create: `backend/src/employee-warnings/employee-warnings.controller.ts`
- Create: `backend/src/employee-warnings/employee-warnings.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `EmployeesService.assertExists(id)` (Task 3) para validar o funcionário antes de criar/listar advertências.
- Produces: `EmployeeWarningsService` com `create/findAllForEmployee/findOne/update`.

- [ ] **Step 1: Adicionar o model `EmployeeWarning` ao schema**

```prisma
model EmployeeWarning {
  id         String   @id @default(cuid())
  companyId  String
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  occurredAt DateTime @db.Date
  reason     String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([companyId])
  @@index([employeeId])
}
```

Adicionar a relação inversa em `Employee`:

```prisma
model Employee {
  // ...campos existentes...
  warnings EmployeeWarning[]
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd backend && npx prisma migrate dev --name add_employee_warnings`

- [ ] **Step 3: Teste do service (falha esperada)**

Criar `backend/src/employee-warnings/employee-warnings.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeWarningsService } from './employee-warnings.service';

describe('EmployeeWarningsService', () => {
  let service: EmployeeWarningsService;
  let prisma: { employeeWarning: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = { employeeWarning: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() } };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        EmployeeWarningsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
      ],
    }).compile();
    service = module.get(EmployeeWarningsService);
  });

  it('rejects creating a warning for an employee that does not exist (or belongs to another company)', async () => {
    employeesService.assertExists.mockRejectedValue(new NotFoundException());
    await expect(service.create('missing-employee', { occurredAt: '2026-01-01', reason: 'Atraso' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.employeeWarning.create).not.toHaveBeenCalled();
  });

  it('creates a warning scoped to the employee and its company', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeeWarning.create.mockResolvedValue({ id: 'warning-1' });

    await service.create('employee-1', { occurredAt: '2026-01-01', reason: 'Atraso injustificado' });

    expect(prisma.employeeWarning.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', reason: 'Atraso injustificado' }),
    });
  });

  it('lists warnings only for the given employee', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeeWarning.findMany.mockResolvedValue([]);
    await service.findAllForEmployee('employee-1');
    expect(prisma.employeeWarning.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1' },
      orderBy: { occurredAt: 'desc' },
    });
  });
});
```

Run: `cd backend && npm run test -- employee-warnings.service`
Expected: FAIL

- [ ] **Step 4: DTOs**

Criar `backend/src/employee-warnings/dto/create-employee-warning.dto.ts`:

```ts
import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateEmployeeWarningDto {
  @IsDateString() occurredAt!: string;
  @IsString() @MinLength(1) reason!: string;
}
```

Criar `backend/src/employee-warnings/dto/update-employee-warning.dto.ts`:

```ts
import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateEmployeeWarningDto {
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MinLength(1) reason?: string;
}
```

- [ ] **Step 5: Implementar `EmployeeWarningsService`**

Criar `backend/src/employee-warnings/employee-warnings.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { parseDateOnly } from '../common/date.util';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeWarningDto } from './dto/create-employee-warning.dto';
import { UpdateEmployeeWarningDto } from './dto/update-employee-warning.dto';

@Injectable()
export class EmployeeWarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
  ) {}

  async create(employeeId: string, dto: CreateEmployeeWarningDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.prisma.employeeWarning.create({
      data: {
        companyId: employee.companyId,
        employeeId,
        occurredAt: parseDateOnly(dto.occurredAt),
        reason: dto.reason,
      },
    });
  }

  async findAllForEmployee(employeeId: string) {
    await this.employeesService.assertExists(employeeId);
    return this.prisma.employeeWarning.findMany({ where: { employeeId }, orderBy: { occurredAt: 'desc' } });
  }

  private async assertExists(id: string, companyId: string) {
    const warning = await this.prisma.employeeWarning.findFirst({ where: { id, companyId } });
    if (!warning) throw new NotFoundException(`Advertência ${id} não encontrada`);
    return warning;
  }

  async findOne(id: string, employeeId: string) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.assertExists(id, employee.companyId);
  }

  async update(id: string, employeeId: string, dto: UpdateEmployeeWarningDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    await this.assertExists(id, employee.companyId);
    return this.prisma.employeeWarning.update({
      where: { id },
      data: { ...dto, ...(dto.occurredAt ? { occurredAt: parseDateOnly(dto.occurredAt) } : {}) },
    });
  }
}
```

- [ ] **Step 6: Rodar os testes**

Run: `cd backend && npm run test -- employee-warnings.service`
Expected: PASS (3 testes)

- [ ] **Step 7: Controller e módulo**

Criar `backend/src/employee-warnings/employee-warnings.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateEmployeeWarningDto } from './dto/create-employee-warning.dto';
import { UpdateEmployeeWarningDto } from './dto/update-employee-warning.dto';
import { EmployeeWarningsService } from './employee-warnings.service';

@Controller()
export class EmployeeWarningsController {
  constructor(private readonly warningsService: EmployeeWarningsService) {}

  @Post('employees/:employeeId/warnings')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeeWarningDto) {
    return this.warningsService.create(employeeId, dto);
  }

  @Get('employees/:employeeId/warnings')
  findAllForEmployee(@Param('employeeId') employeeId: string) {
    return this.warningsService.findAllForEmployee(employeeId);
  }

  @Get('employees/:employeeId/warnings/:id')
  findOne(@Param('employeeId') employeeId: string, @Param('id') id: string) {
    return this.warningsService.findOne(id, employeeId);
  }

  @Patch('employees/:employeeId/warnings/:id')
  update(@Param('employeeId') employeeId: string, @Param('id') id: string, @Body() dto: UpdateEmployeeWarningDto) {
    return this.warningsService.update(id, employeeId, dto);
  }
}
```

Criar `backend/src/employee-warnings/employee-warnings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeeWarningsController } from './employee-warnings.controller';
import { EmployeeWarningsService } from './employee-warnings.service';

@Module({
  imports: [EmployeesModule],
  controllers: [EmployeeWarningsController],
  providers: [EmployeeWarningsService],
})
export class EmployeeWarningsModule {}
```

Registrar em `backend/src/app.module.ts`.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma backend/src/employee-warnings backend/src/app.module.ts
git commit -m "feat(backend): add employee warnings sub-resource"
```

---

## Task 5: Pagamentos e recorrência (`EmployeePaymentsModule` + `EmployeeRecurringPaymentsModule`)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/employees/employees.service.ts` (completar `deactivate` com a pausa de recorrências)
- Modify: `backend/src/employees/employees.service.spec.ts`
- Modify: `backend/src/employees/employees.module.ts`
- Create: `backend/src/employee-recurring-payments/dto/create-employee-recurring-payment.dto.ts`
- Create: `backend/src/employee-recurring-payments/dto/update-employee-recurring-payment.dto.ts`
- Create: `backend/src/employee-recurring-payments/employee-recurring-payments.service.ts`
- Create: `backend/src/employee-recurring-payments/employee-recurring-payments.service.spec.ts`
- Create: `backend/src/employee-recurring-payments/employee-recurring-payments.controller.ts`
- Create: `backend/src/employee-recurring-payments/employee-recurring-payments.module.ts`
- Create: `backend/src/employee-payments/dto/create-employee-payment.dto.ts`
- Create: `backend/src/employee-payments/dto/update-employee-payment.dto.ts`
- Create: `backend/src/employee-payments/dto/query-employee-payments.dto.ts`
- Create: `backend/src/employee-payments/employee-payments.service.ts`
- Create: `backend/src/employee-payments/employee-payments.service.spec.ts`
- Create: `backend/src/employee-payments/employee-payments.controller.ts`
- Create: `backend/src/employee-payments/employee-payments.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `EmployeesService.assertExists`, `startOfToday`/`parseDateOnly` de `common/date.util`.
- Produces: `EmployeePaymentsService`, `EmployeeRecurringPaymentsService`.

- [ ] **Step 1: Adicionar os models ao schema**

```prisma
enum EmployeeRecurringPaymentStatus {
  ACTIVE
  INACTIVE
}

enum EmployeePaymentStatus {
  PENDING
  PAID
}

model EmployeeRecurringPayment {
  id          String                         @id @default(cuid())
  companyId   String
  employeeId  String
  employee    Employee                       @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  description String
  amount      Decimal                        @db.Decimal(10, 2)
  dueDay      Int
  status      EmployeeRecurringPaymentStatus @default(ACTIVE)
  createdAt   DateTime                       @default(now())
  updatedAt   DateTime                       @updatedAt

  payments EmployeePayment[]

  @@index([companyId])
  @@index([employeeId])
}

model EmployeePayment {
  id                 String                   @id @default(cuid())
  companyId          String
  employeeId         String
  employee           Employee                 @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  recurringPaymentId String?
  recurringPayment   EmployeeRecurringPayment? @relation(fields: [recurringPaymentId], references: [id], onDelete: SetNull)
  referenceYear      Int?
  referenceMonth     Int?
  description        String
  amount             Decimal                  @db.Decimal(10, 2)
  dueDate            DateTime                 @db.Date
  status             EmployeePaymentStatus    @default(PENDING)
  paidAt             DateTime?
  createdAt          DateTime                 @default(now())
  updatedAt          DateTime                 @updatedAt

  @@unique([recurringPaymentId, referenceYear, referenceMonth])
  @@index([companyId])
  @@index([employeeId])
  @@index([dueDate])
  @@index([status])
}
```

Adicionar as relações inversas em `Employee`:

```prisma
model Employee {
  // ...campos existentes...
  recurringPayments EmployeeRecurringPayment[]
  payments          EmployeePayment[]
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd backend && npx prisma migrate dev --name add_employee_payments`

- [ ] **Step 3: Completar `EmployeesService.deactivate` com a pausa de recorrências (TDD)**

Atualizar o teste em `backend/src/employees/employees.service.spec.ts` (troca o teste `deactivating an employee flips status but never deletes the row` da Task 3 por este, e adiciona `employeeRecurringPayment`/`$transaction` ao mock `prisma` do `beforeEach`):

```ts
  // No beforeEach, adicionar ao objeto `prisma`:
  // employeeRecurringPayment: { updateMany: jest.fn() },
  // $transaction: jest.fn(),

  it('deactivating an employee flips status, sets terminationDate, and pauses active recurring payments in one transaction', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.$transaction.mockResolvedValue([{ id: 'employee-1', status: 'INACTIVE' }, { count: 2 }]);

    await service.deactivate('employee-1');

    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
  });
```

Run: `cd backend && npm run test -- employees.service`
Expected: FAIL (o `deactivate` atual não usa `$transaction`)

- [ ] **Step 4: Atualizar `EmployeesService.deactivate`**

Em `backend/src/employees/employees.service.ts`, substituir o método `deactivate` (versão simplificada da Task 3) por:

```ts
  // Nunca apaga o funcionário — só marca INACTIVE e, na mesma transação,
  // pausa as recorrências ativas dele (mesmo padrão de
  // ClientsService.deactivate, que pausa Subscriptions ativas do cliente —
  // impede novas recorrências futuras sem apagar o histórico já gerado).
  async deactivate(id: string) {
    const employee = await this.assertExists(id);
    if (employee.status === EmployeeStatus.INACTIVE) {
      throw new ConflictException(`Funcionário ${id} já está inativo`);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id },
        data: { status: EmployeeStatus.INACTIVE, terminationDate: new Date() },
      }),
      this.prisma.employeeRecurringPayment.updateMany({
        where: { employeeId: id, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      }),
    ]);

    return updated;
  }
```

Run: `cd backend && npm run test -- employees.service`
Expected: PASS

- [ ] **Step 5: Testes de `EmployeeRecurringPaymentsService` (falha esperada)**

Criar `backend/src/employee-recurring-payments/employee-recurring-payments.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';

describe('EmployeeRecurringPaymentsService', () => {
  let service: EmployeeRecurringPaymentsService;
  let prisma: { employeeRecurringPayment: Record<string, jest.Mock>; employeePayment: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      employeeRecurringPayment: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
      employeePayment: { create: jest.fn() },
    };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        EmployeeRecurringPaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(EmployeeRecurringPaymentsService);
  });

  it('rejects generating a charge when the employee is inactive', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
      id: 'rec-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
    });
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'INACTIVE' });

    await expect(service.generateCharge('rec-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.employeePayment.create).not.toHaveBeenCalled();
  });

  it('generates a payment linked to the recurring payment via recurringPaymentId + reference period', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
      id: 'rec-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
    });
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1' });

    await service.generateCharge('rec-1');

    expect(prisma.employeePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'employee-1', recurringPaymentId: 'rec-1',
        referenceYear: expect.any(Number), referenceMonth: expect.any(Number),
        amount: 5000, status: 'PENDING',
      }),
    });
  });

  it('rejects a second charge for the same recurring payment in the same month (unique constraint translated to 409)', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
      id: 'rec-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
    });
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.employeePayment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002', clientVersion: '5.22.0', meta: { target: ['recurringPaymentId', 'referenceYear', 'referenceMonth'] },
      }),
    );

    await expect(service.generateCharge('rec-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('scopes the lookup to the current company, so a recurring payment from another company 404s', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue(null);
    await expect(service.findOne('rec-other-company')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.employeeRecurringPayment.findFirst).toHaveBeenCalledWith({
      where: { id: 'rec-other-company', companyId: 'company-1' },
    });
  });
});
```

Run: `cd backend && npm run test -- employee-recurring-payments.service`
Expected: FAIL

- [ ] **Step 6: DTOs e implementação de `EmployeeRecurringPaymentsService`**

Criar `backend/src/employee-recurring-payments/dto/create-employee-recurring-payment.dto.ts`:

```ts
import { IsInt, IsNumber, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateEmployeeRecurringPaymentDto {
  @IsString() @MinLength(1) description!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsInt() @Min(1) @Max(31) dueDay!: number;
}
```

Criar `backend/src/employee-recurring-payments/dto/update-employee-recurring-payment.dto.ts`:

```ts
import { EmployeeRecurringPaymentStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateEmployeeRecurringPaymentDto {
  @IsOptional() @IsString() @MinLength(1) description?: string;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) dueDay?: number;
  @IsOptional() @IsEnum(EmployeeRecurringPaymentStatus) status?: EmployeeRecurringPaymentStatus;
}
```

Criar `backend/src/employee-recurring-payments/employee-recurring-payments.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeRecurringPayment, Prisma } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeRecurringPaymentDto } from './dto/create-employee-recurring-payment.dto';
import { UpdateEmployeeRecurringPaymentDto } from './dto/update-employee-recurring-payment.dto';

@Injectable()
export class EmployeeRecurringPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async create(employeeId: string, dto: CreateEmployeeRecurringPaymentDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.prisma.employeeRecurringPayment.create({
      data: { ...dto, companyId: employee.companyId, employeeId },
    });
  }

  async findAllForEmployee(employeeId: string) {
    await this.employeesService.assertExists(employeeId);
    return this.prisma.employeeRecurringPayment.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });
  }

  // Rota top-level (employee-recurring-payments/:id, sem employeeId na URL) —
  // o único jeito de barrar acesso entre empresas aqui é filtrar por
  // companyId diretamente nesta query (não dá pra confiar em nenhuma checagem
  // downstream: findOne/update/remove nunca chegam a olhar o employeeId).
  async assertExists(id: string): Promise<EmployeeRecurringPayment> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const found = await this.prisma.employeeRecurringPayment.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException(`Recorrência ${id} não encontrada`);
    return found;
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateEmployeeRecurringPaymentDto) {
    await this.assertExists(id);
    return this.prisma.employeeRecurringPayment.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.employeeRecurringPayment.delete({ where: { id } });
    return { id };
  }

  async generateCharge(id: string) {
    const recurring = await this.assertExists(id);
    const employee = await this.employeesService.assertExists(recurring.employeeId);
    if (employee.status === 'INACTIVE') {
      throw new BadRequestException(`Não é possível gerar pagamento: funcionário ${recurring.employeeId} está inativo`);
    }

    const now = new Date();
    const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), recurring.dueDay));
    const monthLabel = now.toLocaleString('pt-BR', { month: 'long' });
    const referenceYear = now.getFullYear();
    const referenceMonth = now.getMonth() + 1;

    try {
      return await this.prisma.employeePayment.create({
        data: {
          companyId: recurring.companyId,
          employeeId: recurring.employeeId,
          recurringPaymentId: recurring.id,
          referenceYear,
          referenceMonth,
          description: `${recurring.description} (${monthLabel})`,
          amount: recurring.amount,
          dueDate,
          status: 'PENDING',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe um pagamento gerado para esta recorrência neste mês.');
      }
      throw err;
    }
  }
}
```

- [ ] **Step 7: Rodar os testes**

Run: `cd backend && npm run test -- employee-recurring-payments.service`
Expected: PASS (4 testes)

- [ ] **Step 8: Controller e módulo da recorrência**

Criar `backend/src/employee-recurring-payments/employee-recurring-payments.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateEmployeeRecurringPaymentDto } from './dto/create-employee-recurring-payment.dto';
import { UpdateEmployeeRecurringPaymentDto } from './dto/update-employee-recurring-payment.dto';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';

@Controller()
export class EmployeeRecurringPaymentsController {
  constructor(private readonly service: EmployeeRecurringPaymentsService) {}

  @Post('employees/:employeeId/recurring-payments')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeeRecurringPaymentDto) {
    return this.service.create(employeeId, dto);
  }

  @Get('employees/:employeeId/recurring-payments')
  findAllForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findAllForEmployee(employeeId);
  }

  @Get('employee-recurring-payments/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('employee-recurring-payments/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeRecurringPaymentDto) {
    return this.service.update(id, dto);
  }

  @Delete('employee-recurring-payments/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('employee-recurring-payments/:id/generate-charge')
  generateCharge(@Param('id') id: string) {
    return this.service.generateCharge(id);
  }
}
```

Criar `backend/src/employee-recurring-payments/employee-recurring-payments.module.ts`:

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
})
export class EmployeeRecurringPaymentsModule {}
```

- [ ] **Step 9: Testes de `EmployeePaymentsService` (falha esperada)**

Criar `backend/src/employee-payments/employee-payments.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeePaymentsService } from './employee-payments.service';

describe('EmployeePaymentsService', () => {
  let service: EmployeePaymentsService;
  let prisma: { employeePayment: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      employeePayment: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        EmployeePaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(EmployeePaymentsService);
  });

  it('creates a one-off payment for the given employee', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1' });

    await service.create('employee-1', { description: 'Bônus', amount: 500, dueDate: '2026-10-05' });

    expect(prisma.employeePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', amount: 500 }),
    });
  });

  it('marking a payment as paid records paidAt', async () => {
    prisma.employeePayment.findFirst.mockResolvedValue({ id: 'payment-1' });
    prisma.employeePayment.update.mockResolvedValue({ id: 'payment-1', status: 'PAID' });
    await service.pay('payment-1');
    expect(prisma.employeePayment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
  });

  it('derives overdue status from a pending payment with a past due date, without persisting it', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeePayment.findMany.mockResolvedValue([
      { id: 'payment-1', status: 'PENDING', dueDate: new Date('2000-01-01T00:00:00Z') },
    ]);
    prisma.employeePayment.count.mockResolvedValue(1);

    const result = await service.findAllForEmployee('employee-1', {});

    expect(result.items[0].derivedStatus).toBe('overdue');
  });

  it('scopes the lookup to the current company (missing id or another company both 404)', async () => {
    prisma.employeePayment.findFirst.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.employeePayment.findFirst).toHaveBeenCalledWith({ where: { id: 'missing', companyId: 'company-1' } });
  });
});
```

Run: `cd backend && npm run test -- employee-payments.service`
Expected: FAIL

- [ ] **Step 10: DTOs e implementação de `EmployeePaymentsService`**

Criar `backend/src/employee-payments/dto/create-employee-payment.dto.ts`:

```ts
import { IsDateString, IsNumber, IsString, Min, MinLength } from 'class-validator';

export class CreateEmployeePaymentDto {
  @IsString() @MinLength(1) description!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsDateString() dueDate!: string;
}
```

Criar `backend/src/employee-payments/dto/update-employee-payment.dto.ts`:

```ts
import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateEmployeePaymentDto {
  @IsOptional() @IsString() @MinLength(1) description?: string;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsDateString() dueDate?: string;
}
```

Criar `backend/src/employee-payments/dto/query-employee-payments.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class QueryEmployeePaymentsDto {
  @IsOptional() @IsIn(['pending', 'paid', 'overdue']) status?: 'pending' | 'paid' | 'overdue';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
```

Criar `backend/src/employee-payments/employee-payments.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeePayment } from '@prisma/client';
import { parseDateOnly, startOfToday } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeePaymentDto } from './dto/create-employee-payment.dto';
import { QueryEmployeePaymentsDto } from './dto/query-employee-payments.dto';
import { UpdateEmployeePaymentDto } from './dto/update-employee-payment.dto';

type DerivedStatus = 'pending' | 'paid' | 'overdue';

function deriveStatus(payment: Pick<EmployeePayment, 'status' | 'dueDate'>): DerivedStatus {
  if (payment.status === 'PAID') return 'paid';
  return payment.dueDate < startOfToday() ? 'overdue' : 'pending';
}

function toResponse(payment: EmployeePayment) {
  return { ...payment, derivedStatus: deriveStatus(payment) };
}

@Injectable()
export class EmployeePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async create(employeeId: string, dto: CreateEmployeePaymentDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    const created = await this.prisma.employeePayment.create({
      data: { ...dto, dueDate: parseDateOnly(dto.dueDate), companyId: employee.companyId, employeeId },
    });
    return toResponse(created);
  }

  async findAllForEmployee(employeeId: string, query: QueryEmployeePaymentsDto) {
    await this.employeesService.assertExists(employeeId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const today = startOfToday();

    const statusWhere =
      query.status === 'paid'
        ? { status: 'PAID' as const }
        : query.status === 'pending'
          ? { status: 'PENDING' as const, dueDate: { gte: today } }
          : query.status === 'overdue'
            ? { status: 'PENDING' as const, dueDate: { lt: today } }
            : {};

    const where = { employeeId, ...statusWhere };

    const [rows, total] = await Promise.all([
      this.prisma.employeePayment.findMany({ where, orderBy: { dueDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.employeePayment.count({ where }),
    ]);

    return { items: rows.map(toResponse), total, page, pageSize };
  }

  // Rota top-level (employee-payments/:id, sem employeeId na URL) — igual
  // EmployeeRecurringPaymentsService.assertExists, o filtro por companyId
  // aqui é a única barreira contra acessar o pagamento de outra empresa.
  private async assertExists(id: string): Promise<EmployeePayment> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const found = await this.prisma.employeePayment.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException(`Pagamento ${id} não encontrado`);
    return found;
  }

  async findOne(id: string) {
    return toResponse(await this.assertExists(id));
  }

  async update(id: string, dto: UpdateEmployeePaymentDto) {
    await this.assertExists(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.dueDate) data.dueDate = parseDateOnly(dto.dueDate);
    const updated = await this.prisma.employeePayment.update({ where: { id }, data });
    return toResponse(updated);
  }

  async pay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.employeePayment.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
    return toResponse(updated);
  }

  async unpay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.employeePayment.update({ where: { id }, data: { status: 'PENDING', paidAt: null } });
    return toResponse(updated);
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.employeePayment.delete({ where: { id } });
    return { id };
  }
}
```

- [ ] **Step 11: Rodar os testes**

Run: `cd backend && npm run test -- employee-payments.service`
Expected: PASS (4 testes)

- [ ] **Step 12: Controller e módulo de pagamentos, registro no `AppModule`**

Criar `backend/src/employee-payments/employee-payments.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateEmployeePaymentDto } from './dto/create-employee-payment.dto';
import { QueryEmployeePaymentsDto } from './dto/query-employee-payments.dto';
import { UpdateEmployeePaymentDto } from './dto/update-employee-payment.dto';
import { EmployeePaymentsService } from './employee-payments.service';

@Controller()
export class EmployeePaymentsController {
  constructor(private readonly service: EmployeePaymentsService) {}

  @Post('employees/:employeeId/payments')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeePaymentDto) {
    return this.service.create(employeeId, dto);
  }

  @Get('employees/:employeeId/payments')
  findAllForEmployee(@Param('employeeId') employeeId: string, @Query() query: QueryEmployeePaymentsDto) {
    return this.service.findAllForEmployee(employeeId, query);
  }

  @Get('employee-payments/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('employee-payments/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeePaymentDto) {
    return this.service.update(id, dto);
  }

  @Patch('employee-payments/:id/pay')
  pay(@Param('id') id: string) {
    return this.service.pay(id);
  }

  @Patch('employee-payments/:id/unpay')
  unpay(@Param('id') id: string) {
    return this.service.unpay(id);
  }

  @Delete('employee-payments/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

Criar `backend/src/employee-payments/employee-payments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeePaymentsController } from './employee-payments.controller';
import { EmployeePaymentsService } from './employee-payments.service';

@Module({
  imports: [EmployeesModule, CompanyModule],
  controllers: [EmployeePaymentsController],
  providers: [EmployeePaymentsService],
})
export class EmployeePaymentsModule {}
```

Em `backend/src/employees/employees.module.ts`, adicionar `PrismaModule`-style export não é necessário (já exporta `EmployeesService`); apenas garantir que `EmployeesModule` continua exportando `EmployeesService` (Task 3 já faz isso).

Registrar em `backend/src/app.module.ts`:

```ts
import { EmployeeRecurringPaymentsModule } from './employee-recurring-payments/employee-recurring-payments.module';
import { EmployeePaymentsModule } from './employee-payments/employee-payments.module';
```

- [ ] **Step 13: Commit**

```bash
git add backend/prisma backend/src/employees backend/src/employee-recurring-payments backend/src/employee-payments backend/src/app.module.ts
git commit -m "feat(backend): add employee payments and recurring payments modules"
```

---

## Task 6: Férias (`VacationCalculationService` + `VacationSchedulesModule`)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/vacations/vacation-calculation.service.ts`
- Create: `backend/src/vacations/vacation-calculation.service.spec.ts`
- Create: `backend/src/vacations/dto/schedule-vacation.dto.ts`
- Create: `backend/src/vacations/vacation-schedules.service.ts`
- Create: `backend/src/vacations/vacation-schedules.service.spec.ts`
- Create: `backend/src/vacations/vacation-schedules.controller.ts`
- Create: `backend/src/vacations/vacations.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `EmployeesService.assertExists`, `startOfToday` de `common/date.util`.
- Produces: `VacationCalculationService.calculate(params)`, usado tanto pela simulação quanto pelo agendamento.

- [ ] **Step 1: Adicionar o model `VacationSchedule` ao schema**

```prisma
enum VacationScheduleStatus {
  SCHEDULED
  APPROVED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model VacationSchedule {
  id                     String                 @id @default(cuid())
  companyId              String
  employeeId             String
  employee               Employee               @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  acquisitivePeriodStart DateTime               @db.Date
  acquisitivePeriodEnd   DateTime               @db.Date
  startDate              DateTime               @db.Date
  endDate                DateTime               @db.Date
  daysCount              Int
  status                 VacationScheduleStatus @default(SCHEDULED)
  notes                  String?
  createdAt              DateTime               @default(now())
  updatedAt              DateTime               @updatedAt

  @@index([companyId])
  @@index([employeeId])
  @@index([status])
}
```

Adicionar a relação inversa em `Employee`:

```prisma
model Employee {
  // ...campos existentes...
  vacationSchedules VacationSchedule[]
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd backend && npx prisma migrate dev --name add_vacation_schedules`

- [ ] **Step 3: Teste do `VacationCalculationService` com casos conhecidos (falha esperada)**

Criar `backend/src/vacations/vacation-calculation.service.spec.ts`:

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import { VacationCalculationService, VACATION_RULE_VERSION } from './vacation-calculation.service';

describe('VacationCalculationService', () => {
  const service = new VacationCalculationService();

  it('reports acquisition incomplete before 12 months worked', () => {
    const result = service.calculate({
      contractType: 'CLT' as never,
      admissionDate: new Date('2026-01-15T00:00:00Z'),
      baseValue: 3000,
      daysAlreadyTaken: 0,
      referenceDate: new Date('2026-06-15T00:00:00Z'), // 5 meses depois
    });

    expect(result.acquisitionComplete).toBe(false);
    expect(result.totalAcquiredDays).toBe(0);
    expect(result.proportionalDays).toBe(10); // 5/12 * 30 arredondado pra baixo
  });

  it('grants 30 full days after exactly one completed 12-month period, plus the constitutional one-third', () => {
    const result = service.calculate({
      contractType: 'CLT' as never,
      admissionDate: new Date('2025-01-15T00:00:00Z'),
      baseValue: 3000,
      daysAlreadyTaken: 0,
      referenceDate: new Date('2026-01-15T00:00:00Z'), // exatamente 12 meses depois
    });

    expect(result.acquisitionComplete).toBe(true);
    expect(result.totalAcquiredDays).toBe(30);
    expect(result.balanceDays).toBe(30);
    // 1/3 sobre o valor proporcional de 30 dias: (3000/30 * 30) / 3 = 1000
    expect(result.oneThirdBonus).toBe(1000);
  });

  it('subtracts days already taken from the balance, never going negative', () => {
    const result = service.calculate({
      contractType: 'CLT' as never,
      admissionDate: new Date('2024-01-15T00:00:00Z'),
      baseValue: 3000,
      daysAlreadyTaken: 40, // mais que os 30 de um período — não deve ficar negativo
      referenceDate: new Date('2025-01-15T00:00:00Z'),
    });

    expect(result.balanceDays).toBe(0);
  });

  it('throws UnprocessableEntityException for non-CLT contract types', () => {
    expect(() =>
      service.calculate({
        contractType: 'PJ' as never,
        admissionDate: new Date('2025-01-15T00:00:00Z'),
        baseValue: 3000,
        daysAlreadyTaken: 0,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('records a stable rule version string for auditability', () => {
    expect(VACATION_RULE_VERSION).toMatch(/CF\/88 art\. 7º XVII/);
  });
});
```

Run: `cd backend && npm run test -- vacation-calculation.service`
Expected: FAIL

- [ ] **Step 4: Implementar `VacationCalculationService`**

Criar `backend/src/vacations/vacation-calculation.service.ts`:

```ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ContractType } from '@prisma/client';
import { startOfToday } from '../common/date.util';

// Escopo desta etapa (aprovado explicitamente): regra básica de 30 dias por
// período aquisitivo de 12 meses, proporcional para período incompleto, mais
// o adicional constitucional de 1/3 (CF/88 art. 7º XVII). NÃO cobre: faltas
// injustificadas (CLT art. 130), abono pecuniário, adiantamento de 13º,
// INSS/IRRF, férias vencidas/em dobro (CLT art. 137) nem fracionamento em
// períodos — pedir esses casos deve responder 422 de forma explícita, nunca
// calcular um valor inventado.
export const VACATION_RULE_VERSION =
  '2026-09-10 — regra básica CLT (30 dias/ano, CLT art. 129) + adicional constitucional de 1/3 (CF/88 art. 7º XVII); ' +
  'faltas, abono, 13º, INSS/IRRF, dobro e fracionamento não suportados nesta etapa.';

export interface VacationCalculationInput {
  contractType: ContractType;
  admissionDate: Date;
  baseValue: number;
  daysAlreadyTaken: number;
  referenceDate?: Date;
}

export interface VacationCalculationResult {
  ruleVersion: string;
  admissionDate: Date;
  monthsWorked: number;
  acquisitivePeriodStart: Date;
  acquisitivePeriodEnd: Date;
  acquisitionComplete: boolean;
  totalAcquiredDays: number;
  proportionalDays: number;
  balanceDays: number;
  oneThirdBonus: number;
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

@Injectable()
export class VacationCalculationService {
  calculate(input: VacationCalculationInput): VacationCalculationResult {
    if (input.contractType !== 'CLT') {
      throw new UnprocessableEntityException(
        `Cálculo de férias CLT não se aplica ao vínculo ${input.contractType}.`,
      );
    }

    const referenceDate = input.referenceDate ?? startOfToday();
    const monthsWorked =
      (referenceDate.getUTCFullYear() - input.admissionDate.getUTCFullYear()) * 12 +
      (referenceDate.getUTCMonth() - input.admissionDate.getUTCMonth());

    const completedPeriods = Math.floor(monthsWorked / 12);
    const acquisitivePeriodStart = addMonths(input.admissionDate, completedPeriods * 12);
    const acquisitivePeriodEnd = addMonths(acquisitivePeriodStart, 12);

    const totalAcquiredDays = completedPeriods * 30;
    const currentPeriodMonths = monthsWorked % 12;
    const proportionalDays = Math.floor((currentPeriodMonths / 12) * 30);
    const balanceDays = Math.max(totalAcquiredDays - input.daysAlreadyTaken, 0);
    const dailyRate = input.baseValue / 30;
    const oneThirdBonus = Number(((dailyRate * balanceDays) / 3).toFixed(2));

    return {
      ruleVersion: VACATION_RULE_VERSION,
      admissionDate: input.admissionDate,
      monthsWorked,
      acquisitivePeriodStart,
      acquisitivePeriodEnd,
      acquisitionComplete: completedPeriods >= 1,
      totalAcquiredDays,
      proportionalDays,
      balanceDays,
      oneThirdBonus,
    };
  }
}
```

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && npm run test -- vacation-calculation.service`
Expected: PASS (5 testes)

- [ ] **Step 6: Testes de `VacationSchedulesService` (falha esperada)**

Criar `backend/src/vacations/vacation-schedules.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { VacationCalculationService } from './vacation-calculation.service';
import { VacationSchedulesService } from './vacation-schedules.service';

describe('VacationSchedulesService', () => {
  let service: VacationSchedulesService;
  let prisma: { vacationSchedule: Record<string, jest.Mock>; employeePayment: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      vacationSchedule: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      employeePayment: { count: jest.fn() },
    };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        VacationSchedulesService,
        VacationCalculationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(VacationSchedulesService);
  });

  it('rejects vacation status/simulation for a non-CLT employee with a clear message', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'PJ', admissionDate: new Date('2025-01-01'), baseValue: 3000,
    });
    await expect(service.status('employee-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('simulate() never persists a VacationSchedule row', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2025-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await service.simulate('employee-1', { startDate: '2026-02-01', endDate: '2026-03-02', daysCount: 30 });

    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects scheduling when the requested range overlaps an existing non-cancelled schedule', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([
      { id: 'existing', startDate: new Date('2026-02-10'), endDate: new Date('2026-02-20'), status: 'SCHEDULED' },
    ]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-15', endDate: '2026-02-25', daysCount: 11 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('creates a schedule with status SCHEDULED when the range does not overlap and balance is sufficient', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);
    prisma.vacationSchedule.create.mockResolvedValue({ id: 'schedule-1', status: 'SCHEDULED' });

    await service.schedule('employee-1', { startDate: '2026-02-01', endDate: '2026-03-02', daysCount: 30 });

    expect(prisma.vacationSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', status: 'SCHEDULED', daysCount: 30 }),
    });
  });

  it('cancel() scopes the lookup to the current company, so a schedule from another company 404s', async () => {
    prisma.vacationSchedule.findFirst.mockResolvedValue(null);
    await expect(service.cancel('schedule-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

Run: `cd backend && npm run test -- vacation-schedules.service`
Expected: FAIL

- [ ] **Step 7: DTO e implementação de `VacationSchedulesService`**

Criar `backend/src/vacations/dto/schedule-vacation.dto.ts`:

```ts
import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ScheduleVacationDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsInt() @Min(1) daysCount!: number;
  @IsOptional() @IsString() notes?: string;
}
```

Criar `backend/src/vacations/vacation-schedules.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleVacationDto } from './dto/schedule-vacation.dto';
import { VacationCalculationService } from './vacation-calculation.service';

@Injectable()
export class VacationSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly calculation: VacationCalculationService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private daysAlreadyTaken(employeeId: string) {
    return this.prisma.vacationSchedule
      .findMany({ where: { employeeId, status: { in: ['COMPLETED', 'IN_PROGRESS'] } } })
      .then((rows) => rows.reduce((sum, row) => sum + row.daysCount, 0));
  }

  async status(employeeId: string) {
    const employee = await this.employeesService.assertExists(employeeId);
    const daysAlreadyTaken = await this.daysAlreadyTaken(employeeId);
    return this.calculation.calculate({
      contractType: employee.contractType,
      admissionDate: employee.admissionDate,
      baseValue: Number(employee.baseValue),
      daysAlreadyTaken,
    });
  }

  // Simulação: roda o mesmo cálculo, nunca escreve no banco.
  async simulate(employeeId: string, dto: ScheduleVacationDto) {
    const vacationStatus = await this.status(employeeId);
    return {
      ...vacationStatus,
      requestedRange: { startDate: dto.startDate, endDate: dto.endDate, daysCount: dto.daysCount },
      sufficientBalance: dto.daysCount <= vacationStatus.balanceDays,
    };
  }

  private validateRange(startDate: string, endDate: string, daysCount: number) {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (end <= start) throw new BadRequestException('endDate deve ser posterior a startDate');
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (rangeDays !== daysCount) {
      throw new BadRequestException(`daysCount (${daysCount}) não corresponde ao intervalo informado (${rangeDays} dias)`);
    }
    return { start, end };
  }

  private async assertNoOverlap(employeeId: string, start: Date, end: Date) {
    const existing = await this.prisma.vacationSchedule.findMany({
      where: { employeeId, status: { not: 'CANCELLED' } },
    });
    const overlaps = existing.some((row) => start <= row.endDate && end >= row.startDate);
    if (overlaps) {
      throw new BadRequestException('Já existe um período de férias agendado que se sobrepõe a este intervalo');
    }
  }

  async schedule(employeeId: string, dto: ScheduleVacationDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    const vacationStatus = await this.status(employeeId);
    const { start, end } = this.validateRange(dto.startDate, dto.endDate, dto.daysCount);

    if (dto.daysCount > vacationStatus.balanceDays) {
      throw new BadRequestException(
        `Saldo insuficiente: disponível ${vacationStatus.balanceDays} dias, solicitado ${dto.daysCount}`,
      );
    }
    await this.assertNoOverlap(employeeId, start, end);

    return this.prisma.vacationSchedule.create({
      data: {
        companyId: employee.companyId,
        employeeId,
        acquisitivePeriodStart: vacationStatus.acquisitivePeriodStart,
        acquisitivePeriodEnd: vacationStatus.acquisitivePeriodEnd,
        startDate: start,
        endDate: end,
        daysCount: dto.daysCount,
        notes: dto.notes,
        status: 'SCHEDULED',
      },
    });
  }

  async findAllForEmployee(employeeId: string) {
    await this.employeesService.assertExists(employeeId);
    return this.prisma.vacationSchedule.findMany({ where: { employeeId }, orderBy: { startDate: 'desc' } });
  }

  // Rota top-level (vacation-schedules/:id/cancel, sem employeeId na URL) —
  // mesmo motivo do filtro por companyId em EmployeePaymentsService.assertExists.
  async cancel(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const schedule = await this.prisma.vacationSchedule.findFirst({ where: { id, companyId } });
    if (!schedule) throw new NotFoundException(`Agendamento de férias ${id} não encontrado`);
    return this.prisma.vacationSchedule.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
```

- [ ] **Step 8: Rodar os testes**

Run: `cd backend && npm run test -- vacation-schedules.service`
Expected: PASS (6 testes)

- [ ] **Step 9: Controller e módulo**

Criar `backend/src/vacations/vacation-schedules.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ScheduleVacationDto } from './dto/schedule-vacation.dto';
import { VacationSchedulesService } from './vacation-schedules.service';

@Controller()
export class VacationSchedulesController {
  constructor(private readonly service: VacationSchedulesService) {}

  @Get('employees/:employeeId/vacation/status')
  status(@Param('employeeId') employeeId: string) {
    return this.service.status(employeeId);
  }

  @Post('employees/:employeeId/vacation/simulate')
  simulate(@Param('employeeId') employeeId: string, @Body() dto: ScheduleVacationDto) {
    return this.service.simulate(employeeId, dto);
  }

  @Post('employees/:employeeId/vacation/schedule')
  schedule(@Param('employeeId') employeeId: string, @Body() dto: ScheduleVacationDto) {
    return this.service.schedule(employeeId, dto);
  }

  @Get('employees/:employeeId/vacation/schedules')
  findAllForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findAllForEmployee(employeeId);
  }

  @Patch('vacation-schedules/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
```

Criar `backend/src/vacations/vacations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { VacationCalculationService } from './vacation-calculation.service';
import { VacationSchedulesController } from './vacation-schedules.controller';
import { VacationSchedulesService } from './vacation-schedules.service';

@Module({
  imports: [EmployeesModule, CompanyModule],
  controllers: [VacationSchedulesController],
  providers: [VacationCalculationService, VacationSchedulesService],
})
export class VacationsModule {}
```

Registrar em `backend/src/app.module.ts`.

- [ ] **Step 10: Commit**

```bash
git add backend/prisma backend/src/vacations backend/src/app.module.ts
git commit -m "feat(backend): add isolated CLT vacation calculation and scheduling"
```

---

## Task 7: Validação final + documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify (ou criar): `B:\Quickflow\Quickflow\ARQUITETURA.md`, `BANCO-DE-DADOS.md`, `API.md`, `DECISOES-TECNICAS.md`
- Criar (se ainda não existirem): notas do vault para os novos módulos, se fizer sentido (ex.: seção de RH dentro das notas de backend já existentes, seguindo o padrão atual de uma nota por domínio, não por endpoint).

- [ ] **Step 1: Rodar a suíte completa de testes**

Run: `cd backend && npm run test`
Expected: PASS — todos os specs das Tasks 1-6 mais os já existentes (`clients`, `receivables`, `subscriptions`, `reports`).

- [ ] **Step 2: Rodar lint**

Run: `cd backend && npm run lint`
Expected: PASS, 0 warnings (`--max-warnings 0`).

- [ ] **Step 3: Rodar build**

Run: `cd backend && npm run build`
Expected: PASS (`tsc` sem erros).

- [ ] **Step 4: Confirmar que todas as migrations aplicam limpo do zero (checagem, não recria o banco de desenvolvimento)**

Run: `cd backend && npx prisma migrate status`
Expected: "Database schema is up to date!"

- [ ] **Step 5: Atualizar `CLAUDE.md`**

Adicionar, na seção `## Backend`, uma linha citando os novos módulos (`RolesModule`, `EmployeesModule`, `EmployeeWarningsModule`, `EmployeePaymentsModule`, `EmployeeRecurringPaymentsModule`, `VacationsModule`, `CompanyModule`) e registrar explicitamente:
- O stub de empresa única (`CompanyContextService`) e a pendência de autenticação real.
- O escopo da regra de férias implementada (30 dias + 1/3) e o que ficou de fora (faltas, abono, 13º, INSS/IRRF, dobro, fracionamento).
- Que o frontend de RH (`Roles.tsx`/`EmployeesList.tsx`/`EmployeeForm.tsx`) continua mockado e **não foi integrado nesta etapa** — só o backend foi construído.

- [ ] **Step 6: Atualizar as notas do vault**

Usar as skills `obsidian-markdown`/`obsidian-cli` para:
- `ARQUITETURA.md`: acrescentar os 6 novos módulos ao mapa de pastas e à lista de módulos NestJS, com uma nota sobre `CompanyModule` sendo global funcionalmente (mesmo sem `@Global()`, já que todo módulo de RH o importa).
- `BANCO-DE-DADOS.md`: acrescentar os models `Company`, `Role`, `Employee`, `EmployeeWarning`, `EmployeePayment`, `EmployeeRecurringPayment`, `VacationSchedule` ao schema documentado, com a mesma profundidade de explicação usada para `Client`/`Receivable`/`Subscription`.
- `API.md`: nova seção "Recursos Humanos" com a tabela de endpoints de Cargos/Funcionários/Advertências/Pagamentos/Recorrência/Férias.
- `DECISOES-TECNICAS.md`: nova seção "8. Módulo de RH" documentando (a) o stub de empresa/auth e o plano de substituição futura, (b) a decisão de CPF único por empresa, (c) o escopo aprovado da regra de férias e a pendência do histórico de mudança de cargo.
- Adicionar `[[RolesModule]]`-style wikilinks cruzando as notas novas com `[[ARQUITETURA]]`/`[[BANCO-DE-DADOS]]`/`[[API]]`, seguindo o padrão já usado nas notas existentes. Não duplicar conteúdo já coberto pelas notas de frontend (`Roles.md`, `EmployeesList.md`, `EmployeeForm.md`) — só linkar a partir delas se fizer sentido.

- [ ] **Step 7: Commit final da documentação**

```bash
git add CLAUDE.md
git commit -m "docs: document HR backend module (roles, employees, payments, vacations)"
```

(As notas do vault ficam em `B:\Quickflow\Quickflow`, fora do repositório git — não entram neste commit.)
