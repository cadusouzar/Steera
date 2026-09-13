# Autenticação Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o stub de empresa única (`CompanyContextService`) por autenticação real, multi-tenant: login/senha, tokens de acesso curtos + renovação rotativa com detecção de reuso, papéis `ADMIN`/`EMPLOYEE`, controle de módulos por login, e limite de logins `EMPLOYEE` por plano contratado.

**Architecture:** Backend ganha um `AuthModule` (login/refresh/logout/registro) e um `UsersModule` (admin gerencia outros logins) em cima do Prisma/NestJS já existente; `CompanyContextService` passa de singleton-com-stub para request-scoped, lendo `companyId` do token verificado — nenhuma outra query/service do backend muda. Frontend ganha uma camada de sessão (token de acesso em memória, renovação silenciosa) na frente do `request()` já existente, mais uma tela de login real e navegação restrita por módulo.

**Tech Stack:** `@nestjs/jwt` + `@nestjs/passport` + `passport-jwt` (access token), `argon2` (hash de senha), `@nestjs/throttler` (rate limiting), `cookie-parser` (ler o cookie do refresh token) — únicas dependências novas, todas no backend. Frontend sem dependência nova (fetch nativo já usado em `src/lib/api.ts`).

**Spec:** `docs/superpowers/specs/2026-09-11-auth-multitenant-design.md`

## Global Constraints

- Nenhum dado de tenant (`companyId`) é aceito do corpo/query de requisição alguma — sempre derivado do token de acesso já verificado.
- Senha nunca em texto puro em lugar nenhum (log, resposta de API, banco) — sempre hash `argon2`.
- Refresh token nunca em texto puro no banco — só o hash (`sha256`, já que é um valor aleatório de alta entropia, não uma senha de baixa entropia — `argon2` seria custo desnecessário aqui).
- Access token só em memória no frontend (nunca `localStorage`/`sessionStorage`); refresh token só em cookie `HttpOnly` + `Secure` + `SameSite=Strict`, nunca acessível a JavaScript.
- Nenhum endpoint novo aceita `companyId` do cliente — todos usam `CompanyContextService`/`req.user` como antes.
- Login `EMPLOYEE` só pode ser criado se já existir um `Employee` (RH) cadastrado, pertencente à mesma empresa, e ainda sem login associado.
- `Company.maxEmployeeLogins` nunca editável diretamente — só derivado de `planTier` no momento em que o plano muda.
- Sem processamento de pagamento real, sem recuperação de senha por e-mail, sem MFA nesta etapa — fora de escopo, documentado como pendência conhecida (mesmo padrão de outras pendências já registradas no projeto).
- Sem suíte de testes e2e contra Postgres real obrigatória — mesmo padrão já aceito no resto do backend (Jest com mocks); verificação manual ponta-a-ponta é o gate final.
- Nunca hard-delete de `User` — só `status: BLOCKED`, mesmo padrão do resto do projeto.

---

### Task 1: Modelo de dados + dependências novas

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/package.json` (via `npm install`)
- Create: uma nova pasta de migration em `backend/prisma/migrations/`

**Interfaces:**
- Produces: modelos Prisma `User`, `RefreshToken`; enums `AppModule`, `CompanyPlanTier`, `UserRole`, `UserStatus`; campos novos em `Company` (`planTier`, `maxEmployeeLogins`) e relação inversa em `Employee` (`user User?`).

- [ ] **Passo 1: Instalar as dependências novas**

Rodar em `backend/`:
```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt argon2 @nestjs/throttler cookie-parser
npm install -D @types/passport-jwt @types/cookie-parser
```

- [ ] **Passo 2: Adicionar os enums e modelos ao schema**

Em `backend/prisma/schema.prisma`, adicionar (perto dos outros enums/models de RH):

```prisma
enum AppModule {
  DASHBOARD
  CLIENTES
  RH
  COMERCIAL
  OPERACOES
  FINANCAS
}

enum CompanyPlanTier {
  BASICO
  PRO
  EMPRESARIAL
}

enum UserRole {
  ADMIN
  EMPLOYEE
}

enum UserStatus {
  ACTIVE
  BLOCKED
}

model User {
  id            String         @id @default(cuid())
  companyId     String
  company       Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  email         String         @unique
  passwordHash  String
  role          UserRole
  employeeId    String?        @unique
  employee      Employee?      @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  modules       AppModule[]
  status        UserStatus     @default(ACTIVE)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  refreshTokens RefreshToken[]

  @@index([companyId])
}

model RefreshToken {
  id                String    @id @default(cuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash         String    @unique
  expiresAt         DateTime
  revokedAt         DateTime?
  replacedByTokenId String?
  createdAt         DateTime  @default(now())

  @@index([userId])
}
```

No `model Company` já existente, adicionar dentro do bloco:
```prisma
  planTier          CompanyPlanTier @default(BASICO)
  maxEmployeeLogins Int             @default(10)
  users             User[]
```

No `model Employee` já existente, adicionar dentro do bloco:
```prisma
  user User?
```

- [ ] **Passo 3: Gerar e aplicar a migration com segurança**

Nunca usar `npx prisma db push --accept-data-loss` (incidente documentado em `DECISOES-TECNICAS.md`). Tentar primeiro:
```bash
cd backend
npx prisma migrate dev --name add_auth_multitenant
```
Se isso falhar contra a shadow database (problema pré-existente e conhecido, `P3006`, não relacionado a esta mudança), usar o fallback já estabelecido neste projeto:
```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/migration.sql
# criar backend/prisma/migrations/<timestamp>_add_auth_multitenant/migration.sql com esse conteúdo
npx prisma migrate deploy
npx prisma generate
```
Verificar ao final que um novo `migrate diff` reporta "This is an empty migration." (schema e banco realmente sincronizados, não só a tabela de controle).

- [ ] **Passo 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/package.json backend/package-lock.json
git commit -m "feat(backend): add User/RefreshToken models and auth dependencies"
```

---

### Task 2: Utilitários puros — senha e token

**Files:**
- Create: `backend/src/auth/password.util.ts`
- Create: `backend/src/auth/password.util.spec.ts`
- Create: `backend/src/auth/refresh-token.util.ts`
- Create: `backend/src/auth/refresh-token.util.spec.ts`

**Interfaces:**
- Consumes: nenhuma (funções puras/isoladas).
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>`, `generateRefreshTokenValue(): string`, `hashRefreshToken(value: string): string`.

- [ ] **Passo 1: `password.util.ts`**

```ts
import * as argon2 from 'argon2';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
```

- [ ] **Passo 2: teste de `password.util.ts`**

```ts
import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashes a password and verifies the correct plain text against it', async () => {
    const hash = await hashPassword('S3nhaForte!123');
    expect(hash).not.toBe('S3nhaForte!123');
    await expect(verifyPassword(hash, 'S3nhaForte!123')).resolves.toBe(true);
  });

  it('rejects an incorrect plain text against a real hash', async () => {
    const hash = await hashPassword('S3nhaForte!123');
    await expect(verifyPassword(hash, 'senha-errada')).resolves.toBe(false);
  });
});
```

- [ ] **Passo 3: `refresh-token.util.ts`**

```ts
import { randomBytes, createHash } from 'crypto';

