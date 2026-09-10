# QuickFlow Backend (Clientes, Lançamentos, Assinaturas, Relatórios) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um backend NestJS + Prisma + PostgreSQL para os módulos de Clientes, Lançamentos avulsos, Assinaturas recorrentes e Relatório financeiro, com contrato de dados espelhando o que já existe no frontend do QuickFlow.

**Architecture:** 4 módulos NestJS (`ClientsModule`, `ReceivablesModule`, `SubscriptionsModule`, `ReportsModule`) compartilhando um `PrismaModule` global. Rotas aninhadas por cliente para criar/listar lançamentos e assinaturas; rotas próprias por id para o resto. "Overdue" nunca é persistido — é derivado em runtime comparando `dueDate` com a data atual.

**Tech Stack:** NestJS 10, Prisma 5 + PostgreSQL (local, sem Docker), class-validator/class-transformer, Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-09-09-quickflow-backend-design.md`

## Global Constraints

- Sem Docker/Docker Compose em nenhuma etapa.
- Sem autenticação/autorização nesta etapa.
- `amount` sempre `Decimal(10,2)` no schema — nunca `Float`.
- `Receivable.status` no banco só tem `PENDING`/`PAID`; "overdue" é sempre derivado em runtime (nunca uma coluna/enum extra).
- `Client` nunca é hard-deletado, só inativado (`status`). `Receivable`/`Subscription` são hard-deletados.
- Validar existência do cliente (404) antes de criar `Receivable`/`Subscription`.
- Todos os comandos são PowerShell, com o diretório de trabalho indicado em cada passo. Diretório do backend: `C:\Users\cadus\Desktop\product\backend`.
- **Sem commit/push durante a implementação** — instrução explícita do usuário nesta tarefa, substitui o padrão da skill de sempre commitar a cada passo. As mudanças ficam no working tree para o usuário revisar e commitar manualmente.
- Nunca alterar/instalar PostgreSQL automaticamente; nunca tocar em bancos ou dados de outros projetos no mesmo servidor Postgres local.
- Não alterar o frontend nesta etapa.

---

### Task 1: Scaffold do projeto NestJS + Prisma + infraestrutura comum

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsconfig.build.json`
- Create: `backend/nest-cli.json`
- Create: `backend/.env.example`
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/prisma/prisma.module.ts`
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/common/filters/http-exception.filter.ts`
- Modify: `.gitignore` (raiz do repo)

**Interfaces:**
- Produces: `PrismaService` (injetável, exporta `PrismaClient` com models `client`, `receivable`, `subscription`), `HttpExceptionFilter`, schema Prisma completo (`Client`, `Receivable`, `Subscription` com enums `ClientStatus`, `ReceivableStatus`, `SubscriptionStatus`). Todas as tasks seguintes dependem destes.

- [ ] **Step 1: Criar `backend/package.json`**

```json
{
  "name": "quickflow-backend",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"{src,test}/**/*.ts\" --max-warnings 0",
    "test": "jest --testPathIgnorePatterns=test/",
    "test:watch": "jest --watch --testPathIgnorePatterns=test/",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.6",
    "@nestjs/core": "^10.4.6",
    "@nestjs/platform-express": "^10.4.6",
    "@prisma/client": "^5.20.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/schematics": "^10.1.4",
    "@nestjs/testing": "^10.4.6",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.13",
    "@types/node": "^20.16.10",
    "@types/supertest": "^6.0.2",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "eslint": "^8.57.1",
    "jest": "^29.7.0",
    "prisma": "^5.20.0",
    "source-map-support": "^0.5.21",
    "supertest": "^6.3.4",
    "ts-jest": "^29.2.5",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.6.2"
  },
  "jest": {
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Criar `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": false
  }
}
```

- [ ] **Step 3: Criar `backend/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

- [ ] **Step 4: Criar `backend/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

- [ ] **Step 5: Criar `backend/.env.example`**

```
DATABASE_URL="postgresql://USUARIO:SENHA@localhost:5432/quickflow?schema=public"
PORT=3001
```

- [ ] **Step 6: Criar `backend/prisma/schema.prisma`**

```prisma
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

