# Configuração de Ponto Escopada por Superior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company restrict specific `ADMIN` logins to "administer only who they command" within Controle de Ponto, and let every superior (full-access ADMIN, restricted ADMIN, or a plain `EMPLOYEE` manager) configure work schedules and punch rules at three levels — company default, own team, and individual employee — instead of every schedule requiring a one-by-one per-employee cadastro.

**Architecture:** One new field (`User.hasFullPontoAccess`) threaded through the JWT and into the single shared `TimeManagementAuthService.canManage()`/`getManageableEmployeeIds()` functions every Ponto admin screen already calls — no per-screen special-casing. `WorkSchedule` and `TimeTrackingSettings` each gain an optional `managerId` column turning them into layered configuration (company → team → individual for schedules; company → team for settings), resolved via two new fallback-lookup methods consumed by the existing punch/apuração flow.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend, `backend/`), React + TypeScript (frontend, `src/`) — same stack as the rest of the Controle de Ponto module, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-time-tracking-scoped-config-design.md`

## Global Constraints

- `Employee.managerId` (direct, no chain propagation) remains the only source of "quem é superior de quem" — never walk more than one level up.
- Every authorization denial in this module returns `404` (`NotFoundException`), never `403` — matches the entire existing Controle de Ponto/RH convention.
- `employeeId`/`companyId` are never trusted from a request body — always resolved server-side from `@CurrentUser()`/the authenticated context, same as every other route in this backend.
- Multi-step writes that need atomicity use `runTenantInteractiveTransaction`/`runTenantTransaction` (never a raw `prisma.$transaction`) — required for the RLS tenant-context extension to apply correctly inside the transaction.
- No `git push` unless the user explicitly asks — this session's own established local-only convention.
- Never add `Co-Authored-By: Claude`/`Claude-Session` trailers to any commit — the user's explicit standing instruction this session.

---

### Task 1: Schema migration — `User.hasFullPontoAccess`, `WorkSchedule` 3-tier, `TimeTrackingSettings` 2-tier

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_scoped_ponto_config/migration.sql`

**Interfaces:**
- Produces: `User.hasFullPontoAccess: boolean` (Prisma Client field), `WorkSchedule.employeeId: string | null`, `WorkSchedule.managerId: string | null`, `TimeTrackingSettings.managerId: string | null` — consumed by every later task in this plan.

- [ ] **Step 1: Edit `schema.prisma`**

Add to `model User` (find the existing field list — insert near the other booleans like `mustChangePassword`):

```prisma
model User {
  // ... existing fields unchanged ...
  hasFullPontoAccess Boolean @default(true)
}
```

Change `model WorkSchedule` — `employeeId` becomes optional, `managerId` is new, add the second `Employee` relation (needs an explicit relation name since `Employee` already has one relation to `WorkSchedule` via `employeeId`):

```prisma
model WorkSchedule {
  id                       String    @id @default(cuid())
  companyId                String
  company                  Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  employeeId               String?
  employee                 Employee? @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  managerId                String?
  manager                  Employee? @relation("WorkScheduleManager", fields: [managerId], references: [id], onDelete: Cascade)
  name                     String
  weekDays                 Int[]
  expectedStartTime        String
  expectedEndTime          String
  breakMinutes             Int       @default(0)
  dailyMinutes             Int
  weeklyMinutes            Int
  toleranceMinutes         Int       @default(0)
  allowOvertime            Boolean   @default(false)
  maxOvertimeMinutesPerDay Int?
  nightShift               Boolean   @default(false)
  validFrom                DateTime  @db.Date
  validTo                  DateTime? @db.Date
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt

  @@index([companyId])
  @@index([employeeId])
  @@index([employeeId, validFrom])
  @@index([managerId])
}
```

In `model Employee`, find the existing back-relation to `WorkSchedule` (something like `workSchedules WorkSchedule[]`) and add the second one for the new named relation, right below it:

```prisma
  workSchedules        WorkSchedule[]
  workScheduleDefaults WorkSchedule[] @relation("WorkScheduleManager")
```

Change `model TimeTrackingSettings` — drop the bare `@unique` on `companyId`, add `managerId`:

```prisma
model TimeTrackingSettings {
  id                     String   @id @default(cuid())
  companyId              String
  company                Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  managerId              String?
  manager                Employee? @relation(fields: [managerId], references: [id], onDelete: Cascade)
  requirePhoto           Boolean  @default(true)
  requireLocation        Boolean  @default(true)
  allowLocationException Boolean  @default(false)
  allowExtraPeriods      Boolean  @default(true)
  maxAttachmentSizeBytes Int      @default(5242880)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@index([companyId])
  @@index([managerId])
}
```

`Employee` also needs a back-relation for this new `TimeTrackingSettings.manager` field — add next to the `WorkSchedule` relations added above:

```prisma
  timeTrackingSettingsOverrides TimeTrackingSettings[]
```

- [ ] **Step 2: Format and validate**

Run: `cd backend && npx prisma format && npx prisma validate`
Expected: `Prisma schema loaded from prisma\schema.prisma` / `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 3: Generate the migration SQL (shadow-DB fallback — `migrate dev` fails on this project's known pre-existing P3006 error)**

```bash
cd backend
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_scoped_ponto_config"
```

Note the folder name it prints, then:

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > "prisma/migrations/<folder-from-above>/migration.sql"
```

- [ ] **Step 4: Append the two partial unique indexes for `TimeTrackingSettings` by hand**

Prisma's diff won't emit these (partial/filtered unique indexes aren't expressible in `schema.prisma`'s declarative syntax) — append to the end of the generated `migration.sql`:

```sql
-- Partial unique indexes: a plain @@unique([companyId, managerId]) would not work here because
-- Postgres treats NULL as never equal to itself, so multiple managerId:NULL rows for the same
-- company would NOT violate it. These two indexes replace the old bare `companyId @unique`.
CREATE UNIQUE INDEX "TimeTrackingSettings_company_default_key"
  ON "TimeTrackingSettings" ("companyId") WHERE "managerId" IS NULL;
CREATE UNIQUE INDEX "TimeTrackingSettings_manager_override_key"
  ON "TimeTrackingSettings" ("companyId", "managerId") WHERE "managerId" IS NOT NULL;
```

- [ ] **Step 5: Apply the migration**

Run: `npx prisma migrate deploy`
Expected: `All migrations have been successfully applied.`

- [ ] **Step 6: Regenerate the Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 7: Confirm nothing broke**

Run: `npm run build && npm test`
Expected: build clean; existing test count unchanged (no new tests yet — this task is schema-only), all passing. Some existing `TimeTrackingSettingsService`/`WorkSchedulesService` tests may now fail to *type-check* if they call `findUnique({ where: { companyId } })` — that's expected and fixed in Tasks 5/6 below, not here. If `npm test` reports type errors from those two files specifically, that is the expected, temporary state; every other suite must still be green.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(backend): add hasFullPontoAccess and layered WorkSchedule/TimeTrackingSettings schema"
```

---

### Task 2: Thread `hasFullPontoAccess` through the JWT and `AuthenticatedUser`

**Files:**
- Modify: `backend/src/auth/decorators/current-user.decorator.ts`
- Modify: `backend/src/auth/strategies/jwt.strategy.ts`
- Modify: `backend/src/auth/auth.service.ts`
- Test: `backend/src/auth/auth.service.spec.ts` (find the existing file — if it does not exist, check `backend/src/auth/` for the actual test file name before writing new tests; add cases to whichever file already covers `signAccessToken`/`login`/`register`/`getProfile`)

**Interfaces:**
- Consumes: `User.hasFullPontoAccess` (Task 1).
- Produces: `AuthenticatedUser.hasFullPontoAccess: boolean` — every later backend task in this plan reads this off `@CurrentUser()`.

- [ ] **Step 1: Add the field to `AuthenticatedUser`**

In `backend/src/auth/decorators/current-user.decorator.ts`:

```ts
export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
  mustChangePassword: boolean;
  hasFullPontoAccess: boolean;
}
```

- [ ] **Step 2: Add it to the JWT payload and strategy**

In `backend/src/auth/strategies/jwt.strategy.ts`:

```ts
export interface JwtPayload {
  sub: string;
  companyId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
  mustChangePassword: boolean;
  hasFullPontoAccess: boolean;
}
```

And in `validate()`:

```ts
  validate(payload: JwtPayload) {
    return {
      userId: payload.sub,
      companyId: payload.companyId,
      role: payload.role,
      modules: payload.modules,
      mustChangePassword: payload.mustChangePassword,
      hasFullPontoAccess: payload.hasFullPontoAccess,
    };
  }
```

- [ ] **Step 3: Sign it into the access token**

In `backend/src/auth/auth.service.ts`, `signAccessToken`'s param type and payload both need the field:

```ts
  private signAccessToken(user: {
    id: string;
    companyId: string;
    role: string;
    modules: string[];
    mustChangePassword: boolean;
    hasFullPontoAccess: boolean;
  }) {
    return this.jwt.sign(
      {
        sub: user.id,
        companyId: user.companyId,
        role: user.role,
        modules: user.modules,
        mustChangePassword: user.mustChangePassword,
        hasFullPontoAccess: user.hasFullPontoAccess,
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m', algorithm: 'HS256' },
    );
  }
```

Every existing call site (`register()`, `login()`, `refresh()`, `changePassword()`) already passes the full Prisma `User` row (or a spread of it) into `signAccessToken` — since `hasFullPontoAccess` is now a real column with a schema default of `true`, those rows already carry it with no call-site changes needed. Same staleness tradeoff already accepted for `role`/`modules` in this codebase (up to 15min, or until next `/auth/refresh`, before a revoked flag takes effect) — not a new risk class.

- [ ] **Step 4: Return it from `getProfile()`, `register()`, and `login()`'s user payloads**

`getProfile()`:

```ts
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      modules: user.modules,
      mustChangePassword: user.mustChangePassword,
      employeeId: user.employeeId,
      hasFullPontoAccess: user.hasFullPontoAccess,
    };
  }
```

`register()` and `login()` — both have an identical inline `user: { id: ..., email: ..., role: ..., modules: ..., mustChangePassword: ..., employeeId: ... }` object in their return statement; add `hasFullPontoAccess: user.hasFullPontoAccess` to both.

- [ ] **Step 5: Write/extend tests**

Find the existing spec covering `AuthService` (search `backend/src -iname "auth.service.spec.ts"` or similar under `backend/src/auth/`). Add:

```ts
  it('signs hasFullPontoAccess into the access token payload', async () => {
    // Use this suite's existing pattern for calling login()/register() and decoding the returned
    // accessToken (jwt.decode or the mocked JwtService, matching however this file already
    // verifies token contents) — assert the decoded payload has `hasFullPontoAccess: true` for a
    // freshly-registered/logged-in user (schema default).
  });