// Valor aleatório de alta entropia (256 bits) — nunca persistido em texto
// puro, só o hash (sha256 é suficiente aqui: ao contrário de senha, que tem
// baixa entropia e precisa de argon2/bcrypt pra resistir a força bruta, este
// valor já É a entropia, hash rápido não enfraquece nada).
export function generateRefreshTokenValue(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

- [ ] **Passo 4: teste de `refresh-token.util.ts`**

```ts
import { generateRefreshTokenValue, hashRefreshToken } from './refresh-token.util';

describe('refresh-token.util', () => {
  it('generates a high-entropy value with no obvious collisions across calls', () => {
    const a = generateRefreshTokenValue();
    const b = generateRefreshTokenValue();
    expect(a).toHaveLength(64); // 32 bytes em hex
    expect(a).not.toBe(b);
  });

  it('hashes the same value to the same hash, deterministically', () => {
    const value = generateRefreshTokenValue();
    expect(hashRefreshToken(value)).toBe(hashRefreshToken(value));
  });

  it('hashes different values to different hashes', () => {
    expect(hashRefreshToken('a')).not.toBe(hashRefreshToken('b'));
  });
});
```

- [ ] **Passo 5: Rodar os testes e commitar**

```bash
cd backend
npm test -- password.util refresh-token.util
git add src/auth/password.util.ts src/auth/password.util.spec.ts src/auth/refresh-token.util.ts src/auth/refresh-token.util.spec.ts
git commit -m "feat(backend): add password hashing and refresh-token utilities"
```

---

### Task 3: `AuthModule` — registro, login, refresh, logout, troca de senha

**Files:**
- Create: `backend/src/auth/dto/register.dto.ts`
- Create: `backend/src/auth/dto/login.dto.ts`
- Create: `backend/src/auth/dto/change-password.dto.ts`
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.service.spec.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/auth/guards/jwt-auth.guard.ts`
- Create: `backend/src/auth/decorators/current-user.decorator.ts`
- Create: `backend/src/auth/decorators/public.decorator.ts`
- Create: `backend/src/auth/auth.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword`/`generateRefreshTokenValue`/`hashRefreshToken` (Task 2), `PrismaService` (já existente).
- Produces: `AuthService` com `register`, `login`, `refresh`, `logout`, `changePassword`; `JwtAuthGuard` (já preparado pra virar guard global na Task 4, respeitando `@Public()`); decorator `@CurrentUser()` retornando `{ userId, companyId, role, modules }`; decorator `@Public()`; rotas `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (as 4 marcadas `@Public()` — não exigem token, óbvio, ninguém tem token antes de logar), `GET /auth/me`, `PATCH /auth/me/password`.

**Ruling de pré-voo (registrado no ledger):** o plano original não tinha rota "quem sou eu" nenhuma — `Task 8` (frontend, renumerada — era Task 7 na primeira versão do plano) dependia de decodificar o JWT no cliente ou inventar uma chamada a `/companies/me/users`, e ficou marcado como "ressalva a resolver durante a implementação". Resolvido agora, antes de qualquer dispatch: adicionada `GET /auth/me` aqui mesmo, e o texto da Task 8 foi ajustado pra usá-la — sem ambiguidade sobrando pro implementador decidir sozinho.

**Contexto importante:** `POST /auth/register` cria uma `Company` nova + o primeiro `User` (`role=ADMIN`, todos os módulos, sem `employeeId`) numa transação. **Isso é um substituto temporário e documentado** para o que, quando o pagamento real existir, ficará atrás de uma confirmação de cobrança — hoje qualquer um que chame essa rota cria uma empresa nova de graça. Isso é aceitável nesta etapa (mesmo espírito do stub de empresa única que já existia) mas precisa ficar bem documentado como pendência, não como omissão.

- [ ] **Passo 1: DTOs**

`backend/src/auth/dto/register.dto.ts`:
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(1) companyName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
```

`backend/src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
```

`backend/src/auth/dto/change-password.dto.ts`:
```ts
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}
```

- [ ] **Passo 2: `JwtStrategy`, `JwtAuthGuard`, `@CurrentUser()`**

`backend/src/auth/strategies/jwt.strategy.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string; // userId
  companyId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Nunca deixar a biblioteca decidir o algoritmo a partir do próprio
      // token — fixa explicitamente HS256, evita ataque de confusão de
      // algoritmo (ex.: um token forjado pedindo "alg: none").
      algorithms: ['HS256'],
      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  validate(payload: JwtPayload) {
    return { userId: payload.sub, companyId: payload.companyId, role: payload.role, modules: payload.modules };
  }
}
```

`backend/src/auth/decorators/public.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`backend/src/auth/guards/jwt-auth.guard.ts` — já preparado pra ser registrado como guard **global** na Task 4 (nenhuma rota do projeto, existente ou nova, fica acessível sem token por padrão, exceto as marcadas `@Public()` explicitamente — "nega por padrão" é mais seguro do que ter que lembrar de aplicar o guard rota por rota):
```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

`backend/src/auth/decorators/current-user.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

- [ ] **Passo 3: `AuthService`**

```ts
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule as AppModuleEnum } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password.util';
import { generateRefreshTokenValue, hashRefreshToken } from './refresh-token.util';

const ALL_MODULES: AppModuleEnum[] = ['DASHBOARD', 'CLIENTES', 'RH', 'COMERCIAL', 'OPERACOES', 'FINANCAS'];
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const REFRESH_COOKIE_NAME = 'rt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private signAccessToken(user: { id: string; companyId: string; role: string; modules: string[] }) {
    return this.jwt.sign(
      { sub: user.id, companyId: user.companyId, role: user.role, modules: user.modules },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m', algorithm: 'HS256' },
    );
  }

  private async issueRefreshToken(userId: string, replaces?: string) {
    const value = generateRefreshTokenValue();
    const created = await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashRefreshToken(value), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    if (replaces) {
      await this.prisma.refreshToken.update({ where: { id: replaces }, data: { replacedByTokenId: created.id } });
    }
    return value;
  }

  private setRefreshCookie(res: Response, value: string) {
    res.cookie(REFRESH_COOKIE_NAME, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }

  async register(dto: { companyName: string; email: string; password: string }, res: Response) {
    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: dto.companyName } });
      return tx.user.create({
        data: {
          companyId: company.id,
          email: dto.email,
          passwordHash,
          role: 'ADMIN',
          modules: ALL_MODULES,
        },
      });
    });
    const accessToken = this.signAccessToken(user);
    const refreshValue = await this.issueRefreshToken(user.id);
    this.setRefreshCookie(res, refreshValue);
    return { accessToken, user: { id: user.id, email: user.email, role: user.role, modules: user.modules } };
  }

  async login(dto: { email: string; password: string }, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Mensagem genérica de propósito — nunca revelar se foi o e-mail ou a
    // senha que errou, isso ajudaria alguém tentando adivinhar contas válidas.
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    const accessToken = this.signAccessToken(user);
    const refreshValue = await this.issueRefreshToken(user.id);
    this.setRefreshCookie(res, refreshValue);
    return { accessToken, user: { id: user.id, email: user.email, role: user.role, modules: user.modules } };
  }

  async refresh(refreshCookieValue: string | undefined, res: Response) {
    if (!refreshCookieValue) throw new UnauthorizedException('Sessão não encontrada');
    const tokenHash = hashRefreshToken(refreshCookieValue);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão expirada, faça login novamente');
    }
    if (existing.revokedAt || existing.replacedByTokenId) {
      // Token já usado antes sendo reapresentado — sinal de roubo/replay.
      // Revoga TODA a família de tokens deste usuário, não só este.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sessão inválida, faça login novamente');
    }
    if (existing.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Login bloqueado');
    }
    const accessToken = this.signAccessToken(existing.user);
    const newRefreshValue = await this.issueRefreshToken(existing.userId, existing.id);
    this.setRefreshCookie(res, newRefreshValue);
    return { accessToken };
  }

  async logout(refreshCookieValue: string | undefined, res: Response) {
    if (refreshCookieValue) {
      const tokenHash = hashRefreshToken(refreshCookieValue);
      await this.prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/auth' });
  }

  async changePassword(userId: string, dto: { currentPassword: string; newPassword: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Senha atual incorreta');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  // Usado por GET /auth/me — devolve o MESMO formato de `user` que
  // login()/register() já devolvem ({ id, email, role, modules }), não os
  // claims crus do JWT (que não carregam `email`). Mantém o frontend com um
  // único formato de perfil pra lidar, venha ele de login ou de uma
  // renovação de sessão após reload.
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: user.id, email: user.email, role: user.role, modules: user.modules };
  }
}
```

- [ ] **Passo 4: teste de `AuthService`**

Mockar `PrismaService` (mesmo padrão já usado em todo o resto do backend, ex.: `vacation-schedules.service.spec.ts`) e `JwtService`. Casos mínimos:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import * as passwordUtil from './password.util';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  const fakeRes = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      refreshToken: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((cb) => cb(prisma)),
      company: { create: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: prisma }, { provide: JwtService, useValue: { sign: jest.fn(() => 'signed.jwt.token') } }],
    }).compile();
    service = module.get(AuthService);
    jest.clearAllMocks();
  });

  it('login rejects a non-existent user with a generic message', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ email: 'x@x.com', password: 'y' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects a blocked user even with the correct password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'BLOCKED', passwordHash: 'h' });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    await expect(service.login({ email: 'x@x.com', password: 'y' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects an incorrect password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE', passwordHash: 'h' });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    await expect(service.login({ email: 'x@x.com', password: 'errada' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh rejects when no cookie value is provided', async () => {
    await expect(service.refresh(undefined, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh rejects and revokes the whole family when a replaced token is reused', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', userId: 'u1', expiresAt: new Date(Date.now() + 10_000), revokedAt: null, replacedByTokenId: 'rt2', user: { status: 'ACTIVE' },
    });
    await expect(service.refresh('algum-valor', fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refresh rejects an expired token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', userId: 'u1', expiresAt: new Date(Date.now() - 10_000), revokedAt: null, replacedByTokenId: null, user: { status: 'ACTIVE' },
    });
    await expect(service.refresh('algum-valor', fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh succeeds for a valid, unused, unexpired token and rotates it', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', userId: 'u1', expiresAt: new Date(Date.now() + 10_000), revokedAt: null, replacedByTokenId: null,
      user: { id: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['DASHBOARD'], status: 'ACTIVE' },
    });
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt2' });
    const result = await service.refresh('algum-valor', fakeRes);
    expect(result.accessToken).toBe('signed.jwt.token');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({ where: { id: 'rt1' }, data: { replacedByTokenId: 'rt2' } });
  });

  it('changePassword rejects an incorrect current password', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: '1', passwordHash: 'h' });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    await expect(service.changePassword('1', { currentPassword: 'errada', newPassword: 'nova12345' })).rejects.toThrow('Senha atual incorreta');
  });
});
```

- [ ] **Passo 5: `AuthController`**

```ts
import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