- [ ] **Step 7: Criar `backend/src/prisma/prisma.service.ts`**

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 8: Criar `backend/src/prisma/prisma.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 9: Criar `backend/src/common/filters/http-exception.filter.ts`**

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    const errorPayload =
      typeof rawMessage === 'string'
        ? { statusCode, message: rawMessage }
        : { statusCode, ...(rawMessage as Record<string, unknown>) };

    response.status(statusCode).json({
      ...errorPayload,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 10: Criar `backend/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 11: Criar `backend/src/main.ts`**

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap();
```

- [ ] **Step 12: Atualizar `.gitignore` na raiz do repo**

Adicionar ao final do arquivo existente (que hoje só tem `node_modules`):

```
node_modules
backend/node_modules
backend/dist
backend/coverage
backend/.env
backend/*.log
```

- [ ] **Step 13: Instalar dependências e gerar o Prisma Client**

Diretório: `C:\Users\cadus\Desktop\product\backend`

```powershell
npm install
npx prisma generate
```

Expected: ambos os comandos terminam sem erro. `npx prisma generate` **não** precisa de um banco acessível — só lê `schema.prisma` e gera os tipos em `node_modules/@prisma/client`.

- [ ] **Step 14: Buildar o projeto**

Diretório: `C:\Users\cadus\Desktop\product\backend`

```powershell
npm run build
```

Expected: `dist/main.js` criado, sem erros de TypeScript.

---

### Task 2: Módulo de Clientes (criar, listar, buscar, atualizar)

**Files:**
- Create: `backend/src/clients/dto/create-client.dto.ts`
- Create: `backend/src/clients/dto/update-client.dto.ts`
- Create: `backend/src/clients/dto/query-clients.dto.ts`
- Create: `backend/src/clients/clients.service.ts`
- Create: `backend/src/clients/clients.service.spec.ts`
- Create: `backend/src/clients/clients.controller.ts`
- Create: `backend/src/clients/clients.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1).
- Produces: `ClientsService` com `create(dto)`, `findAll(query)`, `findOne(id)` (lança `NotFoundException` se não existir), `update(id, dto)`. Usado por `ReceivablesService`/`SubscriptionsService` (Tasks 3–4) indiretamente via `PrismaService.client.findUnique` (cada módulo valida existência do cliente por si, sem depender de `ClientsService` para evitar acoplamento entre módulos).

- [ ] **Step 1: Criar os DTOs**

`backend/src/clients/dto/create-client.dto.ts`:

```ts
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  @MinLength(1)
  contact!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
```

`backend/src/clients/dto/update-client.dto.ts`:

```ts
import { ClientStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() @MinLength(1) contact?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
}
```

`backend/src/clients/dto/query-clients.dto.ts`:

```ts
import { ClientStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryClientsDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
```

- [ ] **Step 2: Escrever o teste `backend/src/clients/clients.service.spec.ts` (vai falhar, `ClientsService` ainda não existe)**

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: { client: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      client: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [ClientsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ClientsService);
  });

  it('throws NotFoundException when client does not exist', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the client when found', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findUnique.mockResolvedValue(client);
    await expect(service.findOne('1')).resolves.toEqual(client);
  });

  it('updates only after confirming the client exists', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: '1' });
    prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE' });

    const result = await service.update('1', { status: 'INACTIVE' as any });

    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: 'INACTIVE' },
    });
    expect(result).toEqual({ id: '1', status: 'INACTIVE' });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Diretório: `backend`

```powershell
npm run test -- clients.service.spec.ts
```

Expected: FAIL — `Cannot find module './clients.service'`.

- [ ] **Step 4: Criar `backend/src/clients/clients.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClientDto) {
    return this.prisma.client.create({ data: dto });
  }

  async findAll(query: QueryClientsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { category: { contains: query.search, mode: 'insensitive' as const } },
              { contact: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.findOne(id);
    return this.prisma.client.update({ where: { id }, data: dto });
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Diretório: `backend`

```powershell
npm run test -- clients.service.spec.ts
```

Expected: PASS (3 testes).

- [ ] **Step 6: Criar `backend/src/clients/clients.controller.ts`**

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryClientsDto) {
    return this.clientsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }
}
```

- [ ] **Step 7: Criar `backend/src/clients/clients.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
```

- [ ] **Step 8: Registrar `ClientsModule` em `backend/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, ClientsModule],
})
export class AppModule {}
```

- [ ] **Step 9: Build e testes completos**

Diretório: `backend`

```powershell
npm run build
npm run test
```

Expected: ambos passam sem erro.

---

### Task 3: Módulo de Lançamentos (Receivables) — CRUD, pagar/desfazer, status derivado

**Files:**
- Create: `backend/src/receivables/dto/create-receivable.dto.ts`
- Create: `backend/src/receivables/dto/update-receivable.dto.ts`
- Create: `backend/src/receivables/dto/query-receivables.dto.ts`
- Create: `backend/src/receivables/receivables.service.ts`
- Create: `backend/src/receivables/receivables.service.spec.ts`
- Create: `backend/src/receivables/receivables.controller.ts`
- Create: `backend/src/receivables/receivables.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1).
- Produces: `deriveReceivableStatus(receivable: { status, dueDate }): 'pending'|'paid'|'overdue'` e `startOfToday(): Date`, ambas exportadas de `receivables.service.ts` — reaproveitadas pelo `ReportsService` (Task 5). `ReceivablesService` com `create`, `findAllForClient`, `findOne`, `update`, `pay`, `unpay`, `remove`.

- [ ] **Step 1: Criar os DTOs**

`backend/src/receivables/dto/create-receivable.dto.ts`:

```ts
import { IsDateString, IsNumber, IsString, Min, MinLength } from 'class-validator';

export class CreateReceivableDto {
  @IsString() @MinLength(1) description!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsDateString() dueDate!: string;
}
```

`backend/src/receivables/dto/update-receivable.dto.ts`:

```ts
import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateReceivableDto {
  @IsOptional() @IsString() @MinLength(1) description?: string;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsDateString() dueDate?: string;
}
```

`backend/src/receivables/dto/query-receivables.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class QueryReceivablesDto {
  @IsOptional() @IsIn(['pending', 'paid', 'overdue']) status?: 'pending' | 'paid' | 'overdue';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
```

- [ ] **Step 2: Escrever o teste `backend/src/receivables/receivables.service.spec.ts` (vai falhar)**

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReceivableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveReceivableStatus, ReceivablesService } from './receivables.service';

describe('deriveReceivableStatus', () => {
  it('returns paid when status is PAID regardless of due date', () => {
    const result = deriveReceivableStatus({ status: ReceivableStatus.PAID, dueDate: new Date('2000-01-01') });
    expect(result).toBe('paid');
  });

  it('returns overdue when pending and due date is in the past', () => {
    const result = deriveReceivableStatus({ status: ReceivableStatus.PENDING, dueDate: new Date('2000-01-01') });
    expect(result).toBe('overdue');
  });

  it('returns pending when pending and due date is in the future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const result = deriveReceivableStatus({ status: ReceivableStatus.PENDING, dueDate: future });
    expect(result).toBe('pending');
  });
});

describe('ReceivablesService', () => {
  let service: ReceivablesService;
  let prisma: { client: Record<string, jest.Mock>; receivable: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      client: { findUnique: jest.fn() },
      receivable: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [ReceivablesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ReceivablesService);
  });

  it('throws NotFoundException when creating a receivable for a missing client', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing', { description: 'x', amount: 10, dueDate: '2026-01-01' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.receivable.create).not.toHaveBeenCalled();
  });

  it('marks a receivable as paid and sets paidAt', async () => {
    prisma.receivable.findUnique.mockResolvedValue({ id: '1' });
    prisma.receivable.update.mockResolvedValue({
      id: '1',
      status: ReceivableStatus.PAID,
      dueDate: new Date('2020-01-01'),
      paidAt: new Date(),
    });

    const result = await service.pay('1');

    expect(prisma.receivable.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: ReceivableStatus.PAID, paidAt: expect.any(Date) },
    });
    expect(result.derivedStatus).toBe('paid');
  });

  it('reverts payment on unpay', async () => {
    prisma.receivable.findUnique.mockResolvedValue({ id: '1' });
    prisma.receivable.update.mockResolvedValue({
      id: '1',
      status: ReceivableStatus.PENDING,
      dueDate: new Date('2999-01-01'),
      paidAt: null,
    });

    const result = await service.unpay('1');

    expect(prisma.receivable.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: ReceivableStatus.PENDING, paidAt: null },
    });
    expect(result.derivedStatus).toBe('pending');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Diretório: `backend`

```powershell
npm run test -- receivables.service.spec.ts
```

Expected: FAIL — `Cannot find module './receivables.service'`.

- [ ] **Step 4: Criar `backend/src/receivables/receivables.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Receivable, ReceivableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { QueryReceivablesDto } from './dto/query-receivables.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';

export type DerivedReceivableStatus = 'pending' | 'paid' | 'overdue';

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function deriveReceivableStatus(
  receivable: Pick<Receivable, 'status' | 'dueDate'>,
): DerivedReceivableStatus {
  if (receivable.status === ReceivableStatus.PAID) return 'paid';
  return receivable.dueDate < startOfToday() ? 'overdue' : 'pending';
}

function toResponse(receivable: Receivable) {
  return { ...receivable, derivedStatus: deriveReceivableStatus(receivable) };
}

@Injectable()
export class ReceivablesService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Cliente ${clientId} não encontrado`);
  }

  private async assertExists(id: string) {
    const found = await this.prisma.receivable.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Lançamento ${id} não encontrado`);
  }

  async create(clientId: string, dto: CreateReceivableDto) {
    await this.ensureClientExists(clientId);
    const created = await this.prisma.receivable.create({
      data: { ...dto, dueDate: new Date(dto.dueDate), clientId },
    });
    return toResponse(created);
  }

  async findAllForClient(clientId: string, query: QueryReceivablesDto) {
    await this.ensureClientExists(clientId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const today = startOfToday();

    const statusWhere =
      query.status === 'paid'
        ? { status: ReceivableStatus.PAID }
        : query.status === 'pending'
          ? { status: ReceivableStatus.PENDING, dueDate: { gte: today } }
          : query.status === 'overdue'
            ? { status: ReceivableStatus.PENDING, dueDate: { lt: today } }
            : {};

    const where = { clientId, ...statusWhere };

    const [rows, total] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.receivable.count({ where }),
    ]);

    return { items: rows.map(toResponse), total, page, pageSize };
  }

  async findOne(id: string) {
    const receivable = await this.prisma.receivable.findUnique({ where: { id } });
    if (!receivable) throw new NotFoundException(`Lançamento ${id} não encontrado`);
    return toResponse(receivable);
  }

  async update(id: string, dto: UpdateReceivableDto) {
    await this.assertExists(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.dueDate) data.dueDate = new Date(dto.dueDate);
    const updated = await this.prisma.receivable.update({ where: { id }, data });
    return toResponse(updated);
  }

  async pay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.receivable.update({
      where: { id },
      data: { status: ReceivableStatus.PAID, paidAt: new Date() },
    });
    return toResponse(updated);
  }

  async unpay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.receivable.update({
      where: { id },
      data: { status: ReceivableStatus.PENDING, paidAt: null },
    });
    return toResponse(updated);
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.receivable.delete({ where: { id } });
    return { id };
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Diretório: `backend`

```powershell
npm run test -- receivables.service.spec.ts
```

Expected: PASS (6 testes).

- [ ] **Step 6: Criar `backend/src/receivables/receivables.controller.ts`**

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { QueryReceivablesDto } from './dto/query-receivables.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { ReceivablesService } from './receivables.service';

@Controller()
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Post('clients/:clientId/receivables')
  create(@Param('clientId') clientId: string, @Body() dto: CreateReceivableDto) {
    return this.receivablesService.create(clientId, dto);
  }

  @Get('clients/:clientId/receivables')
  findAllForClient(@Param('clientId') clientId: string, @Query() query: QueryReceivablesDto) {
    return this.receivablesService.findAllForClient(clientId, query);
  }

  @Get('receivables/:id')
  findOne(@Param('id') id: string) {
    return this.receivablesService.findOne(id);
  }

  @Patch('receivables/:id')
  update(@Param('id') id: string, @Body() dto: UpdateReceivableDto) {
    return this.receivablesService.update(id, dto);
  }

  @Patch('receivables/:id/pay')
  pay(@Param('id') id: string) {
    return this.receivablesService.pay(id);
  }

  @Patch('receivables/:id/unpay')
  unpay(@Param('id') id: string) {
    return this.receivablesService.unpay(id);
  }

  @Delete('receivables/:id')
  remove(@Param('id') id: string) {
    return this.receivablesService.remove(id);
  }
}
```

- [ ] **Step 7: Criar `backend/src/receivables/receivables.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';

@Module({
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
```

- [ ] **Step 8: Registrar `ReceivablesModule` em `backend/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';

@Module({
  imports: [PrismaModule, ClientsModule, ReceivablesModule],
})
export class AppModule {}
```

- [ ] **Step 9: Build e testes completos**

Diretório: `backend`

```powershell
npm run build
npm run test
```

Expected: ambos passam sem erro.

---

### Task 4: Módulo de Assinaturas (Subscriptions) — CRUD + gerar fatura do mês

**Files:**
- Create: `backend/src/subscriptions/dto/create-subscription.dto.ts`
- Create: `backend/src/subscriptions/dto/update-subscription.dto.ts`
- Create: `backend/src/subscriptions/subscriptions.service.ts`
- Create: `backend/src/subscriptions/subscriptions.service.spec.ts`
- Create: `backend/src/subscriptions/subscriptions.controller.ts`
- Create: `backend/src/subscriptions/subscriptions.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1). Não depende de `ReceivablesService` — `generateCharge` cria o `Receivable` diretamente via `PrismaService` para não criar dependência circular entre módulos.
- Produces: `SubscriptionsService` com `create`, `findAllForClient`, `findOne`, `update`, `remove`, `generateCharge`.

- [ ] **Step 1: Criar os DTOs**

`backend/src/subscriptions/dto/create-subscription.dto.ts`:

```ts
import { IsInt, IsNumber, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString() @MinLength(1) description!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsInt() @Min(1) @Max(31) dueDay!: number;
}
```

`backend/src/subscriptions/dto/update-subscription.dto.ts`:

```ts
import { SubscriptionStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateSubscriptionDto {
  @IsOptional() @IsString() @MinLength(1) description?: string;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) dueDay?: number;
  @IsOptional() @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
}
```

- [ ] **Step 2: Escrever o teste `backend/src/subscriptions/subscriptions.service.spec.ts` (vai falhar)**

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: {
    client: Record<string, jest.Mock>;
    subscription: Record<string, jest.Mock>;
    receivable: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    prisma = {
      client: { findUnique: jest.fn() },
      subscription: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      receivable: { create: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [SubscriptionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  it('throws NotFoundException when creating a subscription for a missing client', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing', { description: 'Plano', amount: 50, dueDay: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('generates a receivable charge from an active subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      clientId: 'client-1',
      description: 'Mensalidade Escolar',
      amount: 850,
      dueDay: 5,
      status: SubscriptionStatus.ACTIVE,
    });
    prisma.receivable.create.mockResolvedValue({ id: 'rec-1' });

    await service.generateCharge('sub-1');

    expect(prisma.receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        amount: 850,
        status: 'PENDING',
        description: expect.stringContaining('Mensalidade Escolar'),
      }),
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Diretório: `backend`

```powershell
npm run test -- subscriptions.service.spec.ts
```

Expected: FAIL — `Cannot find module './subscriptions.service'`.

- [ ] **Step 4: Criar `backend/src/subscriptions/subscriptions.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { ReceivableStatus, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Cliente ${clientId} não encontrado`);
  }

  private async assertExists(id: string): Promise<Subscription> {
    const found = await this.prisma.subscription.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Assinatura ${id} não encontrada`);
    return found;
  }

  async create(clientId: string, dto: CreateSubscriptionDto) {
    await this.ensureClientExists(clientId);
    return this.prisma.subscription.create({ data: { ...dto, clientId } });
  }

  async findAllForClient(clientId: string) {
    await this.ensureClientExists(clientId);
    return this.prisma.subscription.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    await this.assertExists(id);
    return this.prisma.subscription.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.subscription.delete({ where: { id } });
    return { id };
  }

  async generateCharge(id: string) {
    const subscription = await this.assertExists(id);
    const now = new Date();
    const dueDate = new Date(now.getFullYear(), now.getMonth(), subscription.dueDay);
    const monthLabel = dueDate.toLocaleString('pt-BR', { month: 'long' });

    return this.prisma.receivable.create({
      data: {
        clientId: subscription.clientId,
        description: `${subscription.description} (${monthLabel})`,
        amount: subscription.amount,
        dueDate,
        status: ReceivableStatus.PENDING,
      },
    });
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Diretório: `backend`

```powershell
npm run test -- subscriptions.service.spec.ts
```

Expected: PASS (2 testes).

- [ ] **Step 6: Criar `backend/src/subscriptions/subscriptions.controller.ts`**

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post('clients/:clientId/subscriptions')
  create(@Param('clientId') clientId: string, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(clientId, dto);
  }

  @Get('clients/:clientId/subscriptions')
  findAllForClient(@Param('clientId') clientId: string) {
    return this.subscriptionsService.findAllForClient(clientId);
  }

  @Get('subscriptions/:id')
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch('subscriptions/:id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, dto);
  }

  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.subscriptionsService.remove(id);
  }

  @Post('subscriptions/:id/generate-charge')
  generateCharge(@Param('id') id: string) {
    return this.subscriptionsService.generateCharge(id);
  }
}
```

- [ ] **Step 7: Criar `backend/src/subscriptions/subscriptions.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
```

- [ ] **Step 8: Registrar `SubscriptionsModule` em `backend/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, ClientsModule, ReceivablesModule, SubscriptionsModule],
})
export class AppModule {}
```

- [ ] **Step 9: Build e testes completos**

Diretório: `backend`

```powershell
npm run build
npm run test
```

Expected: ambos passam sem erro.

---

### Task 5: Módulo de Relatórios (financial-summary)

**Files:**
- Create: `backend/src/reports/reports.service.ts`
- Create: `backend/src/reports/reports.service.spec.ts`
- Create: `backend/src/reports/reports.controller.ts`
- Create: `backend/src/reports/reports.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1), `startOfToday` de `../receivables/receivables.service` (Task 3).
- Produces: `ReportsService.financialSummary(topDefaulters = 5): Promise<{ totalPaid, totalPending, totalOverdue, totalRecurring, topDefaulters: Array<{clientId, name, category, contact, overdueAmount}> }>`.

- [ ] **Step 1: Escrever o teste `backend/src/reports/reports.service.spec.ts` (vai falhar)**

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: { receivable: Record<string, jest.Mock>; subscription: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      receivable: { aggregate: jest.fn(), findMany: jest.fn() },
      subscription: { aggregate: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ReportsService);
  });

  it('aggregates totals and ranks defaulters by overdue amount, limited to topDefaulters', async () => {
    prisma.receivable.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // paid
      .mockResolvedValueOnce({ _sum: { amount: 200 } }); // pending
    prisma.receivable.findMany.mockResolvedValue([
      { amount: 300, client: { id: 'c1', name: 'Cliente 1', category: null, contact: 'x' } },
      { amount: 700, client: { id: 'c2', name: 'Cliente 2', category: null, contact: 'y' } },
      { amount: 100, client: { id: 'c1', name: 'Cliente 1', category: null, contact: 'x' } },
    ]);
    prisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 99.9 } });

    const result = await service.financialSummary(1);

    expect(result.totalPaid).toBe(1000);
    expect(result.totalPending).toBe(200);
    expect(result.totalOverdue).toBe(1100);
    expect(result.totalRecurring).toBe(99.9);
    expect(result.topDefaulters).toEqual([
      { clientId: 'c2', name: 'Cliente 2', category: null, contact: 'y', overdueAmount: 700 },
    ]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Diretório: `backend`

```powershell
npm run test -- reports.service.spec.ts
```

Expected: FAIL — `Cannot find module './reports.service'`.

- [ ] **Step 3: Criar `backend/src/reports/reports.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfToday } from '../receivables/receivables.service';

interface Defaulter {
  clientId: string;
  name: string;
  category: string | null;
  contact: string;
  overdueAmount: number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async financialSummary(topDefaulters = 5) {
    const today = startOfToday();

    const [paidAgg, pendingAgg, overdueRows, recurringAgg] = await Promise.all([
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { status: ReceivableStatus.PAID },
      }),
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { status: ReceivableStatus.PENDING, dueDate: { gte: today } },
      }),
      this.prisma.receivable.findMany({
        where: { status: ReceivableStatus.PENDING, dueDate: { lt: today } },
        select: {
          amount: true,
          client: { select: { id: true, name: true, category: true, contact: true } },
        },
      }),
      this.prisma.subscription.aggregate({
        _sum: { amount: true },
        where: { status: SubscriptionStatus.ACTIVE },
      }),
    ]);

    const overdueByClient = new Map<string, Defaulter>();
    let totalOverdue = 0;

    for (const row of overdueRows) {
      const amount = Number(row.amount);
      totalOverdue += amount;
      const existing = overdueByClient.get(row.client.id);
      if (existing) {
        existing.overdueAmount += amount;
      } else {
        overdueByClient.set(row.client.id, {
          clientId: row.client.id,
          name: row.client.name,
          category: row.client.category,
          contact: row.client.contact,
          overdueAmount: amount,
        });
      }
    }

    const rankedDefaulters = Array.from(overdueByClient.values())
      .sort((a, b) => b.overdueAmount - a.overdueAmount)
      .slice(0, topDefaulters);

    return {
      totalPaid: Number(paidAgg._sum.amount ?? 0),
      totalPending: Number(pendingAgg._sum.amount ?? 0),
      totalOverdue,
      totalRecurring: Number(recurringAgg._sum.amount ?? 0),
      topDefaulters: rankedDefaulters,
    };
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Diretório: `backend`

```powershell
npm run test -- reports.service.spec.ts
```

Expected: PASS (1 teste).

- [ ] **Step 5: Criar `backend/src/reports/reports.controller.ts`**

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial-summary')
  financialSummary(@Query('topDefaulters') topDefaulters?: string) {
    const limit = topDefaulters ? parseInt(topDefaulters, 10) : 5;
    return this.reportsService.financialSummary(Number.isFinite(limit) && limit > 0 ? limit : 5);
  }
}
```

- [ ] **Step 6: Criar `backend/src/reports/reports.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

- [ ] **Step 7: Registrar `ReportsModule` em `backend/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { ReportsModule } from './reports/reports.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, ClientsModule, ReceivablesModule, SubscriptionsModule, ReportsModule],
})
export class AppModule {}
```

- [ ] **Step 8: Build e testes completos**

Diretório: `backend`

```powershell
npm run build
npm run test
```

Expected: ambos passam sem erro.

---

### Task 6: Teste end-to-end

**Files:**
- Create: `backend/test/jest-e2e.json`
- Create: `backend/test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppModule` (Tasks 1–5), `HttpExceptionFilter` (Task 1), `PrismaService` (Task 1).
- Produces: nenhuma interface nova — é o teste de integração final. Sua execução completa depende do PostgreSQL local estar disponível (Task 9).

- [ ] **Step 1: Criar `backend/test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

- [ ] **Step 2: Criar `backend/test/app.e2e-spec.ts`**

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('QuickFlow backend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a client, a receivable, marks it as paid, and reflects it in the report', async () => {
    const server = app.getHttpServer();

    const clientRes = await request(server)
      .post('/clients')
      .send({ name: 'Cliente E2E', contact: '(11) 90000-0000' })
      .expect(201);

    const clientId = clientRes.body.id;

    const receivableRes = await request(server)
      .post(`/clients/${clientId}/receivables`)
      .send({ description: 'Mensalidade', amount: 100, dueDate: '2026-01-01' })
      .expect(201);

    await request(server).patch(`/receivables/${receivableRes.body.id}/pay`).expect(200);

    const listRes = await request(server).get(`/clients/${clientId}/receivables`).expect(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].derivedStatus).toBe('paid');

    const reportRes = await request(server).get('/reports/financial-summary').expect(200);
    expect(reportRes.body.totalPaid).toBeGreaterThanOrEqual(100);

    await prisma.receivable.deleteMany({ where: { clientId } });
    await prisma.client.delete({ where: { id: clientId } });
  });

  it('returns 404 when creating a receivable for a client that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/clients/does-not-exist/receivables')
      .send({ description: 'x', amount: 10, dueDate: '2026-01-01' })
      .expect(404);
  });
});
```

- [ ] **Step 3: Tentar rodar o teste e2e**

Diretório: `backend`

```powershell
npm run test:e2e
```

Expected: neste momento, **falha ao conectar no banco** (não há PostgreSQL local rodando ainda). Isso é esperado — o teste só passa depois da Task 9, com `DATABASE_URL` apontando para um `quickflow_test` acessível. Não tente contornar isso agora.

---

### Task 7: Verificação completa (lint, testes unitários, build)

**Files:** nenhum arquivo novo — só execução de comandos sobre o que foi criado nas Tasks 1–6.

**Interfaces:** nenhuma — task de verificação.

- [ ] **Step 1: Criar arquivo de configuração do ESLint**

`backend/.eslintrc.cjs`:

```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
```

- [ ] **Step 2: Rodar lint**

Diretório: `backend`

```powershell
npm run lint
```

Expected: sem erros. Se houver warnings, corrigir antes de seguir (o script usa `--max-warnings 0`, igual ao padrão do frontend).

- [ ] **Step 3: Rodar todos os testes unitários**

Diretório: `backend`

```powershell
npm run test
```

Expected: todas as suites (`clients`, `receivables`, `subscriptions`, `reports`) passam.

- [ ] **Step 4: Build final**

Diretório: `backend`

```powershell
npm run build
```

Expected: sem erros de TypeScript.

---

### Task 8: Documentação (CLAUDE.md + vault Obsidian)

**Files:**
- Modify: `CLAUDE.md` (raiz do repo, preservar conteúdo existente)
- Create/Modify: `B:\Quickflow\Quickflow\ARQUITETURA.md`
- Create/Modify: `B:\Quickflow\Quickflow\BANCO-DE-DADOS.md`
- Create/Modify: `B:\Quickflow\Quickflow\API.md`
- Create/Modify: `B:\Quickflow\Quickflow\AMBIENTE-LOCAL.md`
- Create/Modify: `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`
- Modify: `B:\Quickflow\Quickflow\Indice.md`

**Interfaces:** nenhuma — task de documentação. Usa as skills `obsidian-markdown` e `obsidian-cli` para ler/escrever as notas do vault.

- [ ] **Step 1: Ler o `CLAUDE.md` atual e adicionar uma seção "## Backend" ao final**, preservando tudo que já existe. Conteúdo a acrescentar:

```markdown
## Backend

Backend em `backend/` (NestJS + Prisma + PostgreSQL local, sem Docker), cobrindo Clientes,
Lançamentos, Assinaturas e Relatórios. Ver spec em
`docs/superpowers/specs/2026-09-09-quickflow-backend-design.md` e plano em
`docs/superpowers/plans/2026-09-09-quickflow-backend.md`.

**Comandos (diretório `backend/`):**
```
npm install              # instalar dependências
npx prisma generate      # gerar o Prisma Client (não precisa de banco)
npx prisma migrate dev   # aplicar migrations (precisa de PostgreSQL local rodando)
npm run start:dev        # servidor de dev (porta 3001 por padrão)
npm run build            # build de produção
npm run lint              # eslint --max-warnings 0
npm run test              # testes unitários (Jest)
npm run test:e2e          # teste de integração (precisa de PostgreSQL local rodando)
```

**Variáveis de ambiente** (`backend/.env`, nunca versionado — ver `backend/.env.example`):
- `DATABASE_URL` — string de conexão do PostgreSQL local (`postgresql://USUARIO:SENHA@localhost:5432/quickflow?schema=public`)
- `PORT` — porta HTTP do backend (padrão 3001)

**Arquitetura:** 4 módulos (`ClientsModule`, `ReceivablesModule`, `SubscriptionsModule`,
`ReportsModule`) + `PrismaModule` global. "Overdue" em lançamentos é sempre derivado em runtime
(nunca persistido). Ver `[[ARQUITETURA]]`, `[[BANCO-DE-DADOS]]`, `[[API]]`, `[[AMBIENTE-LOCAL]]` e
`[[DECISOES-TECNICAS]]` no vault (`B:\Quickflow\Quickflow`) para detalhes.

**Regra permanente de skills:** Antes de realizar qualquer tarefa neste projeto, o Claude Code deve
verificar as skills disponíveis e utilizar todas aquelas que forem relevantes ao contexto, seguindo
integralmente suas instruções. Skills não relacionadas à tarefa não devem ser utilizadas.
```

- [ ] **Step 2: Criar `B:\Quickflow\Quickflow\ARQUITETURA.md`** (usar a skill `obsidian-markdown` para formatar frontmatter/wikilinks corretamente), cobrindo: os 4 módulos NestJS, o `PrismaModule` global, o mapa de pastas de `backend/src`, e link `[[BANCO-DE-DADOS]]`, `[[API]]`, `[[DECISOES-TECNICAS]]`, `[[Indice]]`.

- [ ] **Step 3: Criar `B:\Quickflow\Quickflow\BANCO-DE-DADOS.md`** com o schema Prisma completo (Task 1, Step 6), explicando cada tabela/enum/índice e a decisão de "overdue derivado"; linkar `[[ARQUITETURA]]`, `[[DECISOES-TECNICAS]]`.

- [ ] **Step 4: Criar `B:\Quickflow\Quickflow\API.md`** com a tabela de endpoints (a mesma do spec, seção "Endpoints"), incluindo método, rota e descrição de cada um; linkar `[[ARQUITETURA]]`.

- [ ] **Step 5: Criar `B:\Quickflow\Quickflow\AMBIENTE-LOCAL.md`** com o conteúdo abaixo (usar a skill `obsidian-cli`/`obsidian-markdown` para escrever a nota com frontmatter):

```markdown
---
tags: [backend, postgresql, ambiente-local, quickflow]
aliases: [Setup PostgreSQL Windows]
---

# Ambiente Local — PostgreSQL (Windows, sem Docker)

Ver também: [[ARQUITETURA]] · [[BANCO-DE-DADOS]] · [[DECISOES-TECNICAS]]

> [!info] Todos os comandos abaixo são PowerShell. O diretório de trabalho é indicado em cada bloco.

## 1. Instalar PostgreSQL e pgAdmin

Já instalado neste ambiente: **PostgreSQL 18**, serviço Windows `postgresql-x64-18`, data directory
em `B:\PostgreSQL\18\data`, binários em `B:\PostgreSQL\18\bin` (instalação fora do caminho padrão
`C:\Program Files\PostgreSQL`, então os comandos abaixo já usam o caminho real). Se reinstalar em
outra máquina, baixe em https://www.postgresql.org/download/windows/ (inclui pgAdmin 4).

## 2. Verificar se o serviço está rodando

```powershell
Get-Service -Name "postgresql*"
```

`Status` deve estar `Running`. Se estiver `Stopped`, veja a seção 10.

## 3. Criar o banco `quickflow`

```powershell
& "B:\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE quickflow;"
```

## 4. Criar (ou escolher) um usuário local para a aplicação

```powershell
& "B:\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE USER quickflow_app WITH PASSWORD 'SUA_SENHA_LOCAL';"
```

## 5. Conceder permissões

```powershell
& "B:\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "GRANT ALL PRIVILEGES ON DATABASE quickflow TO quickflow_app;"
```

## 6. Configurar `DATABASE_URL`

Diretório: `C:\Users\cadus\Desktop\product\backend`

```powershell
Copy-Item .env.example .env
```

Edite `.env` e ajuste:

```
DATABASE_URL="postgresql://quickflow_app:SUA_SENHA_LOCAL@localhost:5432/quickflow?schema=public"
```

Nunca versione o `.env` real (já está no `.gitignore`).

## 7. Testar a conexão do Prisma

Diretório: `backend`

```powershell
npx prisma db pull
```

Se conectar sem erro, a `DATABASE_URL` está correta (o comando pode reportar "nenhuma tabela
encontrada" antes da primeira migration — isso é esperado).

## 8. Executar as migrations

Diretório: `backend`

```powershell
npx prisma migrate dev --name init
```

## 9. Visualizar o banco pelo pgAdmin

Abra o pgAdmin 4 → clique com o botão direito em "Servers" → "Register" → "Server" → em "Connection"
use Host `localhost`, Port `5432`, usuário `quickflow_app` (ou `postgres`), e navegue até
`Databases > quickflow > Schemas > public > Tables`.

## 10. Iniciar, parar e reiniciar o serviço

```powershell
Start-Service postgresql-x64-18
Stop-Service postgresql-x64-18
Restart-Service postgresql-x64-18
```

## 11. Problemas comuns

| Problema | Diagnóstico | Solução |
|---|---|---|
| Porta 5432 ocupada | `Test-NetConnection -ComputerName localhost -Port 5432` retorna `True` mas o serviço Postgres não inicia | Outro processo já usa a porta — identifique com `Get-NetTCPConnection -LocalPort 5432 \| Select OwningProcess` e finalize/reconfigure a porta em `postgresql.conf` |
| Serviço parado | `Get-Service postgresql*` mostra `Stopped` | `Start-Service postgresql-x64-18` |
| Senha incorreta | Erro `password authentication failed for user` | Redefina a senha: `psql -U postgres -c "ALTER USER quickflow_app WITH PASSWORD 'NOVA_SENHA'"` e atualize `.env` |
| Banco inexistente | Erro `database "quickflow" does not exist` | Repita o passo 3 |
| Falha de autenticação geral | Erro de `pg_hba.conf` | Verifique o método de autenticação em `pg_hba.conf` (`B:\PostgreSQL\18\data\pg_hba.conf` neste ambiente) — use `scram-sha-256` ou `md5` para conexões locais |
| Erro de conexão do Prisma (`P1001`) | `npx prisma db pull` ou `migrate dev` falham com "Can't reach database server" | Confirme que o serviço está `Running` (passo 2) e que `DATABASE_URL` bate com host/porta/usuário/senha |
| Migration pendente ou com falha | `npx prisma migrate dev` reporta drift ou migration falha no meio | Rode `npx prisma migrate status` para diagnosticar; em ambiente de desenvolvimento local sem dados importantes, `npx prisma migrate reset` recria o schema do zero |
```

- [ ] **Step 6: Criar `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`**, registrando as decisões da seção "Decisões" do spec (local do backend, escopo, regra de overdue derivado, hard delete de lançamentos/assinaturas vs. inativação de cliente, `paidAt` novo, Prisma+Postgres sem Docker, relatório via endpoint dedicado), cada uma com o motivo; linkar `[[ARQUITETURA]]`, `[[BANCO-DE-DADOS]]`.

- [ ] **Step 7: Atualizar `B:\Quickflow\Quickflow\Indice.md`** adicionando uma seção "## Backend" com `[[ARQUITETURA]]`, `[[BANCO-DE-DADOS]]`, `[[API]]`, `[[AMBIENTE-LOCAL]]`, `[[DECISOES-TECNICAS]]`. Não tocar na pasta `.obsidian`.

---

### Task 9: Setup do PostgreSQL local (usuário) + migration + e2e real

> **Atenção:** esta task depende de uma ação do usuário (instalar/configurar o PostgreSQL local no
> Windows) que não deve ser automatizada. Quem executar esta task deve pausar no Step 1 e aguardar
> confirmação de que o PostgreSQL está instalado e rodando antes de continuar.

**Files:** nenhum arquivo novo — usa `backend/prisma/schema.prisma` (Task 1) e `backend/test/app.e2e-spec.ts` (Task 6).

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Confirmar com o usuário que o PostgreSQL local está instalado e rodando**, seguindo `[[AMBIENTE-LOCAL]]` (Task 8, Step 5). Não prosseguir sem essa confirmação.

  Já confirmado neste ambiente: serviço `postgresql-x64-18` com `Status: Running`, porta `5432`
  aceitando conexões, binários em `B:\PostgreSQL\18\bin`. Falta apenas confirmar a senha do usuário
  `postgres`/`quickflow_app` antes de rodar os comandos dos steps seguintes.

- [ ] **Step 2: Criar o banco de teste `quickflow_test`**

```powershell
& "B:\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE quickflow_test;"
& "B:\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "GRANT ALL PRIVILEGES ON DATABASE quickflow_test TO quickflow_app;"
```

- [ ] **Step 3: Rodar a migration no banco de desenvolvimento**

Diretório: `backend`

```powershell
npx prisma migrate dev --name init
```

Expected: cria `backend/prisma/migrations/<timestamp>_init/migration.sql` e aplica no banco `quickflow`.

- [ ] **Step 4: Rodar o teste e2e contra `quickflow_test`**

Diretório: `backend`

```powershell
$env:DATABASE_URL = "postgresql://quickflow_app:SUA_SENHA_LOCAL@localhost:5432/quickflow_test?schema=public"
npx prisma migrate deploy
npm run test:e2e
```

Expected: as 2 suites de `app.e2e-spec.ts` passam.

- [ ] **Step 5: Confirmar que o banco de dev (`quickflow`) não foi afetado pelos testes**, e que nenhum outro banco/projeto no mesmo servidor Postgres foi tocado.

---

## Auto-Review (feito ao final da escrita deste plano)

- **Cobertura do spec:** todas as seções do spec (arquitetura, modelo de dados, endpoints incluindo
  relatórios, regras de negócio/erros, ambiente/banco, testes, documentação) têm task correspondente
  (Tasks 1–9).
- **Placeholders:** nenhum "TBD"/"TODO" — a única lacuna intencional é a Task 9 depender de uma ação
  manual do usuário (instalação do PostgreSQL), que é proibida de ser automatizada por instrução
  explícita do usuário; isso está documentado como um gate, não como um placeholder de conteúdo.
  `SUA_SENHA_LOCAL` no `AMBIENTE-LOCAL.md`/Task 9 é um valor que só o usuário conhece (senha
  escolhida por ele para o usuário `quickflow_app`) — não é lacuna de design, é um parâmetro de
  ambiente que o próprio spec pede para nunca ser fixado no código. Os caminhos de instalação do
  PostgreSQL (`B:\PostgreSQL\18`) e o nome do serviço (`postgresql-x64-18`) já foram confirmados
  neste ambiente e estão fixados no documento.
- **Consistência de tipos:** `deriveReceivableStatus`/`startOfToday` definidos uma vez em
  `receivables.service.ts` (Task 3) e reaproveitados sem redefinição em `reports.service.ts` (Task 5).
  Rotas do controller em cada task batem com a tabela de endpoints do spec.