```

Write this test using whatever JWT-verification pattern the existing suite already uses for asserting `role`/`modules` end up in the signed token — do not invent a new one.

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test -- --testPathPattern=auth`
Expected: all passing, including the new case.

- [ ] **Step 7: Full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth/
git commit -m "feat(backend): thread hasFullPontoAccess through the JWT and AuthenticatedUser"
```

---

### Task 3: `TimeManagementAuthService` — gate the `ADMIN` bypass, add `assertHasFullPontoAccess`

**Files:**
- Modify: `backend/src/time-management/time-management-auth.service.ts`
- Test: `backend/src/time-management/time-management-auth.service.spec.ts`

**Interfaces:**
- Consumes: `AuthenticatedUser.hasFullPontoAccess` (Task 2).
- Produces: `TimeManagementAuthService.assertHasFullPontoAccess(user: AuthenticatedUser): void` — consumed by Tasks 4, 5, 6, 7.

- [ ] **Step 1: Write the failing tests**

Add to `time-management-auth.service.spec.ts`, inside the existing `describe('canManage', ...)` block:

```ts
    it('ADMIN with hasFullPontoAccess: false behaves exactly like an EMPLOYEE manager (no automatic bypass)', async () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: 'employee-manager-1' });

      const result = await service.canManage(limitedAdmin, 'target-1');

      expect(result).toBe(true); // direct manager, so still true — but via the manager path, not the bypass
      expect(prisma.user.findUnique).toHaveBeenCalled(); // proves it did NOT take the early-return bypass branch
    });

    it('ADMIN with hasFullPontoAccess: false cannot manage someone who is not their own direct report', async () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: 'someone-else' });

      const result = await service.canManage(limitedAdmin, 'target-1');

      expect(result).toBe(false);
    });
```

And inside `describe('getManageableEmployeeIds', ...)`:

```ts
    it("returns direct reports, not 'ALL', for ADMIN with hasFullPontoAccess: false", async () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: 'employee-manager-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'report-1' }]);

      const result = await service.getManageableEmployeeIds(limitedAdmin);

      expect(result).toEqual(['report-1']);
    });
```

Add a new top-level `describe` block for the new method, right after `describe('listManageableEmployees', ...)`:

```ts
  describe('assertHasFullPontoAccess', () => {
    it('does not throw for ADMIN with hasFullPontoAccess: true', () => {
      expect(() => service.assertHasFullPontoAccess(admin)).not.toThrow();
    });

    it('throws NotFoundException for ADMIN with hasFullPontoAccess: false', () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      expect(() => service.assertHasFullPontoAccess(limitedAdmin)).toThrow(NotFoundException);
    });

    it('throws NotFoundException for any EMPLOYEE login, regardless of hasFullPontoAccess', () => {
      expect(() => service.assertHasFullPontoAccess(employeeLogin)).toThrow(NotFoundException);
    });
  });
```

Also update the two existing `admin`/`employeeLogin` fixture objects at the top of the file to include `hasFullPontoAccess: true` (both should default to `true` so every pre-existing test keeps passing unchanged):

```ts
  const admin: AuthenticatedUser = {
    userId: 'user-admin', companyId: 'company-1', role: 'ADMIN', modules: [], mustChangePassword: false, hasFullPontoAccess: true,
  };
  const employeeLogin: AuthenticatedUser = {
    userId: 'user-employee', companyId: 'company-1', role: 'EMPLOYEE', modules: [], mustChangePassword: false, hasFullPontoAccess: true,
  };
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && npm test -- --testPathPattern=time-management-auth`
Expected: FAIL — `assertHasFullPontoAccess is not a function`, and the two new `canManage`/`getManageableEmployeeIds` cases return `true`/`'ALL'` instead of the expected scoped result (current bypass ignores the flag).

- [ ] **Step 3: Implement**

In `time-management-auth.service.ts`, change the two bypass lines:

```ts
  async canManage(currentUser: AuthenticatedUser, targetEmployeeId: string): Promise<boolean> {
    const target = await this.prisma.employee.findFirst({
      where: { id: targetEmployeeId, companyId: currentUser.companyId },
    });
    if (!target) return false;

    if (currentUser.role === 'ADMIN' && currentUser.hasFullPontoAccess) return true;

    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!currentUserRecord?.employeeId) return false;

    return target.managerId === currentUserRecord.employeeId;
  }
```

```ts
  async getManageableEmployeeIds(currentUser: AuthenticatedUser): Promise<string[] | 'ALL'> {
    if (currentUser.role === 'ADMIN' && currentUser.hasFullPontoAccess) return 'ALL';

    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!currentUserRecord?.employeeId) return [];

    const reports = await this.prisma.employee.findMany({
      where: { managerId: currentUserRecord.employeeId, companyId: currentUser.companyId },
      select: { id: true },
    });
    return reports.map((r) => r.id);
  }
```

Add the new method at the end of the class, right after `listManageableEmployees`:

```ts
  // Ações sem "um funcionário-alvo" pra checar via canManage() — editar o padrão da empresa de
  // TimeTrackingSettings/WorkSchedule, mutar WorkLocation, e o endpoint de ligar/desligar
  // hasFullPontoAccess de outro login. Síncrono de propósito (sem consulta ao banco) — o dado já
  // está inteiro no AuthenticatedUser vindo do JWT.
  assertHasFullPontoAccess(user: AuthenticatedUser): void {
    if (user.role !== 'ADMIN' || !user.hasFullPontoAccess) {
      throw new NotFoundException('Recurso não encontrado');
    }
  }
```

Add `NotFoundException` to the existing `@nestjs/common` import at the top of the file if not already imported (it already is — `canManage`'s sibling `assertCanManage` uses it).

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=time-management-auth`
Expected: PASS, all cases including the new ones.

- [ ] **Step 5: Full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/time-management/
git commit -m "feat(backend): gate the ADMIN bypass on hasFullPontoAccess, add assertHasFullPontoAccess"
```

---

### Task 4: `PATCH /companies/me/users/:id/ponto-access` — toggle endpoint

**Files:**
- Create: `backend/src/users/dto/update-ponto-access.dto.ts`
- Modify: `backend/src/users/users.service.ts`
- Modify: `backend/src/users/users.controller.ts`
- Modify: `backend/src/users/users.module.ts` (needs `TimeManagementAuthModule` imported for the new controller/service dependency)
- Test: `backend/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `TimeManagementAuthService.assertHasFullPontoAccess` (Task 3).
- Produces: `UsersService.updatePontoAccess(companyId: string, targetUserId: string, hasFullPontoAccess: boolean): Promise<void>` — no other task in this plan consumes this directly (frontend calls the HTTP route).

- [ ] **Step 1: Create the DTO**

```ts
// backend/src/users/dto/update-ponto-access.dto.ts
import { IsBoolean } from 'class-validator';

export class UpdatePontoAccessDto {
  @IsBoolean() hasFullPontoAccess!: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `users.service.spec.ts` (check its existing `beforeEach`/mock shape first and match it — it almost certainly already mocks `prisma.user`):

```ts
  describe('updatePontoAccess', () => {
    it('turns hasFullPontoAccess on for a target ADMIN login in the same company', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'ADMIN', hasFullPontoAccess: false });
      prisma.user.count.mockResolvedValue(2); // irrelevant when turning ON, only checked when turning OFF
      prisma.user.update.mockResolvedValue({ id: 'target-1' });

      await service.updatePontoAccess('company-1', 'target-1', true);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target-1' }, data: { hasFullPontoAccess: true } });
    });

    it('rejects turning it off when the target is the last ADMIN with hasFullPontoAccess: true in the company', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'ADMIN', hasFullPontoAccess: true });
      prisma.user.count.mockResolvedValue(1); // only this one left

      await expect(service.updatePontoAccess('company-1', 'target-1', false)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows turning it off when at least one other full-access ADMIN remains', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'ADMIN', hasFullPontoAccess: true });
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue({ id: 'target-1' });

      await service.updatePontoAccess('company-1', 'target-1', false);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target-1' }, data: { hasFullPontoAccess: false } });
    });

    it('throws NotFoundException when the target does not exist in this company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.updatePontoAccess('company-1', 'target-1', true)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when the target is not an ADMIN login', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'EMPLOYEE', hasFullPontoAccess: true });
      await expect(service.updatePontoAccess('company-1', 'target-1', false)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
```

Add `count: jest.fn()` to the mocked `prisma.user` object in this file's `beforeEach` if not already present.

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npm test -- --testPathPattern=users.service`
Expected: FAIL — `updatePontoAccess is not a function`.

- [ ] **Step 4: Implement**

Add to `users.service.ts` (needs `BadRequestException` already imported — it is):

```ts
  // Achado + corrigido na revisão de escopo de 15/09/2026: um login ADMIN de uma empresa pequena/
  // média muitas vezes é só um gerente de confiança, não o dono — este campo deixa a empresa
  // restringir logins ADMIN específicos a "administrar só quem eu comando" dentro do Controle de
  // Ponto (ver TimeManagementAuthService.assertHasFullPontoAccess/canManage). Trava contra deixar a
  // empresa sem NENHUM admin de acesso total, o que só seria recuperável por edição direta no banco.
  async updatePontoAccess(companyId: string, targetUserId: string, hasFullPontoAccess: boolean): Promise<void> {
    const target = await this.prisma.user.findFirst({ where: { id: targetUserId, companyId } });
    if (!target) throw new NotFoundException(`Login ${targetUserId} não encontrado nesta empresa`);
    if (target.role !== 'ADMIN') {
      throw new BadRequestException('hasFullPontoAccess só tem efeito em logins ADMIN');
    }
    if (!hasFullPontoAccess) {
      const fullAccessCount = await this.prisma.user.count({
        where: { companyId, role: 'ADMIN', hasFullPontoAccess: true },
      });
      if (fullAccessCount <= 1) {
        throw new BadRequestException(
          'A empresa precisa manter pelo menos um login ADMIN com acesso total ao Controle de Ponto',
        );
      }
    }
    await this.prisma.user.update({ where: { id: targetUserId }, data: { hasFullPontoAccess } });
  }
```

Add `hasFullPontoAccess: true` to `SAFE_USER_SELECT` so `GET /companies/me/users` returns it:

```ts
const SAFE_USER_SELECT = {
  id: true,
  companyId: true,
  email: true,
  role: true,
  employeeId: true,
  modules: true,
  status: true,
  mustChangePassword: true,
  hasFullPontoAccess: true,
  createdAt: true,
  updatedAt: true,
} as const;
```

- [ ] **Step 5: Wire the controller**

In `users.controller.ts`, add the import and route (this controller already injects nothing besides `UsersService` — add `TimeManagementAuthService` too):

```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdatePontoAccessDto } from './dto/update-ponto-access.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('companies/me/users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  // ... existing findAll/create/block/unblock unchanged ...

  @Patch(':id/ponto-access')
  @HttpCode(204)
  updatePontoAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePontoAccessDto,
  ) {
    this.timeManagementAuth.assertHasFullPontoAccess(user);
    return this.users.updatePontoAccess(user.companyId, id, dto.hasFullPontoAccess);
  }
}
```

No `@Roles('ADMIN')` needed on this new route — `assertHasFullPontoAccess` already implies `role === 'ADMIN'` and is a stricter check.

- [ ] **Step 6: Wire the module**

In `users.module.ts`, add `TimeManagementAuthModule` to `imports` (check the file first — it likely only imports `PrismaModule` or nothing beyond the global one).

- [ ] **Step 7: Run tests**

Run: `npm test -- --testPathPattern=users`
Expected: PASS.

- [ ] **Step 8: Full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 9: Live verification**

With both dev servers running (`npm run start:dev` in `backend/`, `npm run dev` at the repo root):

```bash
# Register a fresh company, create a second ADMIN login, try turning off the last full-access
# admin (should 400), then turn off the second one instead (should 204).
```

Confirm via real HTTP calls (curl, with a real Bearer token from `/auth/login`) that:
- Turning off the ONLY full-access admin returns `400`.
- Creating a second ADMIN login (via `POST /companies/me/users`) then turning off either one succeeds with `204`, and `GET /companies/me/users` reflects the new value.

- [ ] **Step 10: Commit**

```bash
git add backend/src/users/
git commit -m "feat(backend): add PATCH /companies/me/users/:id/ponto-access"
```

---

### Task 5: `WorkSchedule` backend — three-tier create/list/authorization

**Files:**
- Modify: `backend/src/work-schedules/dto/create-work-schedule.dto.ts`
- Modify: `backend/src/work-schedules/dto/update-work-schedule.dto.ts`
- Modify: `backend/src/work-schedules/dto/query-work-schedules.dto.ts`
- Modify: `backend/src/work-schedules/work-schedules.service.ts`
- Modify: `backend/src/work-schedules/work-schedules.controller.ts`
- Test: `backend/src/work-schedules/work-schedules.service.spec.ts`

**Interfaces:**
- Consumes: `TimeManagementAuthService.assertHasFullPontoAccess`/`assertCanManage`/`resolveOwnEmployee` (Task 3, Task 4 of the original Time Tracking plan).
- Produces: `WorkSchedulesService.create(dto, currentUser)`'s new signature (adds `currentUser` — was `create(dto)` before) — Task 8 (frontend) calls the resulting `createWorkSchedule` API shape.

- [ ] **Step 1: DTOs — `employeeId` optional, add `managerId`**

`create-work-schedule.dto.ts` — change `employeeId` to optional, add `managerId`:

```ts
export class CreateWorkScheduleDto {
  @IsOptional() @IsString() @MinLength(1) employeeId?: string;
  @IsOptional() @IsString() @MinLength(1) managerId?: string;
  @IsString() @MinLength(1) name!: string;
  // ... weekDays/expectedStartTime/.../validTo unchanged ...
}
```

`update-work-schedule.dto.ts` — `managerId` is already implicitly coverable since `employeeId` is `@IsOptional()` there already; just add:

```ts
  @IsOptional() @IsString() @MinLength(1) managerId?: string;
```

`query-work-schedules.dto.ts` — add a filter for team-default rows:

```ts
export class QueryWorkSchedulesDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `work-schedules.service.spec.ts` (check its existing mock/fixture shape first and match it):

```ts
  describe('create — three tiers', () => {
    it('creates a company-wide default row when neither employeeId nor managerId is given', async () => {
      const dto = { name: 'Padrão', weekDays: [1, 2, 3, 4, 5], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      prisma.workSchedule.create.mockResolvedValue({ id: 'ws-1', employeeId: null, managerId: null });

      await service.create(dto, admin);

      expect(prisma.workSchedule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ employeeId: undefined, managerId: undefined }),
      });
    });

    it('rejects both employeeId and managerId given together', async () => {
      const dto = { employeeId: 'emp-1', managerId: 'mgr-1', name: 'X', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      await expect(service.create(dto, admin)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.workSchedule.create).not.toHaveBeenCalled();
    });
  });