// `me`/`me/password` levam @UseGuards(JwtAuthGuard) explícito aqui, mesmo
// sabendo que a Task 4 vai registrar esse mesmo guard globalmente — sem
// isso, ficariam sem nenhuma proteção no intervalo entre esta task e a
// próxima (o guard global só existe depois que app.module.ts for
// atualizado). Redundante depois da Task 4, nunca incorreto.
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // As 4 rotas abaixo são @Public() de propósito — ninguém tem token antes
  // de logar/registrar, e logout precisa funcionar mesmo com um access
  // token já expirado (só o cookie de refresh importa pra ele).
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, res);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
  }

  @Public()
  @Post('refresh')
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.rt, res);
  }

  @Public()
  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req.cookies?.rt, res);
  }

  // Busca o perfil completo (com email, que o JWT não carrega) — o frontend
  // usa isso pra saber quem está logado depois de uma renovação silenciosa
  // (F5), já que POST /auth/refresh só devolve o accessToken, não o perfil.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.userId, dto);
  }
}
```

- [ ] **Passo 6: `AuthModule`**

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PrismaModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Passo 7: Registrar `AuthModule`, aplicar `cookie-parser`, CORS restrito e rate limiting em `main.ts`/`app.module.ts`**

Em `backend/src/main.ts`:
```ts
import cookieParser from 'cookie-parser';
// ...
app.use(cookieParser());
app.enableCors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173', credentials: true });
```

Em `backend/src/app.module.ts`, adicionar aos imports: `AuthModule`, e `ThrottlerModule.forRoot([{ ttl: 900_000, limit: 5 }])` (5 requisições a cada 15 min, por padrão — se aplica globalmente, mas só as rotas de auth aplicam o guard, ver Passo 8). Adicionar `ThrottlerGuard` como `APP_GUARD` só nas rotas de auth (não global) — usar `@UseGuards(ThrottlerGuard)` diretamente em `AuthController` em vez de global, pra não limitar rotas de RH/Financeiro sem necessidade.

- [ ] **Passo 8: Aplicar rate limiting no `AuthController`**

```ts
import { Throttle } from '@nestjs/throttler';
// ...
@Throttle({ default: { limit: 5, ttl: 900_000 } })
@Post('login')
login(...) { ... }
```
(mesmo decorator em `register` e `refresh`.)

- [ ] **Passo 9: Variáveis de ambiente**

Adicionar ao `backend/.env.example` (nunca ao `.env` real, que não é versionado):
```
JWT_ACCESS_SECRET=troque-por-um-valor-aleatorio-longo-em-producao
FRONTEND_ORIGIN=http://localhost:5173
```

- [ ] **Passo 10: Rodar testes, build, lint e commitar**

```bash
cd backend
npm test -- auth
npm run build
npm run lint
git add src/auth backend/.env.example src/app.module.ts src/main.ts package.json package-lock.json
git commit -m "feat(backend): add AuthModule (register/login/refresh/logout/change-password)"
```

---

### Task 4: `CompanyContextService` real + `RolesGuard` + guard global

**Files:**
- Modify: `backend/src/company/company-context.service.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/src/auth/guards/roles.guard.ts`
- Create: `backend/src/auth/decorators/roles.decorator.ts`

**Interfaces:**
- Consumes: `AuthenticatedUser`/`JwtAuthGuard` (Task 3).
- Produces: `CompanyContextService.getCurrentCompanyId()` com a MESMA assinatura pública de antes (nenhum outro service do projeto precisa mudar); `@Roles('ADMIN')` + `RolesGuard` pra restringir rotas; `JwtAuthGuard` passa a ser exigido em **toda** rota do backend por padrão (exceto as marcadas `@Public()` na Task 3).

**Contexto:** todo service de RH/Financeiro já injeta `CompanyContextService` e chama só `getCurrentCompanyId()`. Trocar o corpo do método (de "stub de empresa única" pra "ler do usuário autenticado da requisição atual") não muda nenhum chamador — é exatamente o que o comentário original já previa.

**Ruling de pré-voo (registrado no ledger):** o plano original mudava `CompanyContextService` pra exigir `req.user`, mas nenhuma task aplicava `JwtAuthGuard` a nenhum controller já existente (Clientes, Funcionários, Cargos, Férias, Afastamento, Pagamentos, Relatórios) — sem isso, toda rota de RH/Financeiro quebraria com "chamado fora de uma requisição autenticada" assim que esta task terminasse, e nenhuma delas jamais teria como funcionar de novo. Resolvido registrando `JwtAuthGuard` (já preparado na Task 3 pra respeitar `@Public()`) como guard **global** (`APP_GUARD`) nesta task — nega por padrão em toda rota nova ou existente, sem precisar visitar e anotar cada controller do projeto um por um.

- [ ] **Passo 1: Tornar `CompanyContextService` request-scoped**

```ts
import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class CompanyContextService {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  async getCurrentCompanyId(): Promise<string> {
    // `req.user` é populado pelo JwtAuthGuard (ver AuthModule) — nunca aceito
    // de nenhum campo enviado pelo cliente.
    const user = (this.request as any).user;
    if (!user?.companyId) {
      throw new Error('CompanyContextService chamado fora de uma requisição autenticada');
    }
    return user.companyId;
  }
}
```

**Nota:** tornar este provider `Scope.REQUEST` faz o NestJS propagar o mesmo escopo pra qualquer service que o injete direta ou indiretamente (comportamento documentado do próprio framework) — isso é esperado e não muda nenhum comportamento funcional, só o tempo de vida da instância (uma por requisição em vez de uma única pra sempre). Nenhum teste existente que mocka `CompanyContextService` diretamente (fornecendo um objeto com `getCurrentCompanyId: jest.fn()`) precisa mudar, já que o mock nunca passou pelo NestJS DI de verdade.

- [ ] **Passo 2: `@Roles()` + `RolesGuard`**

`backend/src/auth/decorators/roles.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: ('ADMIN' | 'EMPLOYEE')[]) => SetMetadata('roles', roles);
```

`backend/src/auth/guards/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>('roles', context.getHandler());
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    return required.includes(user?.role);
  }
}
```

- [ ] **Passo 3: Registrar `JwtAuthGuard` como guard global em `app.module.ts`**

```ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
// ... dentro de @Module({ providers: [...] }):
providers: [
  // ... providers já existentes,
  { provide: APP_GUARD, useClass: JwtAuthGuard },
],
```
A partir daqui, **toda** rota do backend — nova ou já existente — exige um access token válido, exceto as 4 marcadas `@Public()` no `AuthController` (Task 3). Isso é intencional: nenhuma rota de Clientes/RH/Financeiro precisa de nenhuma anotação nova, elas simplesmente passam a exigir login, que é exatamente o objetivo desta etapa.

- [ ] **Passo 4: Rodar a suíte inteira do backend pra confirmar que nada quebrou**

```bash
cd backend
npm test
npm run build
npm run lint
```
Esperado: 100% dos testes unitários (`*.spec.ts` dentro de `src/`) continuam passando sem nenhuma mudança neles — eles instanciam services diretamente via `Test.createTestingModule` com providers mockados, nunca passam pela camada HTTP/guards de verdade, então um guard global não os afeta. (`backend/test/app.e2e-spec.ts`, que SIM faz chamadas HTTP reais, é endereçado separadamente na Task 7 (renumerada — era Task 6 na primeira versão do plano) — não faz parte deste `npm test`.)

- [ ] **Passo 5: Commit**

```bash
git add src/company/company-context.service.ts src/auth/decorators/roles.decorator.ts src/auth/guards/roles.guard.ts src/app.module.ts
git commit -m "feat(backend): make CompanyContextService read from the authenticated request; require auth globally"
```

---

### Task 5: Financeiro ganha isolamento real de tenant + corrige quebra do cron de cobrança

**Contexto (por que esta task existe, inserida depois do plano original):** a Task 4 tornou `CompanyContextService` request-scoped e o `JwtAuthGuard` global — ou seja, todo o backend passou a exigir autenticação de verdade. Ao verificar isso manualmente com duas empresas diferentes, ficou confirmado que `Client`/`Receivable`/`Subscription` (todo o módulo Financeiro) **nunca tiveram `companyId` nenhum** e `ClientsService`/`ReceivablesService`/`SubscriptionsService`/`ReportsService` nunca chamam `CompanyContextService` — ao contrário do módulo de RH, que já fazia isso certo (`RolesService` é o exemplo mais simples). Antes da Task 4, isso era invisível (só existia uma empresa no banco, stub). Agora que login real existe, **qualquer empresa que se cadastrar enxerga os clientes/lançamentos/assinaturas de todas as outras** — vazamento de dado financeiro entre inquilinos, confirmado ao vivo (duas empresas, mesmos 6 clientes visíveis pras duas). Esta task fecha esse buraco antes de qualquer outra parte do plano continuar.

Verificado também nesta descoberta: ligar `CompanyContextService` a `ClientsService` (necessário pra corrigir o vazamento acima) teria o efeito colateral de quebrar o cron `purgeExpiredTrashCron` já existente — o mesmo mecanismo que **já quebrou silenciosamente**, ao vivo, o cron diário de cobrança automática (`BillingSchedulerService`) assim que a Task 4 foi mergeada (confirmado subindo o backend de verdade: `[Scheduler] Cannot register cron job "BillingSchedulerService@runDailyCron" because it is defined in a non static provider.` — o motivo é que `EmployeeRecurringPaymentsService`, que já injetava `CompanyContextService` desde antes desta etapa, virou `Scope.REQUEST` transitivamente, e `BillingSchedulerService` injeta esse service no construtor, ficando request-scoped por tabela — e o NestJS/`@nestjs/schedule` **não consegue** registrar um `@Cron`/`OnApplicationBootstrap` num provider que não seja singleton). Esta task corrige os dois problemas juntos, porque são a mesma causa raiz: nenhum código que roda fora de uma requisição HTTP (cron) pode depender, nem transitivamente, de `CompanyContextService`.

**Files:**
- Modify: `backend/prisma/schema.prisma` (`companyId` em `Client`, relação inversa `clients Client[]` em `Company`)
- Create: nova migration em `backend/prisma/migrations/`
- Modify: `backend/src/clients/clients.service.ts`, `backend/src/clients/clients.service.spec.ts`, `backend/src/clients/clients.module.ts`
- Create: `backend/src/clients/client-trash.service.ts`, `backend/src/clients/client-trash.service.spec.ts`
- Modify: `backend/src/receivables/receivables.service.ts`, `backend/src/receivables/receivables.service.spec.ts`, `backend/src/receivables/receivables.module.ts`
- Modify: `backend/src/subscriptions/subscriptions.service.ts`, `backend/src/subscriptions/subscriptions.service.spec.ts`, `backend/src/subscriptions/subscriptions.module.ts`
- Create: `backend/src/subscriptions/subscriptions-billing.service.ts`, `backend/src/subscriptions/subscriptions-billing.service.spec.ts`
- Modify: `backend/src/employee-recurring-payments/employee-recurring-payments.service.ts`, `backend/src/employee-recurring-payments/employee-recurring-payments.service.spec.ts`, `backend/src/employee-recurring-payments/employee-recurring-payments.module.ts`
- Create: `backend/src/employee-recurring-payments/charge.util.ts`, `backend/src/employee-recurring-payments/employee-recurring-payments-billing.service.ts`, `backend/src/employee-recurring-payments/employee-recurring-payments-billing.service.spec.ts`
- Modify: `backend/src/reports/reports.service.ts`, `backend/src/reports/reports.service.spec.ts`, `backend/src/reports/reports.module.ts`
- Modify: `backend/src/billing/billing-scheduler.service.ts`, `backend/src/billing/billing-scheduler.service.spec.ts`

**Interfaces:**
- Consumes: `CompanyContextService.getCurrentCompanyId()` (já existe, real desde a Task 4).
- Produces: `ClientsService`/`ReceivablesService`/`SubscriptionsService`/`ReportsService` todos filtram por `companyId` da empresa autenticada; `ClientTrashService`, `SubscriptionsBillingService`, `EmployeeRecurringPaymentsBillingService` (novos, singleton, SEM `CompanyContextService`) — usados só por `BillingSchedulerService`, que volta a ser singleton de verdade (cron funcionando de novo).

**Decisão deliberada (registrar, não é omissão):** `Receivable`/`Subscription` NÃO ganham coluna `companyId` própria nesta task — diferente do padrão de denormalização já usado no módulo de RH (`EmployeePayment`/`EmployeeRecurringPayment` carregam `companyId` direto). Aqui, filtrar via a relação (`client: { companyId }`) é suficiente pra fechar o mesmo buraco de segurança com uma migration bem mais simples (uma tabela só, `Client`, precisa de backfill) — se performance de índice em `Receivable`/`Subscription` por empresa virar um problema real medido, denormalizar depois é aditivo, não um retrabalho.

- [ ] **Passo 1: Adicionar `companyId` a `Client` e migrar com segurança**

Em `backend/prisma/schema.prisma`, no `model Client`, adicionar:
```prisma
  companyId     String
  company       Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
```
(mantendo os campos/índices já existentes) e adicionar `@@index([companyId])` ao bloco de índices existente do modelo.

No `model Company` já existente, adicionar dentro do bloco:
```prisma
  clients Client[]
```

Antes de gerar a migration, confirme no banco local que existe pelo menos uma linha em `Company` (rode `npx prisma studio` ou uma query direta) — se por algum motivo não existir nenhuma e houver `Client`s órfãos, crie manualmente uma `Company` de fallback antes do backfill abaixo (não deveria acontecer neste banco de dev, mas o passo de verificação é obrigatório, não opcional).

Como este é um backfill (coluna nova `NOT NULL` numa tabela com dados existentes), gerar a migration manualmente em vez de deixar o `prisma migrate dev` interativo perguntar por um default:
```bash
cd backend
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_add_client_company_id
```
Nomeie a pasta com um timestamp maior que o da última migration existente (`ls prisma/migrations/` pra conferir). Dentro dela, crie `migration.sql`:
```sql
ALTER TABLE "Client" ADD COLUMN "companyId" TEXT;
UPDATE "Client" SET "companyId" = (SELECT "id" FROM "Company" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "Client" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Client_companyId_idx" ON "Client"("companyId");
```
Aplicar e verificar, seguindo o ritual já estabelecido neste projeto (nunca `db push --accept-data-loss`):
```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```
O último comando deve reportar "This is an empty migration." — confirma banco e schema realmente sincronizados.

- [ ] **Passo 2: `ClientsService` — extrair a purga de lixeira pra um singleton sem `CompanyContextService`, e escopar o resto por empresa**

`backend/src/clients/client-trash.service.ts` (novo arquivo — roda via `@Cron`, fora de qualquer requisição, por isso nunca injeta `CompanyContextService`; a purga em si não precisa de escopo de empresa, apaga o mesmo critério em todas):
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientTrashService {
  private readonly logger = new Logger(ClientTrashService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredTrashCron() {
    try {
      const count = await this.purgeExpiredTrash();
      if (count > 0) this.logger.log(`Purged ${count} client(s) from the trash`);
    } catch (err) {
      this.logger.error('Failed to purge expired client trash', err instanceof Error ? err.stack : String(err));
    }
  }

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
}
```

`backend/src/clients/client-trash.service.spec.ts` (mesmo padrão de mock de `PrismaService` já usado em todo o backend):
```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClientTrashService } from './client-trash.service';

describe('ClientTrashService', () => {
  let service: ClientTrashService;
  let prisma: { client: { deleteMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { client: { deleteMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [ClientTrashService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ClientTrashService);
  });

  it('deletes clients past the 30-day cutoff with includeInRevenueReport=false', async () => {
    prisma.client.deleteMany.mockResolvedValue({ count: 3 });
    const count = await service.purgeExpiredTrash();
    expect(count).toBe(3);
    expect(prisma.client.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'INACTIVE', includeInRevenueReport: false }),
    });
  });

  it('purgeExpiredTrashCron never throws even when the purge fails', async () => {
    prisma.client.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.purgeExpiredTrashCron()).resolves.toBeUndefined();
  });
});
```

Agora reescreva `backend/src/clients/clients.service.ts` inteiro:
```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientStatus, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { startOfToday } from '../common/date.util';
import { ClientTrashService } from './client-trash.service';
import { CreateClientDto } from './dto/create-client.dto';
import { DeactivateClientDto } from './dto/deactivate-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly clientTrash: ClientTrashService,
  ) {}

  async create(dto: CreateClientDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.client.create({ data: { ...dto, companyId } });
  }

  async findAll(query: QueryClientsDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.excludeTrashed
        ? { NOT: { status: ClientStatus.INACTIVE, includeInRevenueReport: false } }
        : {}),
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

  // Rota top-level (/clients/:id) — o único jeito de barrar acesso entre
  // empresas aqui é filtrar por companyId diretamente nesta query (mesmo
  // padrão de RolesService.assertExists).
  private async assertExists(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const client = await this.prisma.client.findFirst({ where: { id, companyId } });
    if (!client) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return client;
  }

  async findOne(id: string) {
    const client = await this.assertExists(id);
    const today = startOfToday();

    const [paidAgg, pendingAgg, overdueAgg] = await Promise.all([
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { clientId: id, status: ReceivableStatus.PAID },
      }),
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { clientId: id, status: ReceivableStatus.PENDING, dueDate: { gte: today } },
      }),
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { clientId: id, status: ReceivableStatus.PENDING, dueDate: { lt: today } },
      }),
    ]);

    return {
      ...client,
      totalPaid: Number(paidAgg._sum.amount ?? 0),
      totalPending: Number(pendingAgg._sum.amount ?? 0),
      totalOverdue: Number(overdueAgg._sum.amount ?? 0),
    };
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.assertExists(id);
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  async deactivate(id: string, dto: DeactivateClientDto) {
    const client = await this.assertExists(id);
    if (client.status === ClientStatus.INACTIVE) {
      throw new ConflictException(`Cliente ${id} já está inativo`);
    }

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

    return updatedClient;
  }

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

  // A purga em si (ClientTrashService.purgeExpiredTrash) roda sem escopo de
  // empresa — deleta de todas ao mesmo tempo, é seguro (mesmo critério
  // absoluto pra todas). A listagem que este método devolve, sim, é
  // escopada pra empresa autenticada.
  async findTrash() {
    await this.clientTrash.purgeExpiredTrash();
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.client.findMany({
      where: { companyId, status: ClientStatus.INACTIVE, includeInRevenueReport: false },
      orderBy: { deactivatedAt: 'asc' },
    });
  }
}
```

Atualize `backend/src/clients/clients.service.spec.ts`: adicione `CompanyContextService` (mock `getCurrentCompanyId: jest.fn().mockResolvedValue('company-1')`, mesmo padrão de `roles.service.spec.ts`) e `ClientTrashService` (mock `purgeExpiredTrash: jest.fn().mockResolvedValue(0)`) aos providers do `Test.createTestingModule`; ajuste as expectativas de `findFirst`/`create`/`findMany` que já existirem pra incluir `companyId` no `where`/`data` esperado, e mova qualquer teste que hoje exercite `purgeExpiredTrashCron`/`purgeExpiredTrash` diretamente em `ClientsService` para o novo `client-trash.service.spec.ts` (já escrito acima).

`backend/src/clients/clients.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientTrashService } from './client-trash.service';

@Module({
  imports: [CompanyModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientTrashService],
  exports: [ClientsService],
})
export class ClientsModule {}
```

- [ ] **Passo 3: `ReceivablesService` — escopar por empresa via a relação com `Client`**

Em `backend/src/receivables/receivables.service.ts`, injete `CompanyContextService` no construtor e escope `ensureClientExists`/`assertExists`/`findAllForClient` pela empresa atual:
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly companyContext: CompanyContextService,
) {}