```

You will need real fixtures for `admin`/`employeeManagerLogin`/`limitedAdmin` (`AuthenticatedUser` shape, matching Task 3's fixtures) — add them near the top of the file if this spec doesn't already define comparable ones. Also add these authorization-specific cases:

```ts
  describe('create — authorization by tier', () => {
    it('rejects a company-wide default row from a manager without hasFullPontoAccess', async () => {
      const limitedAdmin = { userId: 'u1', companyId: 'company-1', role: 'ADMIN' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: false };
      const dto = { name: 'X', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      await expect(service.create(dto, limitedAdmin)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows a manager to create a team-default row for their OWN team (managerId matches their own linked employee)', async () => {
      const managerLogin = { userId: 'u2', companyId: 'company-1', role: 'EMPLOYEE' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: true };
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      const dto = { managerId: 'employee-mgr-1', name: 'Meu time', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      prisma.workSchedule.create.mockResolvedValue({ id: 'ws-2' });

      await service.create(dto, managerLogin);

      expect(prisma.workSchedule.create).toHaveBeenCalled();
    });

    it('rejects a manager creating a team-default row for a DIFFERENT superior, without hasFullPontoAccess', async () => {
      const managerLogin = { userId: 'u2', companyId: 'company-1', role: 'EMPLOYEE' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: true };
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      const dto = { managerId: 'employee-someone-else', name: 'X', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };

      await expect(service.create(dto, managerLogin)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npm test -- --testPathPattern=work-schedules`
Expected: FAIL — `create` doesn't accept a second argument yet, and the XOR/authorization rules don't exist.

- [ ] **Step 4: Implement**

In `work-schedules.service.ts`, replace `assertEmployeeExists` usage in `create`/`update` with tier-aware logic. Full new `create`:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  // Ao menos um dos dois nunca preenchido ao mesmo tempo — as três combinações válidas: só
  // employeeId (individual), só managerId (padrão de time), nenhum dos dois (padrão da empresa).
  private async assertValidTierAndAuthorized(
    currentUser: AuthenticatedUser,
    companyId: string,
    employeeId: string | undefined,
    managerId: string | undefined,
  ) {
    if (employeeId && managerId) {
      throw new BadRequestException('Uma jornada não pode ter employeeId e managerId ao mesmo tempo');
    }
    if (!employeeId && !managerId) {
      // Padrão da empresa inteira.
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      return;
    }
    if (managerId) {
      const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
      if (currentUserRecord?.employeeId === managerId) return; // autoatendimento: configurando o próprio time
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      await this.assertEmployeeExists(managerId, companyId);
      return;
    }
    // employeeId (individual)
    await this.assertEmployeeExists(employeeId!, companyId);
    await this.timeManagementAuth.assertCanManage(currentUser, employeeId!);
  }

  async create(dto: CreateWorkScheduleDto, currentUser: AuthenticatedUser): Promise<WorkSchedule> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    await this.assertValidTierAndAuthorized(currentUser, companyId, dto.employeeId, dto.managerId);
    return this.prisma.workSchedule.create({
      data: {
        companyId,
        employeeId: dto.employeeId,
        managerId: dto.managerId,
        name: dto.name,
        weekDays: dto.weekDays,
        expectedStartTime: dto.expectedStartTime,
        expectedEndTime: dto.expectedEndTime,
        breakMinutes: dto.breakMinutes,
        dailyMinutes: dto.dailyMinutes,
        weeklyMinutes: dto.weeklyMinutes,
        toleranceMinutes: dto.toleranceMinutes,
        allowOvertime: dto.allowOvertime,
        maxOvertimeMinutesPerDay: dto.maxOvertimeMinutesPerDay,
        nightShift: dto.nightShift,
        validFrom: parseDateOnly(dto.validFrom),
        validTo: dto.validTo ? parseDateOnly(dto.validTo) : undefined,
      },
    });
  }
```

Update `update()` similarly — resolve the EXISTING row's tier if the DTO doesn't change `employeeId`/`managerId`, or the NEW tier if it does, then call the same `assertValidTierAndAuthorized`:

```ts
  async update(id: string, dto: UpdateWorkScheduleDto, currentUser: AuthenticatedUser): Promise<WorkSchedule> {
    const schedule = await this.assertExists(id);
    const nextEmployeeId = dto.employeeId !== undefined ? dto.employeeId : (schedule.employeeId ?? undefined);
    const nextManagerId = dto.managerId !== undefined ? dto.managerId : (schedule.managerId ?? undefined);
    await this.assertValidTierAndAuthorized(currentUser, schedule.companyId, nextEmployeeId, nextManagerId);
    return this.prisma.workSchedule.update({
      where: { id },
      data: {
        ...dto,
        validFrom: dto.validFrom ? parseDateOnly(dto.validFrom) : undefined,
        validTo: dto.validTo ? parseDateOnly(dto.validTo) : undefined,
      },
    });
  }
```

`remove()` also needs an authorization check now (today it has none beyond module-gating at the controller) — add the same tier check before deleting:

```ts
  async remove(id: string, currentUser: AuthenticatedUser): Promise<void> {
    const schedule = await this.assertExists(id);
    await this.assertValidTierAndAuthorized(currentUser, schedule.companyId, schedule.employeeId ?? undefined, schedule.managerId ?? undefined);
    await this.prisma.workSchedule.delete({ where: { id } });
  }
```

Add the necessary imports at the top: `AuthenticatedUser` from `../auth/decorators/current-user.decorator`, `TimeManagementAuthService` from `../time-management/time-management-auth.service`, `BadRequestException` alongside the existing `NotFoundException` import.

- [ ] **Step 5: Update the controller to pass `currentUser` through and drop the blanket `@Roles('ADMIN')`**

```ts
import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { QueryWorkSchedulesDto } from './dto/query-work-schedules.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { WorkSchedulesService } from './work-schedules.service';

// Mutação não é mais @Roles('ADMIN') puro — WorkSchedulesService.assertValidTierAndAuthorized
// decide por camada (empresa exige hasFullPontoAccess; time exige ser o próprio superior ou ter
// hasFullPontoAccess; individual exige assertCanManage). RolesGuard não é mais usado aqui.
@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller('work-schedules')
export class WorkSchedulesController {
  constructor(
    private readonly workSchedules: WorkSchedulesService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkScheduleDto) {
    return this.workSchedules.create(dto, user);
  }

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryWorkSchedulesDto) {
    if (query.employeeId) {
      await this.timeManagementAuth.assertCanManage(user, query.employeeId);
    } else if (query.managerId) {
      // Ver o padrão de time de um superior específico: qualquer um pode ver o PRÓPRIO; ver o de
      // outro exige acesso total — mesma regra de quem pode CRIAR um.
      const ownEmployee = await this.timeManagementAuth.resolveOwnEmployee(user).catch(() => null);
      if (ownEmployee?.id !== query.managerId) this.timeManagementAuth.assertHasFullPontoAccess(user);
    } else if (!user.hasFullPontoAccess) {
      throw new ForbiddenException('Apenas quem tem acesso total pode listar jornadas sem filtrar por funcionário/superior');
    }
    return this.workSchedules.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const schedule = await this.workSchedules.findOne(id);
    if (schedule.employeeId) {
      await this.timeManagementAuth.assertCanManage(user, schedule.employeeId);
    } else if (schedule.managerId) {
      const currentUserRecord = await this.timeManagementAuth.resolveOwnEmployee(user).catch(() => null);
      if (currentUserRecord?.id !== schedule.managerId) this.timeManagementAuth.assertHasFullPontoAccess(user);
    } else {
      this.timeManagementAuth.assertHasFullPontoAccess(user);
    }
    return schedule;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkScheduleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workSchedules.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workSchedules.remove(id, user);
  }
}
```

Remove the stray `const currentUserRecord = query.managerId;` placeholder line above before committing — it was left to mark the branch; replace that whole `else if (query.managerId)` block body with:

```ts
    } else if (query.managerId) {
      const ownEmployee = await this.timeManagementAuth.resolveOwnEmployee(user).catch(() => null);
      if (ownEmployee?.id !== query.managerId) this.timeManagementAuth.assertHasFullPontoAccess(user);
    }
```

- [ ] **Step 5b: Remove the now-unused `RolesGuard`/`Roles` imports and class-level guard reference**

Confirm the rewritten controller (Step 5) no longer imports `Roles` from `../auth/decorators/roles.decorator` or `RolesGuard` from `../auth/guards/roles.guard`, and that `@UseGuards` only lists `ModulesGuard` — both are fully replaced by the imperative `assertCanManage`/`assertHasFullPontoAccess` calls above.

- [ ] **Step 6: Update `findAll`'s `where` clause in the service to support `managerId`**

```ts
  async findAll(query: QueryWorkSchedulesDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.managerId ? { managerId: query.managerId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    // ... rest unchanged ...
  }
```

- [ ] **Step 7: Run tests**

Run: `npm test -- --testPathPattern=work-schedules`
Expected: PASS.

- [ ] **Step 8: Full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all clean. `WorkSchedulesController.findAll`/`findOne` will show a `no-unused-vars` or unreachable-branch lint issue if the placeholder line wasn't fully removed — double check.

- [ ] **Step 9: Commit**

```bash
git add backend/src/work-schedules/
git commit -m "feat(backend): three-tier WorkSchedule (company/team/individual) with per-tier authorization"
```

---

### Task 6: `TimeTrackingSettings` backend — company/team tiers + `getEffectiveSettingsForEmployee`

**Files:**
- Modify: `backend/src/time-tracking-settings/dto/update-time-tracking-settings.dto.ts`
- Create: `backend/src/time-tracking-settings/dto/query-time-tracking-settings.dto.ts`
- Modify: `backend/src/time-tracking-settings/time-tracking-settings.service.ts`
- Modify: `backend/src/time-tracking-settings/time-tracking-settings.controller.ts`
- Test: `backend/src/time-tracking-settings/time-tracking-settings.service.spec.ts`

**Interfaces:**
- Consumes: `TimeManagementAuthService.assertHasFullPontoAccess`/`resolveOwnEmployee` (Task 3, existing).
- Produces: `TimeTrackingSettingsService.getEffectiveSettingsForEmployee(employeeId, companyId): Promise<TimeTrackingSettings>` — consumed by Task 8.

- [ ] **Step 1: New query DTO for reading a specific tier**

```ts
// backend/src/time-tracking-settings/dto/query-time-tracking-settings.dto.ts
import { IsOptional, IsString } from 'class-validator';

export class QueryTimeTrackingSettingsDto {
  @IsOptional() @IsString() managerId?: string;
}
```

`update-time-tracking-settings.dto.ts` gains the same optional field:

```ts
  @IsOptional() @IsString() managerId?: string;
```

- [ ] **Step 2: Write the failing tests**

Rewrite `time-tracking-settings.service.spec.ts`'s existing `getOrCreateDefault`/`update`/`getCurrent` tests to use `findFirst` instead of `findUnique` (the mocked `prisma.timeTrackingSettings` object needs `findFirst` added, since `companyId` alone is no longer a Prisma-recognized unique key after Task 1 — see the note in Step 3 below). Update the mock in `beforeEach`:

```ts
    prisma = {
      timeTrackingSettings: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
```

Update every existing test in this file that calls `prisma.timeTrackingSettings.findUnique` to call `findFirst` instead, with the same mock return values — e.g.:

```ts
    it('returns the existing row when the company already has one', async () => {
      const existing = { id: 'settings-1', companyId: 'company-1', managerId: null, requirePhoto: true };
      prisma.timeTrackingSettings.findFirst.mockResolvedValue(existing);

      const result = await service.getOrCreateDefault('company-1');

      expect(result).toBe(existing);
      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
      expect(prisma.timeTrackingSettings.findFirst).toHaveBeenCalledWith({ where: { companyId: 'company-1', managerId: null } });
    });
```

Apply the same `findUnique` → `findFirst` + `managerId: null` change to the other two existing tests in `describe('getOrCreateDefault', ...)` and both in `describe('update', ...)`. For `update()`'s two tests, its `prisma.timeTrackingSettings.update` call also needs to change from `{ where: { companyId } }` to `{ where: { id: <resolved-id> } }` — see Step 4 below for why, and adjust the mock expectations accordingly:

```ts
    it('creates the default row first, then applies the partial update, for a brand-new company', async () => {
      prisma.timeTrackingSettings.findFirst.mockResolvedValue(null);
      prisma.timeTrackingSettings.create.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', managerId: null });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', requirePhoto: false });

      await service.update({ requirePhoto: false }, admin);

      expect(prisma.timeTrackingSettings.create).toHaveBeenCalledWith({ data: { companyId: 'company-1', managerId: undefined } });
      expect(prisma.timeTrackingSettings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { requirePhoto: false },
      });
    });
```

Add the `admin`/`managerLogin` `AuthenticatedUser` fixtures near the top of the file (same shape as Task 3/5) since `update()`'s new signature takes `currentUser`. Add new tests:

```ts
  describe('update — authorization by tier', () => {
    it('rejects editing the company default without hasFullPontoAccess', async () => {
      const limitedAdmin = { userId: 'u1', companyId: 'company-1', role: 'ADMIN' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: false };
      await expect(service.update({ requirePhoto: false }, limitedAdmin)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows a manager to edit their OWN team override', async () => {
      const managerLogin = { userId: 'u2', companyId: 'company-1', role: 'EMPLOYEE' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: true };
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.findFirst.mockResolvedValue({ id: 'settings-2', companyId: 'company-1', managerId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-2', requirePhoto: false });

      await service.update({ requirePhoto: false, managerId: 'employee-mgr-1' }, managerLogin);

      expect(prisma.timeTrackingSettings.update).toHaveBeenCalledWith({ where: { id: 'settings-2' }, data: { requirePhoto: false } });
    });
  });

  describe('getEffectiveSettingsForEmployee', () => {
    it("uses the employee's direct manager's override when one exists", async () => {
      prisma.employee.findUnique.mockResolvedValue({ managerId: 'employee-mgr-1' });
      const override = { id: 'settings-2', companyId: 'company-1', managerId: 'employee-mgr-1', requirePhoto: false };
      prisma.timeTrackingSettings.findFirst.mockResolvedValueOnce(override);

      const result = await service.getEffectiveSettingsForEmployee('employee-1', 'company-1');

      expect(result).toBe(override);
    });

    it('falls back to the company default when the manager has no override', async () => {
      prisma.employee.findUnique.mockResolvedValue({ managerId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.findFirst
        .mockResolvedValueOnce(null) // manager override lookup
        .mockResolvedValueOnce({ id: 'settings-1', companyId: 'company-1', managerId: null }); // getOrCreateDefault's own lookup

      const result = await service.getEffectiveSettingsForEmployee('employee-1', 'company-1');

      expect(result).toEqual({ id: 'settings-1', companyId: 'company-1', managerId: null });
    });

    it('falls back to the company default when the employee has no manager at all', async () => {
      prisma.employee.findUnique.mockResolvedValue({ managerId: null });
      prisma.timeTrackingSettings.findFirst.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', managerId: null });

      const result = await service.getEffectiveSettingsForEmployee('employee-1', 'company-1');

      expect(result).toEqual({ id: 'settings-1', companyId: 'company-1', managerId: null });
    });
  });
```

Add `employee: { findUnique: jest.fn() }` and `user: { findUnique: jest.fn() }` to the mocked `prisma` object in `beforeEach`.

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npm test -- --testPathPattern=time-tracking-settings`
Expected: FAIL across the board (signature/mock mismatches).

- [ ] **Step 4: Implement**

Full rewrite of `time-tracking-settings.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { TimeTrackingSettings } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { UpdateTimeTrackingSettingsDto } from './dto/update-time-tracking-settings.dto';

@Injectable()
export class TimeTrackingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  // findFirst, não findUnique: companyId sozinho deixou de ser @unique no schema (agora é um
  // índice único PARCIAL via SQL bruto na migration — companyId+managerId:NULL — que o Prisma não
  // reconhece como alvo válido de findUnique). Ver a spec, seção "TimeTrackingSettings".
  async getOrCreateDefault(companyId: string): Promise<TimeTrackingSettings> {
    const existing = await this.prisma.timeTrackingSettings.findFirst({ where: { companyId, managerId: null } });
    if (existing) return existing;
    return this.prisma.timeTrackingSettings.create({ data: { companyId, managerId: undefined } });
  }

  async getCurrent(): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.getOrCreateDefault(companyId);
  }

  // Achado + implementado na revisão de escopo de 15/09/2026: antes deste método, todo
  // funcionário de uma empresa compartilhava literalmente a mesma configuração — agora resolve a
  // sobrescrita do superior DIRETO (nunca propagação em cadeia) antes de cair no padrão da
  // empresa. Usado por TimeClockService.getStatus()/createPunch() no lugar de getOrCreateDefault.
  async getEffectiveSettingsForEmployee(employeeId: string, companyId: string): Promise<TimeTrackingSettings> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
    if (employee?.managerId) {
      const managerOverride = await this.prisma.timeTrackingSettings.findFirst({
        where: { companyId, managerId: employee.managerId },
      });
      if (managerOverride) return managerOverride;
    }
    return this.getOrCreateDefault(companyId);
  }

  private async getOrCreateForManager(companyId: string, managerId: string): Promise<TimeTrackingSettings> {
    const existing = await this.prisma.timeTrackingSettings.findFirst({ where: { companyId, managerId } });
    if (existing) return existing;
    return this.prisma.timeTrackingSettings.create({ data: { companyId, managerId } });
  }

  // Sem managerId no dto: edita o padrão da empresa (exige hasFullPontoAccess). Com managerId:
  // edita a sobrescrita daquele superior (autoatendimento se for o próprio; senão exige
  // hasFullPontoAccess) — mesma regra de WorkSchedulesService.assertValidTierAndAuthorized.
  async update(dto: UpdateTimeTrackingSettingsDto, currentUser: AuthenticatedUser): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    let row: TimeTrackingSettings;
    if (!dto.managerId) {
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      row = await this.getOrCreateDefault(companyId);
    } else {
      const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
      if (currentUserRecord?.employeeId !== dto.managerId) {
        this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      }
      row = await this.getOrCreateForManager(companyId, dto.managerId);
    }
    // row.id já identifica a linha certa (padrão da empresa ou a sobrescrita do superior) — não há
    // por que regravar managerId, ele não muda depois de resolvido.
    const { managerId: _managerId, ...patch } = dto;
    return this.prisma.timeTrackingSettings.update({ where: { id: row.id }, data: patch });
  }

  // Leitura escopada: sem managerId, devolve o padrão da empresa; com managerId, devolve (criando
  // se preciso) a sobrescrita daquele superior — autoatendimento se for o próprio, senão exige
  // hasFullPontoAccess (mesma regra de update, nunca mais permissivo pra leitura que pra escrita).
  async getScoped(managerId: string | undefined, currentUser: AuthenticatedUser): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    if (!managerId) return this.getOrCreateDefault(companyId);
    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (currentUserRecord?.employeeId !== managerId) {
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
    }
    return this.getOrCreateForManager(companyId, managerId);
  }
}
```

- [ ] **Step 5: Update the controller**

```ts
import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { QueryTimeTrackingSettingsDto } from './dto/query-time-tracking-settings.dto';
import { UpdateTimeTrackingSettingsDto } from './dto/update-time-tracking-settings.dto';
import { TimeTrackingSettingsService } from './time-tracking-settings.service';

// Mutação não é mais @Roles('ADMIN') puro — TimeTrackingSettingsService decide por tier (padrão da
// empresa exige hasFullPontoAccess; sobrescrita de time é autoatendimento ou exige acesso total
// pra mexer na de outro superior). RolesGuard removido desta classe.
@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller('time-tracking-settings')
export class TimeTrackingSettingsController {
  constructor(private readonly settings: TimeTrackingSettingsService) {}

  @Get()
  findOne(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryTimeTrackingSettingsDto) {
    return this.settings.getScoped(query.managerId, user);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTimeTrackingSettingsDto) {
    return this.settings.update(dto, user);
  }
}
```

Note: `GET /time-tracking-settings` with no `managerId` still always returns the company default, matching today's behavior exactly (`TimeClockService.getStatus()`'s employee-facing usage is untouched — it now goes through `getEffectiveSettingsForEmployee` instead, wired in Task 7, not this route).

- [ ] **Step 6: Run tests**

Run: `npm test -- --testPathPattern=time-tracking-settings`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/time-tracking-settings/
git commit -m "feat(backend): two-tier TimeTrackingSettings (company/team) with getEffectiveSettingsForEmployee"
```

---

### Task 7: `WorkLocation` authorization — swap `@Roles('ADMIN')` for `assertHasFullPontoAccess`

**Files:**
- Modify: `backend/src/work-locations/work-locations.controller.ts`
- Test: `backend/src/work-locations/work-locations.controller.spec.ts` (create if it does not already exist — check first)

**Interfaces:**
- Consumes: `TimeManagementAuthService.assertHasFullPontoAccess` (Task 3).

- [ ] **Step 1: Check for an existing controller spec**

Run: `find backend/src/work-locations -name "*.spec.ts"`. If none exists for the controller (only `work-locations.service.spec.ts`), create `work-locations.controller.spec.ts` following the same mocking pattern as `files.controller.spec.ts` (mock the service, mock `TimeManagementAuthService`).

- [ ] **Step 2: Write the failing tests**

```ts
import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { WorkLocationsController } from './work-locations.controller';
import { WorkLocationsService } from './work-locations.service';

describe('WorkLocationsController', () => {
  let controller: WorkLocationsController;
  let service: { create: jest.Mock; update: jest.Mock; remove: jest.Mock };
  let timeManagementAuth: { assertHasFullPontoAccess: jest.Mock };

  const fullAccessAdmin: AuthenticatedUser = { userId: 'u1', companyId: 'c1', role: 'ADMIN', modules: [], mustChangePassword: false, hasFullPontoAccess: true };
  const limitedAdmin: AuthenticatedUser = { ...fullAccessAdmin, hasFullPontoAccess: false };

  beforeEach(async () => {
    service = { create: jest.fn(), update: jest.fn(), remove: jest.fn() };
    timeManagementAuth = { assertHasFullPontoAccess: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [WorkLocationsController],
      providers: [
        { provide: WorkLocationsService, useValue: service },
        { provide: TimeManagementAuthService, useValue: timeManagementAuth },
      ],
    }).compile();
    controller = module.get(WorkLocationsController);
  });

  it('create() checks hasFullPontoAccess before delegating', async () => {
    service.create.mockResolvedValue({ id: 'loc-1' });
    await controller.create(fullAccessAdmin, { name: 'Sede', latitude: 0, longitude: 0, radiusMeters: 100 });
    expect(timeManagementAuth.assertHasFullPontoAccess).toHaveBeenCalledWith(fullAccessAdmin);
    expect(service.create).toHaveBeenCalled();
  });

  it('create() propagates the NotFoundException from assertHasFullPontoAccess and never calls the service', async () => {
    timeManagementAuth.assertHasFullPontoAccess.mockImplementation(() => { throw new Error('blocked'); });
    await expect(
      controller.create(limitedAdmin, { name: 'Sede', latitude: 0, longitude: 0, radiusMeters: 100 }),
    ).rejects.toThrow('blocked');
    expect(service.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npm test -- --testPathPattern=work-locations.controller`
Expected: FAIL — `controller.create` doesn't take a `user` param yet.

- [ ] **Step 4: Implement**

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateWorkLocationDto } from './dto/create-work-location.dto';
import { QueryWorkLocationsDto } from './dto/query-work-locations.dto';
import { UpdateWorkLocationDto } from './dto/update-work-location.dto';
import { WorkLocationsService } from './work-locations.service';

// Local de trabalho é infraestrutura física da empresa toda — mutação exige hasFullPontoAccess
// (nunca "meu time", ver a spec de 15/09/2026). RolesGuard/@Roles('ADMIN') removidos desta classe.
@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller('work-locations')
export class WorkLocationsController {
  constructor(
    private readonly workLocations: WorkLocationsService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkLocationDto) {
    this.timeManagementAuth.assertHasFullPontoAccess(user);
    return this.workLocations.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryWorkLocationsDto) {
    return this.workLocations.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workLocations.findOne(id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateWorkLocationDto) {
    this.timeManagementAuth.assertHasFullPontoAccess(user);
    return this.workLocations.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.timeManagementAuth.assertHasFullPontoAccess(user);
    return this.workLocations.remove(id);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=work-locations`
Expected: PASS.

- [ ] **Step 6: Full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/work-locations/
git commit -m "feat(backend): gate WorkLocation mutations on hasFullPontoAccess instead of role alone"
```

---

### Task 8: Wire `TimeClockService`/`TimeAttendanceCalculationService` to the new layered resolution

**Files:**
- Modify: `backend/src/time-clock/time-clock.service.ts`
- Modify: `backend/src/time-clock/time-attendance-calculation.service.ts`
- Test: `backend/src/time-clock/time-clock.service.spec.ts`
- Test: `backend/src/time-clock/time-attendance-calculation.service.spec.ts`

**Interfaces:**
- Consumes: `TimeTrackingSettingsService.getEffectiveSettingsForEmployee` (Task 6).

- [ ] **Step 1: Write the failing test for `TimeAttendanceCalculationService`'s 3-tier fallback**

Add to `time-attendance-calculation.service.spec.ts` (find the existing `getScheduleForDate`/`calculateDailySummary` tests and match their mock shape — likely mocks `prisma.workSchedule.findMany`):

```ts
  describe('getScheduleForDate — three tiers', () => {
    it('prefers an individual schedule over a team-default one', async () => {
      prisma.workSchedule.findMany.mockResolvedValueOnce([{ id: 'individual', weekDays: [1], dailyMinutes: 240 }]);
      // (however this suite currently calls the private method — via calculateDailySummary's public
      // surface, matching its existing test style; adapt the exact mock queueing to that pattern)
    });

    it('falls back to the team-default schedule when no individual one matches', async () => {
      // employee has a managerId; first query (employeeId) returns []; second query (managerId) returns a match
    });

    it('falls back to the company-wide default schedule when neither individual nor team match', async () => {
      // both prior queries return []; third query (employeeId: null, managerId: null) returns a match
    });

    it('results in expectedMinutes: 0 when none of the three tiers has a matching schedule', async () => {
      // all three queries return []
    });
  });
```

Write these against whatever this spec file's ACTUAL existing test style is (read it first — it very likely tests through the public `calculateDailySummary(employeeId, date)` method, mocking `prisma.workSchedule.findMany` to return candidates, per the pattern already visible in `getScheduleForDate`'s own current implementation). Match that style exactly rather than inventing calls to a private method.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- --testPathPattern=time-attendance-calculation`
Expected: FAIL — current `getScheduleForDate` only queries by `employeeId`, never falls back.

- [ ] **Step 3: Implement — `getScheduleForDate`**

```ts
  // Três níveis, sem propagação em cadeia em nenhum passo: individual → padrão do time do
  // superior DIRETO → padrão da empresa inteira → nenhum (expectedMinutes: 0, comportamento de
  // hoje, inalterado). Achado + implementado na revisão de escopo de 15/09/2026.
  private async getScheduleForDate(employeeId: string, date: Date) {
    const localDayOfWeek = date.getUTCDay();

    const individualCandidates = await this.prisma.workSchedule.findMany({
      where: { employeeId, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
      orderBy: { validFrom: 'desc' },
    });
    const individual = individualCandidates.find((s) => s.weekDays.includes(localDayOfWeek));
    if (individual) return individual;

    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
    if (employee?.managerId) {
      const teamCandidates = await this.prisma.workSchedule.findMany({
        where: { managerId: employee.managerId, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
        orderBy: { validFrom: 'desc' },
      });
      const teamDefault = teamCandidates.find((s) => s.weekDays.includes(localDayOfWeek));
      if (teamDefault) return teamDefault;
    }

    const companyCandidates = await this.prisma.workSchedule.findMany({
      where: { employeeId: null, managerId: null, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
      orderBy: { validFrom: 'desc' },
    });
    return companyCandidates.find((s) => s.weekDays.includes(localDayOfWeek)) ?? null;
  }
```

Note: this method does NOT scope by `companyId` in its `where` clauses today (relies on RLS) — keep that same characteristic, don't introduce a new explicit filter that wasn't there before.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=time-attendance-calculation`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `TimeClockService.getStatus`/`createPunch` using effective settings**

In `time-clock.service.spec.ts`, replace every `settingsService.getOrCreateDefault` mock reference with `settingsService.getEffectiveSettingsForEmployee` (the constructor-injected mock object's key), since the production code will call the new method instead. This spec already mocks `settingsService` as `{ getOrCreateDefault: jest.fn()... }` — change to:

```ts
    settingsService = { getEffectiveSettingsForEmployee: jest.fn().mockResolvedValue(baseSettings) };
```

And update every `settingsService.getOrCreateDefault.mockResolvedValue(...)` call throughout the file to `settingsService.getEffectiveSettingsForEmployee.mockResolvedValue(...)`.

- [ ] **Step 6: Run to verify failure**

Run: `npm test -- --testPathPattern=time-clock.service`
Expected: FAIL — production code still calls the old method name, mock is unused/wrong.

- [ ] **Step 7: Implement**

In `time-clock.service.ts`, `getStatus()` and `createPunch()` both currently call `this.settings.getOrCreateDefault(user.companyId)` — change both call sites to:

```ts
    const settings = await this.settings.getEffectiveSettingsForEmployee(employee.id, user.companyId);
```

(Note: this line must come AFTER `const employee = await this.timeManagementAuth.resolveOwnEmployee(user);` in both methods, since it needs `employee.id` — check the current line ordering in both methods; today `resolveOwnEmployee` already runs first in both, so no reordering needed, just the call itself changes.)

- [ ] **Step 8: Run tests**

Run: `npm test -- --testPathPattern=time-clock.service`
Expected: PASS.

- [ ] **Step 9: Full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all clean, full suite passing (415+ from before this plan, plus every new test added across Tasks 1-8).

- [ ] **Step 10: Live verification**

With both dev servers running, using real HTTP calls against a fresh test company:
- Create an employee with no manager and no individual/team/company schedule at all — confirm `GET /time-clock/summary` shows `expectedMinutes: 0` for a given day (today's behavior, unchanged).
- Create a company-wide default `WorkSchedule` (no `employeeId`/`managerId` in the body) as the founding ADMIN — confirm that SAME employee now shows the company default's `dailyMinutes` as `expectedMinutes`.
- Create a manager + a report (`managerId` set on the report's `Employee`), a team-default `WorkSchedule` for the manager — confirm the report's `expectedMinutes` now comes from the team default, not the company default.
- Create an individual `WorkSchedule` for that same report — confirm it now overrides the team default.
- Repeat the same 3-tier check for `TimeTrackingSettings` via `GET /time-clock/status`'s `requirePhoto`/`requireLocation` fields.

- [ ] **Step 11: Commit**

```bash
git add backend/src/time-clock/
git commit -m "feat(backend): wire punch/apuração to the layered WorkSchedule/TimeTrackingSettings resolution"
```

---

### Task 9: Frontend — `src/lib/auth.ts` and `src/lib/api.ts` type/function updates

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: `CurrentUser.hasFullPontoAccess: boolean`; `SystemUser.hasFullPontoAccess: boolean`; `updatePontoAccess(userId: string, hasFullPontoAccess: boolean): Promise<void>`; `WorkScheduleRecord.employeeId: string | null`/`managerId: string | null`; `createWorkSchedule`/`updateWorkSchedule` accepting an optional `managerId`; `getTimeTrackingSettings`/`updateTimeTrackingSettings` accepting an optional `managerId` scope. Consumed by Tasks 10 and 11.

- [ ] **Step 1: `src/lib/auth.ts`**

Add to both `CurrentUser` and `ApiUser`:

```ts
export interface CurrentUser {
  // ... existing fields ...
  hasFullPontoAccess: boolean;
}

interface ApiUser {
  // ... existing fields ...
  hasFullPontoAccess: boolean;
}
```

Add to `toCurrentUser`:

```ts
    hasFullPontoAccess: user.hasFullPontoAccess,
```

- [ ] **Step 2: `src/lib/api.ts` — `SystemUser`**

```ts
interface ApiSystemUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  employeeId: string | null;
  modules: string[];
  status: 'ACTIVE' | 'BLOCKED';
  hasFullPontoAccess: boolean;
}

export interface SystemUser {
  id: string;
  email: string;
  role: 'admin' | 'employee';
  employeeId: string | null;
  modules: string[];
  status: 'active' | 'blocked';
  hasFullPontoAccess: boolean;
}

function mapSystemUser(u: ApiSystemUser): SystemUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role.toLowerCase() as SystemUser['role'],
    employeeId: u.employeeId ?? null,
    modules: u.modules,
    status: u.status.toLowerCase() as SystemUser['status'],
    hasFullPontoAccess: u.hasFullPontoAccess,
  };
}
```

Add the new function right after `unblockSystemUser`:

```ts
export async function updatePontoAccess(userId: string, hasFullPontoAccess: boolean): Promise<void> {
  await request(`/companies/me/users/${userId}/ponto-access`, {
    method: 'PATCH',
    body: JSON.stringify({ hasFullPontoAccess }),
  });
}
```

- [ ] **Step 3: `src/lib/api.ts` — `WorkSchedule`**

```ts
interface ApiWorkSchedule {
  id: string;
  employeeId: string | null;
  managerId: string | null;
  name: string;
  weekDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  breakMinutes: number;
  dailyMinutes: number;
  weeklyMinutes: number;
  toleranceMinutes: number;
  allowOvertime: boolean;
  maxOvertimeMinutesPerDay: number | null;
  nightShift: boolean;
  validFrom: string;
  validTo: string | null;
}
```

```ts
export interface WorkScheduleRecord {
  id: string;
  employeeId: string | null;
  managerId: string | null;
  name: string;
  weekDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  breakMinutes: number;
  dailyMinutes: number;
  weeklyMinutes: number;
  toleranceMinutes: number;
  allowOvertime: boolean;
  maxOvertimeMinutesPerDay: number | null;
  nightShift: boolean;
  validFrom: string;
  validTo: string | null;
}
```

`mapWorkSchedule` — add `employeeId: s.employeeId, managerId: s.managerId,` (replacing the existing bare `employeeId: s.employeeId,` line — check the exact current line list and keep everything else unchanged).

`listWorkSchedules` gains a `managerId` filter parameter:

```ts
export async function listWorkSchedules(params?: { employeeId?: string; managerId?: string }): Promise<WorkScheduleRecord[]> {
  const qs = new URLSearchParams({ pageSize: '100' });
  if (params?.employeeId) qs.set('employeeId', params.employeeId);
  if (params?.managerId) qs.set('managerId', params.managerId);
  const res = await request<Paginated<ApiWorkSchedule>>(`/work-schedules?${qs.toString()}`);
  return res.items.map(mapWorkSchedule);
}
```

(This changes the call signature from a single optional string to an optional object — update Task 11's `WorkSchedulesPanel` call site accordingly; no other current caller of `listWorkSchedules` exists in the frontend per this session's own file map, but grep for other call sites before assuming.)

`createWorkSchedule`'s input type — `employeeId` becomes optional, add `managerId`:

```ts
export async function createWorkSchedule(input: {
  employeeId?: string;
  managerId?: string;
  name: string;
  weekDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  breakMinutes?: number;
  dailyMinutes: number;
  weeklyMinutes: number;
  toleranceMinutes?: number;
  allowOvertime?: boolean;
  maxOvertimeMinutesPerDay?: number;
  nightShift?: boolean;
  validFrom: string;
  validTo?: string;
}): Promise<WorkScheduleRecord> {
  const s = await request<ApiWorkSchedule>('/work-schedules', { method: 'POST', body: JSON.stringify(input) });
  return mapWorkSchedule(s);
}
```

`updateWorkSchedule`'s `Partial<{...}>` input type gains `managerId?: string;` inside the object literal.

- [ ] **Step 4: `src/lib/api.ts` — `TimeTrackingSettings`**

```ts
interface ApiTimeTrackingSettings {
  requirePhoto: boolean;
  requireLocation: boolean;
  allowLocationException: boolean;
  allowExtraPeriods: boolean;
  maxAttachmentSizeBytes: number;
  managerId: string | null;
}

export interface TimeTrackingSettingsRecord {
  requirePhoto: boolean;
  requireLocation: boolean;
  allowLocationException: boolean;
  allowExtraPeriods: boolean;
  maxAttachmentSizeBytes: number;
  managerId: string | null;
}
```

`mapTimeTrackingSettings` gains `managerId: s.managerId,`.

```ts
export async function getTimeTrackingSettings(managerId?: string): Promise<TimeTrackingSettingsRecord> {
  const qs = managerId ? `?managerId=${managerId}` : '';
  const s = await request<ApiTimeTrackingSettings>(`/time-tracking-settings${qs}`);
  return mapTimeTrackingSettings(s);
}

export async function updateTimeTrackingSettings(
  input: Partial<TimeTrackingSettingsRecord>,
): Promise<TimeTrackingSettingsRecord> {
  const s = await request<ApiTimeTrackingSettings>('/time-tracking-settings', { method: 'PATCH', body: JSON.stringify(input) });
  return mapTimeTrackingSettings(s);
}
```

(`updateTimeTrackingSettings` already accepts a `Partial<TimeTrackingSettingsRecord>`, which now includes `managerId` automatically — no signature change needed there beyond the type widening above. Remember Ruling 9 from the original Time Tracking plan: `mapTimeTrackingSettings` must keep explicitly listing every field rather than spreading the raw response — do not revert to `{ ...s }`.)

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: both clean. Fix any call-site type errors this surfaces in `TimeTrackingAdmin.tsx`/`UsersManagement.tsx` — those files are rewritten in Tasks 10/11 next, so a handful of expected pre-existing-callsite errors here is fine as long as you can see exactly which lines Task 10/11 need to touch.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/lib/api.ts
git commit -m "feat(frontend): add hasFullPontoAccess and layered WorkSchedule/TimeTrackingSettings types"
```

---

### Task 10: Frontend — `UsersManagement.tsx` toggle UI

**Files:**
- Modify: `src/pages/app/UsersManagement.tsx`

**Interfaces:**
- Consumes: `SystemUser.hasFullPontoAccess`, `updatePontoAccess` (Task 9), `getCurrentUser().hasFullPontoAccess` (Task 9).

- [ ] **Step 1: Read the current row-rendering section**

Find the `<table>`/row block that renders `user.role === 'admin' ? 'Administrador' : 'Funcionário'` (grep confirmed this exists around line 346) — this is where the new toggle needs to appear, only for rows where `user.role === 'admin'`.

- [ ] **Step 2: Add local state + handler**

Near the top of the component, alongside the existing `users`/`isAdmin` state:

```tsx
  const currentUser = getCurrentUser();
  const myHasFullPontoAccess = currentUser?.hasFullPontoAccess ?? false;
  const [pontoAccessSaving, setPontoAccessSaving] = useState<string | null>(null); // userId currently saving, or null

  const togglePontoAccess = async (user: SystemUser) => {
    setPontoAccessSaving(user.id);
    try {
      await api.updatePontoAccess(user.id, !user.hasFullPontoAccess);
      await load(); // reuse whatever function already reloads `users` after block/unblock — match its exact name
    } catch (err) {
      // Reuse this component's existing error-display mechanism (state var / toast) — match
      // whatever `block`/`unblock` already use for reporting a failed action; do not use alert().
    } finally {
      setPontoAccessSaving(null);
    }
  };
```

Read the file's existing `block`/`unblock` handlers first (around line 189) to find the EXACT name of the reload function and the EXACT error-reporting mechanism already in use, and match both precisely — do not invent a new pattern.

- [ ] **Step 3: Render the toggle in the row, only for ADMIN rows**

Inside the table row where `user.role === 'admin' ? 'Administrador' : 'Funcionário'` is rendered, add right after it:

```tsx
{user.role === 'admin' && (
  <div className="mt-1">
    {myHasFullPontoAccess ? (
      <button
        onClick={() => togglePontoAccess(user)}
        disabled={pontoAccessSaving === user.id}
        className="text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
      >
        {pontoAccessSaving === user.id
          ? 'Salvando...'
          : user.hasFullPontoAccess
            ? 'Acesso total ao Ponto — clique para restringir ao próprio time'
            : 'Restrito ao próprio time no Ponto — clique para dar acesso total'}
      </button>
    ) : (
      <span className="text-xs text-muted">
        {user.hasFullPontoAccess ? 'Acesso total ao Ponto' : 'Restrito ao próprio time no Ponto'}
      </span>
    )}
  </div>
)}
```

(Match the exact Tailwind classes already used by sibling elements in this row for visual consistency — read the surrounding JSX before finalizing the classNames above; the ones shown are illustrative of the existing button/label pattern already used elsewhere in this file, not necessarily byte-exact.)

- [ ] **Step 4: Manual verification (no automated test for this file — matches this project's existing convention of no frontend unit tests)**

Run both dev servers. As a full-access ADMIN, open `/app/usuarios`, confirm every `ADMIN` row shows a clickable toggle; click one, confirm it flips and the label updates. Try turning off the LAST full-access admin (yourself, if you're the only one) — confirm the error surfaces visibly (not silently swallowed) rather than crashing.

- [ ] **Step 5: `tsc`/lint**

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/app/UsersManagement.tsx
git commit -m "feat(frontend): add hasFullPontoAccess toggle to Usuários e Acessos"
```

---

### Task 11: Frontend — `TimeTrackingAdmin.tsx` — Regras da empresa / Jornadas rework

**Files:**
- Modify: `src/pages/app/TimeTrackingAdmin.tsx`

**Interfaces:**
- Consumes: `TimeTrackingSettingsRecord.managerId`, `WorkScheduleRecord.employeeId`/`managerId`, `getTimeTrackingSettings(managerId?)`, `listWorkSchedules({employeeId?, managerId?})`, `createWorkSchedule`/`updateTimeTrackingSettings` with the new optional `managerId` (all Task 9). `listManageableEmployees` (already exists, from the earlier post-final-review pass this session).

- [ ] **Step 1: Determine "does the current user manage a team" once, at the `SettingsTab` level**

`SettingsTab` currently just renders `<SettingsPanel /><WorkSchedulesPanel employees={employees} /><WorkLocationsPanel />`. It needs to know: (a) does the current user have `hasFullPontoAccess`, (b) does the current user's own linked employee have any direct reports (i.e., are they a manager themselves). Fetch (b) via the already-existing `listManageableEmployees()` — if it returns anything AND the current user isn't relying purely on the `'ALL'` full-access path, they have a team. Simplify: call `listManageableEmployees()` once here and derive both flags from `getCurrentUser()` + that result's length, passing both down:

```tsx
function SettingsTab() {
  const myHasFullPontoAccess = getCurrentUser()?.hasFullPontoAccess ?? false;
  const [myOwnEmployeeId, setMyOwnEmployeeId] = useState<string | null>(getCurrentUser()?.employeeId ?? null);
  const [manageableCount, setManageableCount] = useState<number | null>(null);

  useEffect(() => {
    listManageableEmployees().then((list) => setManageableCount(list.length)).catch(() => setManageableCount(0));
  }, []);

  if (manageableCount === null) {
    return <div className="py-8 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={24} /></div>;
  }

  // Um ADMIN com hasFullPontoAccess sempre vê "manageableCount" como a empresa inteira (via
  // getManageableEmployeeIds's 'ALL') — usamos isso só pra saber se HÁ alguém a gerenciar, não pra
  // decidir se o usuário tem um "próprio time" no sentido de managerId. A seção "Minha equipe" só
  // faz sentido quando o próprio login está vinculado a um Employee (myOwnEmployeeId) que aparece
  // como managerId de alguém — aproximamos isso checando se manageableCount > 0 E myOwnEmployeeId
  // existe; um ADMIN de acesso total sem Employee vinculado nunca tem "minha equipe" própria.
  const hasOwnTeam = manageableCount > 0 && !!myOwnEmployeeId;

  return (
    <div className="space-y-8">
      <SettingsPanel hasFullPontoAccess={myHasFullPontoAccess} hasOwnTeam={hasOwnTeam} myOwnEmployeeId={myOwnEmployeeId} />
      <WorkSchedulesPanel hasFullPontoAccess={myHasFullPontoAccess} hasOwnTeam={hasOwnTeam} myOwnEmployeeId={myOwnEmployeeId} />
      <WorkLocationsPanel canEdit={myHasFullPontoAccess} />
    </div>
  );
}
```

Add the `listManageableEmployees`/`getCurrentUser` imports at the top of the file if not already present (the former already exists per this session's earlier work; the latter needs `import { getCurrentUser } from '../../lib/auth';`).

- [ ] **Step 2: `SettingsPanel` — company/team toggle**

```tsx
function SettingsPanel({ hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId }: { hasFullPontoAccess: boolean; hasOwnTeam: boolean; myOwnEmployeeId: string | null }) {
  // 'company' só é uma opção pra quem tem hasFullPontoAccess; 'team' só é uma opção pra quem tem
  // hasOwnTeam. Quem tem as duas alterna; quem só tem uma vê só aquela, sem seletor.
  const [scope, setScope] = useState<'company' | 'team'>(hasFullPontoAccess ? 'company' : 'team');
  const [settings, setSettings] = useState<TimeTrackingSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const managerId = scope === 'team' ? (myOwnEmployeeId ?? undefined) : undefined;
    getTimeTrackingSettings(managerId).then(setSettings).catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar configurações.')).finally(() => setLoading(false));
  }, [scope, myOwnEmployeeId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (key: keyof TimeTrackingSettingsRecord) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: !settings[key] });
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const managerId = scope === 'team' ? (myOwnEmployeeId ?? undefined) : undefined;
      const updated = await updateTimeTrackingSettings({ ...settings, managerId });
      setSettings(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  if (!hasFullPontoAccess && !hasOwnTeam) {
    return (
      <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
        <h2 className="text-lg font-heading font-bold text-foreground mb-1">Regras da empresa</h2>
        <p className="text-sm text-muted">Você ainda não gerencia nenhum funcionário — nada para configurar aqui.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-lg font-heading font-bold text-foreground">Regras da empresa</h2>
        {hasFullPontoAccess && hasOwnTeam && (
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1">
            <button onClick={() => setScope('company')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${scope === 'company' ? 'bg-primary text-white' : 'text-muted'}`}>Padrão da empresa</button>
            <button onClick={() => setScope('team')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${scope === 'team' ? 'bg-primary text-white' : 'text-muted'}`}>Minha equipe</button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted mb-6">
        {scope === 'company' ? 'Nenhuma regra vem pré-definida — configure o que sua empresa exige para bater ponto.' : 'Vale só para os seus subordinados diretos, sobrescrevendo o padrão da empresa.'}
      </p>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 text-sm">{error}</div>}
      {loading || !settings ? (
        <div className="py-8 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={24} /></div>
      ) : (
        <div className="space-y-3">
          <ToggleRow label="Exigir foto na marcação" checked={settings.requirePhoto} onChange={() => toggle('requirePhoto')} />
          <ToggleRow label="Exigir localização na marcação" checked={settings.requireLocation} onChange={() => toggle('requireLocation')} />
          <ToggleRow label="Permitir exceção de localização (fica em análise em vez de bloquear)" checked={settings.allowLocationException} onChange={() => toggle('allowLocationException')} />
          <ToggleRow label="Permitir períodos extras (Entrada/Saída Extra)" checked={settings.allowExtraPeriods} onChange={() => toggle('allowExtraPeriods')} />
          <button onClick={save} disabled={saving} className="mt-4 px-5 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />} Salvar {saved && <Check size={16} />}
          </button>
        </div>
      )}
    </div>
  );
}
```

`ToggleRow` is unchanged.

- [ ] **Step 3: `WorkSchedulesPanel` — 3-tier picker + create form**

Replace the `employeeId`-only picker with a tier selector (`empresa` / `time` / `individual`), each revealing the right sub-field, and swap the `employees` prop for `listManageableEmployees()` (already used elsewhere in this file per the earlier post-final-review pass — never the full company roster):

```tsx
function WorkSchedulesPanel({ hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId }: { hasFullPontoAccess: boolean; hasOwnTeam: boolean; myOwnEmployeeId: string | null }) {
  const [manageableEmployees, setManageableEmployees] = useState<{ id: string; fullName: string }[]>([]);
  useEffect(() => { listManageableEmployees().then(setManageableEmployees).catch(() => setManageableEmployees([])); }, []);

  const [items, setItems] = useState<WorkScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tier, setTier] = useState<'company' | 'team' | 'individual'>(hasFullPontoAccess ? 'company' : 'individual');
  const [form, setForm] = useState({
    employeeId: '', name: '', weekDays: [1, 2, 3, 4, 5] as number[],
    expectedStartTime: '08:00', expectedEndTime: '17:00', breakMinutes: 60,
    dailyMinutes: 480, weeklyMinutes: 2400, validFrom: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(() => {
    setLoading(true);
    listWorkSchedules().then(setItems).catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar jornadas.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleWeekDay = (d: number) => {
    setForm((f) => ({ ...f, weekDays: f.weekDays.includes(d) ? f.weekDays.filter((x) => x !== d) : [...f.weekDays, d].sort() }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.weekDays.length === 0) return;
    if (tier === 'individual' && !form.employeeId) return;
    setSaving(true);
    setError('');
    try {
      await createWorkSchedule({
        ...form,
        employeeId: tier === 'individual' ? form.employeeId : undefined,
        managerId: tier === 'team' ? (myOwnEmployeeId ?? undefined) : undefined,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a jornada.');
    } finally {
      setSaving(false);
    }
  };

  const rowLabel = (s: WorkScheduleRecord) => {
    if (s.employeeId) return manageableEmployees.find((e) => e.id === s.employeeId)?.fullName ?? s.employeeId;
    if (s.managerId) return 'Padrão do time';
    return 'Padrão da empresa';
  };

  return (
    <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-heading font-bold text-foreground">Jornadas de trabalho</h2>
        <button onClick={() => setShowForm((s) => !s)} className="text-sm font-medium text-primary hover:text-primary/80 flex items-center gap-1">
          <Plus size={16} /> Nova Jornada
        </button>
      </div>
      <p className="text-sm text-muted mb-6">Três níveis — padrão da empresa, padrão do time, ou individual — o mais específico sempre vence.</p>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 text-sm">{error}</div>}

      {showForm && (
        <form onSubmit={submit} className="mb-6 p-5 bg-secondary/10 border border-border/50 rounded-2xl space-y-4">
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
            {hasFullPontoAccess && <button type="button" onClick={() => setTier('company')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tier === 'company' ? 'bg-primary text-white' : 'text-muted'}`}>Empresa</button>}
            {(hasFullPontoAccess || hasOwnTeam) && <button type="button" onClick={() => setTier('team')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tier === 'team' ? 'bg-primary text-white' : 'text-muted'}`}>Meu time</button>}
            <button type="button" onClick={() => setTier('individual')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tier === 'individual' ? 'bg-primary text-white' : 'text-muted'}`}>Individual</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {tier === 'individual' && (
              <select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground">
                <option value="">Funcionário...</option>
                {manageableEmployees.map((emp) => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
              </select>
            )}
            <input required placeholder="Nome (ex: Comercial 8h-17h)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {WEEKDAY_LABELS.map((label, i) => (
              <button type="button" key={i} onClick={() => toggleWeekDay(i)} className={`w-10 h-10 rounded-lg text-xs font-bold transition-colors ${form.weekDays.includes(i) ? 'bg-primary text-white' : 'bg-secondary text-muted'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input required type="time" value={form.expectedStartTime} onChange={(e) => setForm({ ...form, expectedStartTime: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
            <input required type="time" value={form.expectedEndTime} onChange={(e) => setForm({ ...form, expectedEndTime: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Intervalo (min)" value={form.breakMinutes} onChange={(v) => setForm({ ...form, breakMinutes: v })} />
            <NumberField label="Carga diária (min)" value={form.dailyMinutes} onChange={(v) => setForm({ ...form, dailyMinutes: v })} />
            <NumberField label="Carga semanal (min)" value={form.weeklyMinutes} onChange={(v) => setForm({ ...form, weeklyMinutes: v })} />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Vigente a partir de</label>
            <input required type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
          </div>
          <button type="submit" disabled={saving} className="px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />} Criar Jornada
          </button>
        </form>
      )}

      {loading ? (
        <div className="py-8 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={24} /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted italic py-4">Nenhuma jornada configurada ainda.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead><tr className="border-b border-border/40"><Th>Nível</Th><Th>Nome</Th><Th>Dias</Th><Th>Horário</Th><Th>Carga diária</Th></tr></thead>
          <tbody className="divide-y divide-border/40">
            {items.map((s) => (
              <tr key={s.id}>
                <Td>{rowLabel(s)}</Td>
                <Td>{s.name}</Td>
                <Td>{s.weekDays.map((d) => WEEKDAY_LABELS[d]).join(', ')}</Td>
                <Td>{s.expectedStartTime} - {s.expectedEndTime}</Td>
                <Td>{Math.floor(s.dailyMinutes / 60)}h{(s.dailyMinutes % 60).toString().padStart(2, '0')}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `WorkLocationsPanel` — gate the create/toggle actions on `canEdit`**

```tsx
function WorkLocationsPanel({ canEdit }: { canEdit: boolean }) {
  // ... existing state/load/submit/toggleActive unchanged ...

  return (
    <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-heading font-bold text-foreground">Locais de trabalho</h2>
        {canEdit && (
          <button onClick={() => setShowForm((s) => !s)} className="text-sm font-medium text-primary hover:text-primary/80 flex items-center gap-1">
            <Plus size={16} /> Novo Local
          </button>
        )}
      </div>
      {/* ... error/loading/empty states unchanged ... */}
      {showForm && canEdit && (
        /* existing form JSX unchanged */
      )}
      {/* table unchanged, except the last <Td> (the Ativar/Desativar button) only renders when canEdit: */}
      <Td className="text-right">
        {canEdit && (
          <button onClick={() => toggleActive(l)} className="text-xs font-medium text-primary hover:text-primary/80">
            {l.active ? 'Desativar' : 'Ativar'}
          </button>
        )}
      </Td>
    </div>
  );
}
```

- [ ] **Step 5: Update the `SettingsTab` call site**

Find where `SettingsTab` is rendered (the parent `TimeTrackingAdmin` component's tab-switch) and remove the `employees={employees}` prop it currently receives — `SettingsTab` no longer needs it (it derives everything from `getCurrentUser()`/`listManageableEmployees()` internally now).

- [ ] **Step 6: `tsc`/lint**

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: both clean.

- [ ] **Step 7: Live verification**

With both dev servers running:
- As the full-access founding ADMIN: open Configuração, confirm "Regras da empresa" shows only "Padrão da empresa" (no team toggle, since the founder likely has no `Employee` link/team yet) unless you've linked yourself to an Employee with reports — test both states if feasible.
- Create a company-wide default `WorkSchedule` (tier "Empresa") — confirm it appears in the table labeled "Padrão da empresa".
- As a non-full-access manager login (toggle one off via Task 10's UI first): confirm "Regras da empresa" shows only "Minha equipe" (no toggle, no visibility into the company row), and the Jornadas form only offers "Meu time"/"Individual" tiers, never "Empresa". Confirm `WorkLocationsPanel` shows no "Novo Local" button and no "Ativar/Desativar" actions for this login.
- Confirm no console errors in either state.

- [ ] **Step 8: Commit**

```bash
git add src/pages/app/TimeTrackingAdmin.tsx
git commit -m "feat(frontend): three-tier Jornadas + company/team Regras da empresa in Configuração"
```

---

### Task 12: End-to-end validation + documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify (vault, outside this git repo): `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`, `B:\Quickflow\Quickflow\TimeTrackingAdmin.md`, `B:\Quickflow\Quickflow\ControleDePonto.md`, `B:\Quickflow\Quickflow\UsersManagement.md` (check whether this note already exists; create if not, per the vault's own "one note per page" convention)

- [ ] **Step 1: Full backend validation**

Run, from `backend/`:
```bash
npx prisma migrate status
npm test
npm run test:e2e
npm run lint
npm run build
```
Expected: migrations clean/up to date; unit tests all passing (count will be higher than the 423 baseline from before this plan — every task above added new cases); e2e still 9/9 (Task 1-8 shouldn't break the existing e2e suites, but re-run to confirm — if either e2e file exercises `WorkSchedule`/`TimeTrackingSettings` directly, its assertions may need the same `managerId: null`/tier-aware updates made throughout this plan); lint/build clean.

- [ ] **Step 2: Full frontend validation**

Run, from the repo root:
```bash
npx tsc --noEmit -p .
npm run lint
npm run build
```
Expected: all clean.

- [ ] **Step 3: Manual browser walkthrough (do not skip or fake this — see this project's own standing "never fake browser QA" convention)**

Using chrome-devtools-mcp (or equivalent), walk through, on real dev servers against a real Postgres:
1. Register a fresh company (founding ADMIN, `hasFullPontoAccess: true` by schema default).
2. Create a second ADMIN login via `/app/usuarios`; confirm its row shows the new toggle.
3. Create two employees, link one as the second admin's `Employee` and set the other's `managerId` to point at it (making the second admin a manager of the first employee).
4. As the founding admin, turn OFF `hasFullPontoAccess` for the second admin login.
5. Log in as that now-restricted admin. Confirm: `/app/ponto-administracao`'s Inconsistências/Ajustes/Justificativas tabs show only their one direct report, not the whole company. Confirm Configuração shows only "Minha equipe" (no company-wide toggle, no locations create/edit).
6. As the restricted admin, create a team-default `WorkSchedule` for their own team. Confirm the direct report's `/app/ponto` Espelho de Ponto now reflects that schedule's `expectedMinutes` on a matching weekday.
7. Log back in as the founding admin, try turning OFF the restricted admin's access again as a no-op (already off) and confirm no crash; try turning off the LAST full-access admin (themselves, if no one else has it) and confirm the `400` surfaces visibly in the UI, not silently.
8. Create a company-wide default `WorkSchedule` and confirm a THIRD employee (no manager, no individual/team schedule) picks it up.

Document the actual outcome of every one of these 8 steps in the task report — do not claim success without having actually clicked through it.

- [ ] **Step 4: `CLAUDE.md`**

Add a new subsection under the existing "Controle de Ponto" section (do not create a new top-level section — this is a refinement of that same module), covering: `hasFullPontoAccess` and what it changes in `canManage()`/`getManageableEmployeeIds()`; the three-tier `WorkSchedule`/two-tier `TimeTrackingSettings` model and the partial-unique-index detail; the new `PATCH /companies/me/users/:id/ponto-access` endpoint and its last-admin safeguard. Follow the existing section's density/style exactly (see how the original `canManage()` incident and the Ruling 8/9/10/11 fixes are already written there).

- [ ] **Step 5: Vault**

Update `DECISOES-TECNICAS.md`'s "Controle de Ponto" section with the full design rationale (mirror the spec's "Contexto e motivação" + the key tradeoffs already debated in conversation — why `WorkLocation` stays company-wide, why no skip-level cascading, why a configurable flag instead of "only the founder"). Update `TimeTrackingAdmin.md` for the new Configuração tab behavior (tier toggles). Check whether `UsersManagement.md` already exists in the vault; if so add the toggle; if not, this plan does not require creating it from scratch (out of scope — flag it as a pre-existing gap if noticed, don't fix unrelated documentation debt here).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document scoped Ponto configuration (hasFullPontoAccess, layered WorkSchedule/TimeTrackingSettings)"
```

(Vault commit is separate/manual per this project's established convention — the vault is not part of this git repo.)

- [ ] **Step 7: Remind the user to push**

Per this session's standing instruction: check `git status -sb` for the ahead-count and explicitly offer/ask to push every commit from this plan to `origin/main` before considering the plan finished — do not let it go unmentioned.