private async ensureClientExists(clientId: string) {
  const companyId = await this.companyContext.getCurrentCompanyId();
  const client = await this.prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) throw new NotFoundException(`Cliente ${clientId} não encontrado`);
  return client;
}

private async assertExists(id: string): Promise<Receivable> {
  const companyId = await this.companyContext.getCurrentCompanyId();
  const found = await this.prisma.receivable.findFirst({ where: { id, client: { companyId } } });
  if (!found) throw new NotFoundException(`Lançamento ${id} não encontrado`);
  return found;
}
```
`findAllForClient` já chama `ensureClientExists(clientId)` primeiro — nenhuma outra mudança necessária lá além da própria checagem ficar escopada. Adicione o import de `CompanyContextService` do módulo `../company/company-context.service`. Atualize `receivables.service.spec.ts` com o mesmo mock de `CompanyContextService` usado em `roles.service.spec.ts`/`clients.service.spec.ts`, ajustando os `where` esperados nos testes existentes de `findFirst`. Atualize `backend/src/receivables/receivables.module.ts` pra importar `CompanyModule` (mesmo formato do `ClientsModule` acima).

- [ ] **Passo 4: `SubscriptionsService` — escopar CRUD por empresa; extrair `generateDueCharges` pra um singleton sem `CompanyContextService`**

`backend/src/subscriptions/subscriptions-billing.service.ts` (novo arquivo — roda via `BillingSchedulerService`, fora de requisição HTTP, processa TODAS as empresas numa passada só, igual o comportamento que `generateDueCharges` já tinha antes de existir multi-tenant; por isso nunca injeta `CompanyContextService`):
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ClientStatus, Prisma, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionsBillingService {
  private readonly logger = new Logger(SubscriptionsBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async createChargeForSubscription(subscription: {
    id: string;
    clientId: string;
    description: string;
    amount: Prisma.Decimal;
    dueDay: number;
  }) {
    const now = new Date();
    const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), subscription.dueDay));
    const monthLabel = now.toLocaleString('pt-BR', { month: 'long' });
    return this.prisma.receivable.create({
      data: {
        clientId: subscription.clientId,
        subscriptionId: subscription.id,
        referenceYear: now.getFullYear(),
        referenceMonth: now.getMonth() + 1,
        description: `${subscription.description} (${monthLabel})`,
        amount: subscription.amount,
        dueDate,
        status: ReceivableStatus.PENDING,
      },
    });
  }

  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;
    const lastDayOfMonth = new Date(Date.UTC(referenceYear, referenceMonth, 0)).getUTCDate();
    const effectiveDay = currentDay === lastDayOfMonth ? 31 : currentDay;

    const dueSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        dueDay: { lte: effectiveDay },
        client: { status: { not: ClientStatus.INACTIVE } },
        receivables: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const subscription of dueSubscriptions) {
      try {
        await this.createChargeForSubscription(subscription);
        generated++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue; // outra execução já gerou esta cobrança — esperado, ignorado.
        }
        this.logger.error(
          `Falha ao gerar cobrança da assinatura ${subscription.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return { checked: dueSubscriptions.length, generated };
  }
}
```

`backend/src/subscriptions/subscriptions-billing.service.spec.ts` — mesmo padrão de mock de `PrismaService`, cobrindo pelo menos: gera cobrança para assinatura vencida sem lançamento do mês; ignora (não loga como erro) uma colisão `P2002`; loga erro em qualquer outra falha; conta `checked`/`generated` corretamente.

Em `backend/src/subscriptions/subscriptions.service.ts`: **remova** o método `generateDueCharges` inteiro (movido acima). Injete `CompanyContextService` e escope `ensureClientExists`/`assertExists` como em `ReceivablesService` (mesmo padrão: `findFirst` com `{ id: clientId, companyId }` e `{ id, client: { companyId } }` respectivamente). `generateCharge(id)` continua igual (usado pelo botão manual "Gerar Fatura do Mês", chamado sempre dentro de uma requisição autenticada — sem mudança de comportamento aí, só herda o `assertExists` já escopado).

Atualize `subscriptions.service.spec.ts`: adicione o mock de `CompanyContextService`, ajuste os `where` esperados, e mova qualquer teste de `generateDueCharges` pro novo spec file criado acima.

`backend/src/subscriptions/subscriptions.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsBillingService } from './subscriptions-billing.service';

@Module({
  imports: [CompanyModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsBillingService],
  exports: [SubscriptionsService, SubscriptionsBillingService],
})
export class SubscriptionsModule {}
```

- [ ] **Passo 5: `EmployeeRecurringPaymentsService` — extrair `generateDueCharges` pro mesmo tipo de singleton**

`backend/src/employee-recurring-payments/charge.util.ts` (novo arquivo — função pura compartilhada entre o método usado pela rota HTTP manual e o novo singleton de cron, pra não duplicar o cálculo de data/label em dois lugares):
```ts
import { Prisma } from '@prisma/client';

export interface RecurringChargeSource {
  id: string;
  companyId: string;
  employeeId: string;
  description: string;
  amount: Prisma.Decimal;
  dueDay: number;
}

export function buildRecurringChargeData(recurring: RecurringChargeSource, now: Date) {
  const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), recurring.dueDay));
  const monthLabel = now.toLocaleString('pt-BR', { month: 'long' });
  return {
    companyId: recurring.companyId,
    employeeId: recurring.employeeId,
    recurringPaymentId: recurring.id,
    referenceYear: now.getFullYear(),
    referenceMonth: now.getMonth() + 1,
    description: `${recurring.description} (${monthLabel})`,
    amount: recurring.amount,
    dueDate,
    status: 'PENDING' as const,
  };
}
```

`backend/src/employee-recurring-payments/employee-recurring-payments-billing.service.ts` (novo arquivo — mesmo raciocínio de `SubscriptionsBillingService`: roda fora de requisição, nunca injeta `CompanyContextService`, processa todas as empresas numa passada):
```ts
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { buildRecurringChargeData } from './charge.util';

@Injectable()
export class EmployeeRecurringPaymentsBillingService {
  private readonly logger = new Logger(EmployeeRecurringPaymentsBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;
    const lastDayOfMonth = new Date(Date.UTC(referenceYear, referenceMonth, 0)).getUTCDate();
    const effectiveDay = currentDay === lastDayOfMonth ? 31 : currentDay;

    const dueRecurringPayments = await this.prisma.employeeRecurringPayment.findMany({
      where: {
        status: 'ACTIVE',
        dueDay: { lte: effectiveDay },
        employee: { status: { not: 'INACTIVE' }, salaryRecurrenceEnabled: true },
        payments: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const recurring of dueRecurringPayments) {
      try {
        await this.prisma.employeePayment.create({ data: buildRecurringChargeData(recurring, new Date()) });
        generated++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue;
        }
        this.logger.error(
          `Falha ao gerar pagamento da recorrência ${recurring.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return { checked: dueRecurringPayments.length, generated };
  }
}
```

`backend/src/employee-recurring-payments/employee-recurring-payments-billing.service.spec.ts` — mesmo padrão de mock de `PrismaService`, mesmos casos mínimos do spec de `SubscriptionsBillingService` acima, adaptados pra `employeeRecurringPayment`/`employeePayment`.

Em `backend/src/employee-recurring-payments/employee-recurring-payments.service.ts`:
1. **Remova** o método `generateDueCharges` inteiro (movido acima).
2. Reescreva `generateCharge` pra usar a função pura compartilhada:
```ts
async generateCharge(id: string) {
  const recurring = await this.assertExists(id);
  const employee = await this.employeesService.assertExists(recurring.employeeId);
  if (employee.status === 'INACTIVE') {
    throw new BadRequestException(`Não é possível gerar pagamento: funcionário ${recurring.employeeId} está inativo`);
  }
  try {
    return await this.prisma.employeePayment.create({ data: buildRecurringChargeData(recurring, new Date()) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Já existe um pagamento gerado para esta recorrência neste mês.');
    }
    throw err;
  }
}
```
(adicione o import `import { buildRecurringChargeData } from './charge.util';`). O resto da classe (`create`, `findAllForEmployee`, `assertExists`, `findOne`, `update`, `remove`) não muda — já usa `CompanyContextService` corretamente desde antes desta task.

Atualize `employee-recurring-payments.service.spec.ts`: remova os testes de `generateDueCharges` (movidos pro novo spec file) e ajuste o teste de `generateCharge` se ele verificava o formato exato do objeto passado pra `create` (deve continuar batendo, já que `buildRecurringChargeData` produz o mesmo formato de antes).

`backend/src/employee-recurring-payments/employee-recurring-payments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeeRecurringPaymentsController } from './employee-recurring-payments.controller';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';
import { EmployeeRecurringPaymentsBillingService } from './employee-recurring-payments-billing.service';

@Module({
  imports: [EmployeesModule, CompanyModule],
  controllers: [EmployeeRecurringPaymentsController],
  providers: [EmployeeRecurringPaymentsService, EmployeeRecurringPaymentsBillingService],
  exports: [EmployeeRecurringPaymentsService, EmployeeRecurringPaymentsBillingService],
})
export class EmployeeRecurringPaymentsModule {}
```

- [ ] **Passo 6: `ReportsService` — escopar o resumo financeiro por empresa**

Em `backend/src/reports/reports.service.ts`, injete `CompanyContextService` e adicione `companyId` ao filtro já existente:
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly companyContext: CompanyContextService,
) {}

async financialSummary(topDefaulters = 5) {
  const companyId = await this.companyContext.getCurrentCompanyId();
  const today = startOfToday();
  const revenueClientFilter = { client: { companyId, includeInRevenueReport: true } };
  // ... resto do método sem nenhuma outra mudança (revenueClientFilter já é usado em todos os 4 lugares)
}
```
Atualize `reports.service.spec.ts` com o mesmo mock de `CompanyContextService`. `backend/src/reports/reports.module.ts` ganha `imports: [CompanyModule]` (mesmo formato dos outros módulos acima).

- [ ] **Passo 7: `BillingSchedulerService` — voltar a ser singleton de verdade**

Reescreva `backend/src/billing/billing-scheduler.service.ts` trocando as duas dependências pelos novos singletons:
```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmployeeRecurringPaymentsBillingService } from '../employee-recurring-payments/employee-recurring-payments-billing.service';
import { SubscriptionsBillingService } from '../subscriptions/subscriptions-billing.service';

interface DueChargesResult {
  checked: number;
  generated: number;
}

@Injectable()
export class BillingSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
    private readonly subscriptionsBilling: SubscriptionsBillingService,
    private readonly employeeRecurringPaymentsBilling: EmployeeRecurringPaymentsBillingService,
  ) {}

  async onApplicationBootstrap() {
    await this.runCatchUp('inicialização');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCron() {
    await this.runCatchUp('cron diário');
  }

  private async runCatchUp(trigger: string) {
    const subs = await this.safeGenerate(
      () => this.subscriptionsBilling.generateDueCharges(),
      'assinaturas de clientes',
      trigger,
    );
    const employees = await this.safeGenerate(
      () => this.employeeRecurringPaymentsBilling.generateDueCharges(),
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
Atualize `billing-scheduler.service.spec.ts` só nos nomes das variáveis mockadas (`subscriptionsBilling`/`employeeRecurringPaymentsBilling` em vez de `subscriptionsService`/`employeeRecurringPaymentsService`) — o comportamento testado não muda. `backend/src/billing/billing.module.ts` já importa `SubscriptionsModule`/`EmployeeRecurringPaymentsModule`, que agora exportam os novos singletons também — nenhuma mudança de import necessária ali.

- [ ] **Passo 8: Verificação manual — provar que o vazamento fechou E que o cron voltou a registrar**

Com o backend rodando de verdade (reinicie pra pegar o schema/DI atualizados):
1. Confirme no log de boot que a linha `Cannot register cron job "BillingSchedulerService@runDailyCron" because it is defined in a non static provider` **não aparece mais**.
2. Registre (ou reutilize) duas empresas diferentes via `/auth/register`. Crie um cliente em cada uma (`POST /clients` autenticado como cada admin). `GET /clients` de cada uma deve devolver **só o próprio cliente**, nunca o da outra.
3. Repita o mesmo teste para `GET /clients/trash` (lixeira) e `GET /reports/financial-summary` (totais/inadimplentes não devem incluir a outra empresa).
4. Tente `GET /receivables/:id`/`GET /subscriptions/:id` de um lançamento/assinatura pertencente à empresa A autenticado como um usuário da empresa B — confirme `404` (não deve nem revelar que o recurso existe).

- [ ] **Passo 9: Rodar testes, build, lint e commitar**

```bash
cd backend
npm test
npm run build
npm run lint
git add prisma/schema.prisma prisma/migrations src/clients src/receivables src/subscriptions src/employee-recurring-payments src/reports src/billing
git commit -m "fix(backend): scope Financeiro (Client/Receivable/Subscription/Reports) by tenant; fix billing cron broken by request-scoped CompanyContextService"
```

---

### Task 6: `UsersModule` — admin gerencia logins

**Files:**
- Create: `backend/src/users/dto/create-user.dto.ts`
- Create: `backend/src/users/dto/update-plan.dto.ts`
- Create: `backend/src/users/users.service.ts`
- Create: `backend/src/users/users.service.spec.ts`
- Create: `backend/src/users/users.controller.ts`
- Create: `backend/src/users/company-plan.controller.ts`
- Create: `backend/src/users/users.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `CompanyContextService.getCurrentCompanyId()`, `@CurrentUser()`, `@Roles('ADMIN')`, `JwtAuthGuard`, `RolesGuard`, `hashPassword`/`generateRefreshTokenValue` (reuso, não recriar).
- Produces: `POST /companies/me/users`, `GET /companies/me/users`, `PATCH /companies/me/users/:id/block`, `PATCH /companies/me/users/:id/unblock`, `PATCH /companies/me/plan`.

- [ ] **Passo 1: DTOs**

`backend/src/users/dto/create-user.dto.ts`:
```ts
import { AppModule as AppModuleEnum } from '@prisma/client';
import { IsArray, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsEnum(['ADMIN', 'EMPLOYEE']) role!: 'ADMIN' | 'EMPLOYEE';
  @IsOptional() @IsString() employeeId?: string; // obrigatório na prática quando role=EMPLOYEE, checado no service
  @IsArray() @IsEnum(AppModuleEnum, { each: true }) modules!: AppModuleEnum[];
}
```

`backend/src/users/dto/update-plan.dto.ts`:
```ts
import { IsEnum } from 'class-validator';

export class UpdatePlanDto {
  @IsEnum(['BASICO', 'PRO', 'EMPRESARIAL']) planTier!: 'BASICO' | 'PRO' | 'EMPRESARIAL';
}
```

- [ ] **Passo 2: `UsersService`**

```ts
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { generateRefreshTokenValue } from '../auth/refresh-token.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

const PLAN_LIMITS: Record<string, number> = { BASICO: 10, PRO: 50, EMPRESARIAL: 999_999 };

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForCompany(companyId: string) {
    return this.prisma.user.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  }

  async create(companyId: string, dto: CreateUserDto) {
    if (dto.role === 'EMPLOYEE') {
      if (!dto.employeeId) throw new BadRequestException('employeeId é obrigatório para login do tipo EMPLOYEE');
      const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
      if (!employee) throw new BadRequestException(`Funcionário ${dto.employeeId} não encontrado nesta empresa`);
      const existingLogin = await this.prisma.user.findUnique({ where: { employeeId: dto.employeeId } });
      if (existingLogin) throw new BadRequestException('Este funcionário já possui um login');

      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      const activeEmployeeLogins = await this.prisma.user.count({
        where: { companyId, role: 'EMPLOYEE', status: 'ACTIVE' },
      });
      if (activeEmployeeLogins >= company.maxEmployeeLogins) {
        throw new ForbiddenException(
          `Limite de logins de funcionário do plano atual (${company.maxEmployeeLogins}) já foi atingido`,
        );
      }
    }

    // Senha temporária de alta entropia — devolvida uma única vez na resposta;
    // o hash é o que persiste. O login troca no primeiro acesso via
    // PATCH /auth/me/password.
    const temporaryPassword = generateRefreshTokenValue().slice(0, 16);
    const passwordHash = await hashPassword(temporaryPassword);

    const user = await this.prisma.user.create({
      data: {
        companyId,
        email: dto.email,
        passwordHash,
        role: dto.role,
        employeeId: dto.role === 'EMPLOYEE' ? dto.employeeId : null,
        modules: dto.modules,
      },
    });

    return { user, temporaryPassword };
  }

  async block(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new BadRequestException(`Login ${userId} não encontrado nesta empresa`);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async unblock(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new BadRequestException(`Login ${userId} não encontrado nesta empresa`);
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
  }

  updatePlan(companyId: string, dto: UpdatePlanDto) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: { planTier: dto.planTier, maxEmployeeLogins: PLAN_LIMITS[dto.planTier] },
    });
  }
}
```

- [ ] **Passo 3: teste de `UsersService`**

Mockar `PrismaService`. Casos mínimos:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      user: { findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      company: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(UsersService);
  });

  it('rejects creating an EMPLOYEE login without employeeId', async () => {
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login for an employee from another company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating a second login for an employee that already has one', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login once the plan limit is reached', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(10);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates an EMPLOYEE login under the plan limit and returns a one-time temporary password', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(9);
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@a.com', role: 'EMPLOYEE' });
    const result = await service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: ['RH'] } as any);
    expect(result.temporaryPassword).toHaveLength(16);
    expect(result.user.id).toBe('u1');
  });

  it('creates an ADMIN login without checking the employee-linked plan limit', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin2@a.com', role: 'ADMIN' });
    const result = await service.create('c1', { email: 'admin2@a.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any);
    expect(result.user.id).toBe('u2');
    expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('block scopes the lookup to the current company and revokes active refresh tokens', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
    await service.block('c1', 'u1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('block 404s for a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.block('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Passo 4: `UsersController`**

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('companies/me/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findAllForCompany(user.companyId);
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.companyId, dto);
  }

  @Roles('ADMIN')
  @Patch(':id/block')
  block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.block(user.companyId, id);
  }

  @Roles('ADMIN')
  @Patch(':id/unblock')
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.unblock(user.companyId, id);
  }

}
```

Rota de plano num controller irmão separado, prefixo próprio (`companies/me`, sem colidir com `companies/me/users`):

```ts
import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('companies/me')
export class CompanyPlanController {
  constructor(private readonly users: UsersService) {}

  @Roles('ADMIN')
  @Patch('plan')
  updatePlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePlanDto) {
    return this.users.updatePlan(user.companyId, dto);
  }
}
```

- [ ] **Passo 5: `UsersModule`**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CompanyPlanController } from './company-plan.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController, CompanyPlanController],
  providers: [UsersService],
})
export class UsersModule {}
```

Registrar `UsersModule` em `backend/src/app.module.ts`.

- [ ] **Passo 6: Rodar testes, build, lint e commitar**

```bash
cd backend
npm test -- users
npm run build
npm run lint
git add src/users src/app.module.ts
git commit -m "feat(backend): add UsersModule (create/list/block/unblock logins, update plan)"
```

---

### Task 7: Validação final do backend

**Files:**
- Modify: `backend/test/app.e2e-spec.ts`

**Ruling de pré-voo (registrado no ledger):** o guard global da Task 4 quebra `backend/test/app.e2e-spec.ts` — esse arquivo faz chamadas HTTP reais (`supertest`) contra `/clients`, `/receivables`, `/reports/financial-summary` etc. sem nenhum cabeçalho de autenticação, e passaria a receber `401` em tudo. Esse arquivo não roda automaticamente (precisa de um Postgres de teste dedicado, `npm run test:e2e`, fora do `npm test` normal — mesmo padrão já documentado no projeto), então nenhuma das tasks anteriores detectaria a quebra sozinha. Consertado aqui, explicitamente, em vez de deixado pra alguém descobrir depois.

- [ ] **Passo 1: Autenticar `app.e2e-spec.ts`**

No `beforeAll` já existente (depois de `await app.init()`), registrar uma empresa/admin de teste e guardar o token:
```ts
const registerRes = await request(app.getHttpServer())
  .post('/auth/register')
  .send({ companyName: 'E2E Test Co', email: 'e2e@test.com', password: 'senha-de-teste-12345' })
  .expect(201);
authHeader = `Bearer ${registerRes.body.accessToken}`;
```
(declarar `let authHeader: string;` junto de `let app: INestApplication;` no topo do `describe`).

Cada chamada existente no arquivo (`request(server).get(...)`, `.post(...)`, `.patch(...)`, `request(app.getHttpServer())...`) precisa de `.set('Authorization', authHeader)` encadeado antes do `.expect(...)`/`.send(...)`. Ex., a chamada existente:
```ts
const beforeRes = await request(server).get('/reports/financial-summary').expect(200);
```
vira:
```ts
const beforeRes = await request(server).get('/reports/financial-summary').set('Authorization', authHeader).expect(200);
```
Aplicar o mesmo padrão em toda chamada do arquivo — é uma mudança mecânica, idêntica em cada ponto, sem lógica de teste nenhuma mudando.

- [ ] **Passo 2: Confirmar que roda (se houver um Postgres de teste disponível localmente)**

```bash
cd backend
npm run test:e2e
```
Se não houver `quickflow_test` disponível no ambiente, documentar isso no relatório da task em vez de pular o Passo 1 — a mudança no arquivo é necessária de qualquer forma, mesmo que a verificação de execução real fique pendente.

- [ ] **Passo 3: Suíte completa**

```bash
cd backend
npm test
npm run build
npm run lint
```
Esperado: tudo passa, incluindo os testes já existentes de RH/Financeiro (nada deveria ter quebrado, já que `CompanyContextService` manteve a mesma interface pública).

- [ ] **Passo 4: Fumaça manual ponta-a-ponta via `curl`**

Com o backend rodando (`npm run start:dev`):
1. `POST /auth/register` com um e-mail/senha/companyName novos → confirma `201` com `accessToken` e um cookie `rt` na resposta.
2. `POST /auth/login` com essas credenciais → mesmo resultado.
3. Criar um `Employee` de teste (rota já existente) na empresa recém-criada.
4. `POST /companies/me/users` com `Authorization: Bearer <accessToken>`, `role: EMPLOYEE`, `employeeId` desse funcionário → `201`, devolve `temporaryPassword`.
5. Repetir o passo 4 pro mesmo `employeeId` → confirma erro de "já possui login".
6. `PATCH .../plan` pra `BASICO` (limite 10) e criar `Employee`s + logins até bater o limite → confirma `403` no 11º.
7. Logar com o login `EMPLOYEE` recém-criado (senha temporária) → funciona.
8. `PATCH /companies/me/users/:id/block` nesse login (como ADMIN) → confirma que uma nova tentativa de login com ele falha, e que uma sessão já aberta (chamar `/auth/refresh` com o cookie antigo dele) também falha.
9. `POST /auth/refresh` normal (cookie válido, nunca usado) → sucesso, novo `accessToken` e novo cookie.
10. Reusar o cookie **antigo** (de antes do passo 9) em `/auth/refresh` → confirma que falha E que uma tentativa de refresh com o cookie NOVO (emitido no passo 9) **também** passa a falhar (a família inteira foi revogada).

- [ ] **Passo 5: Commit**

---

### Task 8: Frontend — camada de sessão

**Files:**
- Create: `src/lib/auth.ts`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` (Task 3).
- Produces: `login(email, password): Promise<CurrentUser>`, `logout(): Promise<void>`, `getAccessToken(): string | null`, `getCurrentUser(): CurrentUser | null`, `restoreSession(): Promise<CurrentUser | null>`, tipo `CurrentUser = { id: string; email: string; role: 'admin' | 'employee'; modules: string[] }`.

- [ ] **Passo 1: `src/lib/auth.ts`**

```ts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'employee';
  modules: string[];
}

// Access token só em memória — nunca localStorage/sessionStorage, pra
// reduzir o que um ataque de XSS conseguiria roubar. Isso significa que
// recarregar a página perde o token e precisa de restoreSession().
let accessToken: string | null = null;
let currentUser: CurrentUser | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): CurrentUser | null {
  return currentUser;
}

function applySession(data: { accessToken: string; user: { id: string; email: string; role: string; modules: string[] } }) {
  accessToken = data.accessToken;
  currentUser = { id: data.user.id, email: data.user.email, role: data.user.role.toLowerCase() as 'admin' | 'employee', modules: data.user.modules };
  return currentUser;
}

export async function login(email: string, password: string): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    credentials: 'include', // necessário pro cookie httpOnly do refresh token ir/voltar
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || 'Não foi possível entrar');
  }
  return applySession(await res.json());
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  accessToken = null;
  currentUser = null;
}

// Chamado uma vez ao carregar o app (ex.: F5) — tenta renovar usando o
// cookie httpOnly, que sobrevive a um reload mesmo sem o token em memória,
// depois busca o perfil via GET /auth/me (POST /auth/refresh só devolve o
// accessToken, não quem é o usuário).
export async function restoreSession(): Promise<CurrentUser | null> {
  const refreshRes = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!refreshRes.ok) {
    accessToken = null;
    currentUser = null;
    return null;
  }
  accessToken = (await refreshRes.json()).accessToken;

  const meRes = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  if (!meRes.ok) {
    accessToken = null;
    currentUser = null;
    return null;
  }
  const user = await meRes.json();
  currentUser = { id: user.id, email: user.email, role: user.role.toLowerCase() as 'admin' | 'employee', modules: user.modules };
  return currentUser;
}

// Uma única tentativa de renovação silenciosa por chamada de API que falhe
// com 401 — evita loop infinito se o refresh também falhar.
export async function refreshOnce(): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    accessToken = null;
    currentUser = null;
    return false;
  }
  const data = await res.json();
  accessToken = data.accessToken;
  return true;
}
```

**Ressalva a resolver durante a implementação:** o backend (Task 3) não expõe uma rota "quem sou eu" que devolva o perfil a partir só do access token — `POST /auth/refresh` só devolve `{ accessToken }`. O implementador deve decidir entre (a) decodificar os claims do JWT no frontend (são públicos, não sensíveis — `sub`/`companyId`/`role`/`modules` já viajam abertos em qualquer JWT, só a assinatura importa pra confiar neles, e o frontend não precisa validar a assinatura, só ler o payload) usando uma função pequena de base64-decode da segunda parte do token, sem biblioteca nova; ou (b) adicionar uma rota `GET /auth/me` simples no `AuthController` (Task 3) que devolve o usuário a partir de `@CurrentUser()`. A opção (a) é mais simples e não exige tocar o backend de novo — preferida, a menos que se prove insuficiente.

- [ ] **Passo 2: Atualizar `src/lib/api.ts`'s `request()` pra anexar o token e renovar uma vez em 401**

```ts
import { getAccessToken, refreshOnce } from './auth';

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !isRetry) {
    const renewed = await refreshOnce();
    if (renewed) return request<T>(path, options, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || `Erro ${res.status} ao chamar ${path}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
```

- [ ] **Passo 3: `tsc`/`eslint` limpos, commit**

```bash
npx tsc --noEmit -p .
npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
git add src/lib/auth.ts src/lib/api.ts
git commit -m "feat(frontend): add in-memory session layer with silent token refresh"
```

---

### Task 9: Frontend — login real + rotas protegidas

**Files:**
- Modify: `src/pages/Login.tsx`
- Create: `src/components/RequireAuth.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `login`/`restoreSession`/`getCurrentUser` (Task 8).

- [ ] **Passo 1: `Login.tsx` real**

Trocar `handleLogin` (hoje só `navigate('/app')`) por controlado + chamando `login()`:
```tsx
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [error, setError] = useState<string | null>(null);
const [isSubmitting, setIsSubmitting] = useState(false);

const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  setIsSubmitting(true);
  try {
    await login(email, password);
    navigate('/app');
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
  } finally {
    setIsSubmitting(false);
  }
};
```
Ligar `value`/`onChange` nos dois `<input>` existentes, mostrar `error` num banner acima do formulário (mesmo padrão visual já usado em `Roles.tsx`/`EmployeesList.tsx`), desabilitar o botão com `isSubmitting`.

- [ ] **Passo 2: `RequireAuth.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getCurrentUser, restoreSession } from '../lib/auth';

const RequireAuth = () => {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(!!getCurrentUser());

  useEffect(() => {
    if (getCurrentUser()) {
      setChecked(true);
      return;
    }
    restoreSession().then((user) => {
      setAuthenticated(!!user);
      setChecked(true);
    });
  }, []);

  if (!checked) return null; // ou um spinner de tela cheia
  return authenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

export default RequireAuth;
```

- [ ] **Passo 3: Envolver as rotas `/app/*` em `App.tsx`**

Localizar onde `AppLayout` é montado nas rotas e envolver com `<Route element={<RequireAuth />}>` por fora, mantendo `AppLayout` como está.

- [ ] **Passo 4: `tsc`/`eslint` limpos + verificação manual real no navegador**

1. Sem sessão, acessar `/app/funcionarios` direto pela URL → confirma redirecionamento pra `/login`.
2. Logar com um usuário criado via `/auth/register` (Task 7, passo 2) → confirma redirecionamento pra `/app` e acesso normal.
3. Recarregar a página (F5) dentro de `/app` → confirma que continua logado (sessão restaurada via cookie), não volta pro login.

- [ ] **Passo 5: Commit**

```bash
git add src/pages/Login.tsx src/components/RequireAuth.tsx src/App.tsx
git commit -m "feat(frontend): wire real login and protect /app routes"
```

---

### Task 10: Frontend — navegação restrita por módulo + logout

**Files:**
- Modify: `src/layouts/AppLayout.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (Task 8), `logout` (Task 8).

- [ ] **Passo 1: Mapear cada item de navegação existente pro módulo correspondente**

Ex.: "Clientes" → `CLIENTES`, os itens de RH (Funcionários/Cargos/Controle de Ponto) → `RH`, "Orçamentos" → `COMERCIAL`, "Estoque"/"Compras" → `OPERACOES`, "Finanças" → `FINANCAS`, "Visão Geral"/"Analytics" → `DASHBOARD`. Filtrar a lista de itens renderizados pelos `modules` do usuário atual (`getCurrentUser()?.modules`, em maiúsculo pra bater com o enum do backend).

- [ ] **Passo 2: Ligar o logout**

No local onde já existe `UserProfileDropdown`/`UserProfileDrawer` (ver ação de sair já mockada, se existir), chamar `logout()` do Task 8 e `navigate('/login')` depois.

- [ ] **Passo 3: Verificação manual**

Logar com um `EMPLOYEE` cujo login foi criado com só `['RH']` em `modules` → confirma que só o item de RH aparece na barra lateral, o resto (Clientes, Finanças, etc.) não aparece. Clicar "Sair" → confirma volta pro `/login` e uma nova tentativa de acessar `/app` direto falha.

- [ ] **Passo 4: `tsc`/`eslint` limpos, commit**

```bash
npx tsc --noEmit -p . && npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
git add src/layouts/AppLayout.tsx
git commit -m "feat(frontend): gate sidebar navigation by the current user's modules"
```

---

### Task 11: Frontend — `UsersManagement.tsx` real

**Files:**
- Modify: `src/lib/api.ts` (adicionar funções de `companies/me/users`)
- Modify: `src/pages/app/UsersManagement.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH /companies/me/users` (Tasks 3/5), `listActiveRoles`/`listEmployees` (já existentes, pra popular o seletor de funcionário).

- [ ] **Passo 1: Funções novas em `src/lib/api.ts`**

Mirror do padrão já usado no arquivo inteiro (`Api*` → `map*` → tipo de UI → função assíncrona):
```ts
export interface SystemUser {
  id: string; email: string; role: 'admin' | 'employee';
  employeeId: string | null; modules: string[]; status: 'active' | 'blocked';
}

export async function listSystemUsers(): Promise<SystemUser[]> { /* GET /companies/me/users, mapeando role/status pra minúsculo */ }
export async function createSystemUser(dto: {
  email: string; role: 'admin' | 'employee'; employeeId?: string; modules: string[];
}): Promise<{ user: SystemUser; temporaryPassword: string }> { /* POST /companies/me/users */ }
export async function blockSystemUser(id: string): Promise<void> { /* PATCH .../block */ }
export async function unblockSystemUser(id: string): Promise<void> { /* PATCH .../unblock */ }
```

- [ ] **Passo 2: Reescrever `UsersManagement.tsx`**

Remover `mockUsers`/`AVAILABLE_ROLES` fixo. Carregar via `listSystemUsers()` + `listActiveRoles()`/`listEmployees()` (já existentes em `api.ts`) pra popular:
- Um seletor de `role` (`admin`/`employee`).
- Quando `role=employee`: um seletor de `Employee` (só os que **ainda não têm** `user.employeeId` — cruzar a lista de `listEmployees()` com os `employeeId` já presentes em `listSystemUsers()`).
- Checkboxes de módulo (reaproveitar `AVAILABLE_MODULES` já existente no arquivo, só trocar os ids pra bater com o enum: `dashboard`→`DASHBOARD`, etc., ou ajustar os ids do array pra já vir em maiúsculo).
- Ao criar: mostrar a `temporaryPassword` devolvida **uma única vez**, num banner que não desaparece sozinho (o admin precisa copiar/anotar antes de fechar).
- Bloquear/desbloquear via os botões já existentes na tela, agora chamando `blockSystemUser`/`unblockSystemUser`.

- [ ] **Passo 3: Verificação manual real no navegador**

1. Como ADMIN, criar um login `EMPLOYEE` pra um funcionário existente, com só o módulo RH — confirma que a senha temporária aparece uma vez.
2. Deslogar, logar com esse novo usuário e essa senha — confirma acesso restrito (Task 10).
3. Tentar criar outro login pro mesmo funcionário — confirma erro "já possui login".
4. Bloquear o login recém-criado — confirma que uma nova tentativa de login dele falha.

- [ ] **Passo 4: `tsc`/`eslint` limpos, commit**

```bash
npx tsc --noEmit -p . && npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
git add src/lib/api.ts src/pages/app/UsersManagement.tsx
git commit -m "feat(frontend): connect UsersManagement to real login administration"
```

---

### Task 12: Validação final + documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify: `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`
- Create/Modify: notas do vault relevantes (`UsersManagement.md`, `Login.md` se existirem convenções prévias — checar antes)

- [ ] **Passo 1: Build/lint/test completos, os dois lados**

```bash
cd backend && npm run build && npm run lint && npm test
cd .. && npm run build && npm run lint
```

- [ ] **Passo 2: Percurso manual ponta-a-ponta completo**

Registrar uma empresa nova pela tela (`/login` não tem link de registro ainda — usar a API diretamente ou, se o tempo permitir, adicionar um link simples "Criar conta" no `Login.tsx` apontando pra um formulário mínimo de registro; decisão do implementador, documentar o que foi feito), criar 2-3 funcionários, dar login pra alguns, testar o limite de plano, bloquear um, confirmar isolamento (dois logins de duas empresas diferentes nunca veem dados um do outro).

- [ ] **Passo 3: Atualizar `CLAUDE.md`**

Substituir a menção a "Autenticação/multi-tenant real não está implementada em lugar nenhum do projeto" (seção de RH) por uma descrição do que existe agora: `AuthModule`/`UsersModule`, `CompanyContextService` lendo do token, limite de plano, e a pendência explícita de `POST /auth/register` não ter cobrança real atrás (documentar isso com destaque, no mesmo estilo das outras pendências já registradas).

- [ ] **Passo 4: Atualizar `DECISOES-TECNICAS.md`**

Nova seção (10, seguindo a numeração já usada) documentando as decisões desta etapa: token de acesso curto + refresh rotativo com detecção de reuso, `CompanyContextService` request-scoped, `employeeId` único por login, limite de plano por `EMPLOYEE` only, `/auth/register` sem gate de pagamento (pendência), sem recuperação de senha por e-mail/MFA (pendências).

- [ ] **Passo 5: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: document multi-tenant auth implementation"
```
