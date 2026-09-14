# Controle de Ponto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o `TimeTracking.tsx` 100% mockado por um backend real de Controle de Ponto:
modelo de eventos flexível (sem colunas fixas), hierarquia de superior configurável, apuração de
carga horária isolada e testável, fluxo de solicitação/aprovação de ajuste com trilha de auditoria,
justificativas/atestados com upload, calendário de feriados nacional+estadual+customizado, e uma
tela administrativa nova (hoje inexistente).

**Architecture:** 10 módulos NestJS novos (`files`, `holidays`, `work-schedules`, `work-locations`,
`time-clock`, `time-adjustments`, `time-justifications`) + extensões pontuais em módulos existentes
(`employees` ganha `managerId`; `auth` ganha o endpoint de auto-vínculo a um `Employee`) — tudo
sobre a base já existente (Prisma/PostgreSQL, `CompanyContextService`, `JwtAuthGuard`/`ModulesGuard`/
`RolesGuard`, RLS a nível de banco). Frontend ganha funções novas em `src/lib/api.ts`, o
`TimeTracking.tsx` existente é reescrito internamente (mesmo layout, dados reais) e uma página
administrativa nova é criada.

**Tech Stack:** `multer` (já instalado, nunca usado — primeira rota de upload do projeto),
`sharp` (remoção de EXIF de fotos), `file-type` (validação de assinatura real do arquivo) —
únicas dependências novas, todas no backend. Frontend sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-13-time-tracking-design.md`

## Global Constraints

- Todo endpoint de escrita deriva `employeeId`/`companyId` só de `req.user` — nunca aceita esses
  campos no corpo da requisição, mesmo que o DTO os declare por engano (usar o mesmo padrão de
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` global já existente pra rejeitar
  qualquer campo extra, não silenciar).
- `TimeEvent` é imutável por design de aplicação — nenhum endpoint de `PATCH`/`DELETE` é exposto
  para ele em nenhuma task deste plano.
- Toda tabela nova com `companyId` recebe `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
  + a mesma política `tenant_isolation` já usada em todo o resto do banco (ver
  `backend/prisma/migrations/` para o padrão exato de uma migration de RLS já aplicada). `Holiday`
  de escopo `NATIONAL`/`STATE` não tem `companyId` — não recebe RLS (é dado global, não de tenant).
- Toda transação multi-passo usa `runTenantInteractiveTransaction(this.prisma, async (tx) => {...})`
  (`backend/src/prisma/tenant-rls.extension.ts`) — nunca `this.prisma.$transaction(...)` direto,
  que quebraria o contexto de tenant da RLS dentro da transação (comportamento já documentado e
  testado neste projeto).
- Autorização "quem pode administrar o ponto de quem" é centralizada num único serviço
  (`TimeManagementAuthService`, Task 4) e reutilizada por toda task administrativa depois dela —
  nunca reimplementada em cada controller.
- Nunca usar `npx prisma db push --accept-data-loss`. Seguir o ritual já estabelecido neste
  projeto: `npx prisma migrate dev --name <nome>`; se falhar contra a shadow database com o erro
  conhecido `P3006`, usar o fallback (`migrate diff --script` + pasta de migration manual +
  `migrate deploy`); sempre verificar ao final com um segundo `migrate diff` reportando script
  vazio.
- Nenhuma regra de CLT (adicional noturno, banco de horas, multiplicador de hora extra) é aplicada
  automaticamente em nenhuma task — todo mecanismo é configurável, sem valor-padrão de negócio
  embutido.
- Preservar o layout/padrão visual atual de `TimeTracking.tsx` — as tasks de frontend reescrevem o
  estado interno e as chamadas de API, não o design.

---

### Task 1: Modelo de dados completo + migration segura

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: uma nova pasta de migration em `backend/prisma/migrations/`

**Interfaces:**
- Produces: todos os modelos/enums descritos na spec (`TimeEvent`, `WorkSchedule`, `WorkLocation`,
  `TimeAdjustmentRequest`, `TimeCorrection`, `TimeJustification`, `FileAsset`, `Holiday`,
  `TimeTrackingSettings`) + `Employee.managerId` + `Company.timezone`/`Company.state` + todas as
  relações inversas em `Company`/`Employee`.

- [ ] **Passo 1: Adicionar os modelos ao schema**

Em `backend/prisma/schema.prisma`, adicionar (copiar exatamente da spec
`docs/superpowers/specs/2026-09-13-time-tracking-design.md`, seção "Modelo de dados" — o bloco
Prisma completo já está lá, incluindo as relações inversas corrigidas em `Company` e a adição em
`Employee`). Não reescrever do zero — copiar literalmente, é a fonte da verdade já revisada.

- [ ] **Passo 2: Gerar e aplicar a migration com segurança**

```bash
cd backend
npx prisma migrate dev --name add_time_tracking
```
Se falhar contra a shadow database (`P3006`, pré-existente e conhecido), usar o fallback já
estabelecido:
```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > migration_draft.sql
# criar backend/prisma/migrations/<timestamp>_add_time_tracking/migration.sql com esse conteúdo
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Passo 3: Adicionar RLS na mesma migration (ou numa migration seguinte imediata)**

Para cada tabela nova com `companyId` (`TimeEvent`, `WorkSchedule`, `WorkLocation`,
`TimeAdjustmentRequest`, `TimeCorrection`, `TimeJustification`, `FileAsset`,
`TimeTrackingSettings`, e `Holiday` só quando `scope='COMPANY'` — mas como RLS não pode ser
condicional por linha dentro de uma política simples de igualdade, e `Holiday` tem `companyId`
nulo para os escopos `NATIONAL`/`STATE`, a política precisa tratar `companyId IS NULL` como
"visível para todos" nesses dois escopos):

```sql
ALTER TABLE "TimeEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeEvent"
  USING ("companyId" = current_setting('app.current_company_id', true))
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true));
-- repetir exatamente para WorkSchedule, WorkLocation, TimeAdjustmentRequest, TimeCorrection,
-- TimeJustification, FileAsset, TimeTrackingSettings (mesmo nome de coluna, mesma política).

ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Holiday" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Holiday"
  USING ("companyId" IS NULL OR "companyId" = current_setting('app.current_company_id', true))
  WITH CHECK ("companyId" IS NULL OR "companyId" = current_setting('app.current_company_id', true));
```

Verificar ao final: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` deve reportar "This is an empty migration." Verificar também, via consulta direta (mesmo método já usado na auditoria de RLS anterior — `SELECT tablename, rowsecurity, relforcerowsecurity FROM pg_tables JOIN pg_class ...` ou equivalente), que `FORCE` está ativo em todas as 9 tabelas novas.

- [ ] **Passo 4: Testes de schema + commit**

Rodar `cd backend && npm run build` (confirma que o Prisma Client gerado compila contra qualquer
código já existente — não deve haver nenhum ainda usando os modelos novos). Commit:
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(backend): add Time Tracking data model with RLS"
```

---

### Task 2: Infraestrutura de arquivo (`FilesModule`) — primeiro upload do projeto

**Files:**
- Create: `backend/src/files/files.module.ts`
- Create: `backend/src/files/files.service.ts`
- Create: `backend/src/files/files.service.spec.ts`
- Create: `backend/src/files/files.controller.ts`
- Create: `backend/src/files/files.controller.spec.ts`
- Create: `backend/src/files/dto/upload-file.dto.ts` (validação do multipart — extensão/mimetype)
- Create: `backend/src/files/download-token.util.ts`
- Create: `backend/src/files/download-token.util.spec.ts`
- Modify: `backend/package.json` (via `npm install sharp file-type`)
- Modify: `backend/.gitignore` (adicionar `backend/storage/`)

**Interfaces:**
- Consumes: `CompanyContextService`, `CurrentUser()`.
- Produces: `FilesService.upload(companyId, uploadedByUserId, file: Express.Multer.File, purpose: FileAssetPurpose): Promise<FileAsset>`; `FilesService.getReadableStream(assetId, requesterCompanyId): Promise<{ stream, asset }>`; `generateDownloadToken(assetId: string): string` / `verifyDownloadToken(assetId: string, token: string): boolean`; rota `GET /file-assets/:id`.

- [ ] **Passo 1: Instalar dependências**

```bash
cd backend
npm install sharp file-type
```

- [ ] **Passo 2: Token de download assinado (substitui URL pré-assinada de nuvem)**

`backend/src/files/download-token.util.ts`:
```ts
import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutos — curto de propósito, é um link de download pontual

function secret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error('JWT_ACCESS_SECRET ausente — não é possível gerar token de download');
  return s;
}

// Reaproveita o mesmo segredo do JWT de acesso (já validado no boot, já rotacionável do mesmo
// jeito) em vez de introduzir um segredo novo pra gerenciar — o risco é equivalente (quem tem um
// já teria o outro comprometido de qualquer forma).
export function generateDownloadToken(assetId: string): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${assetId}.${expiresAt}`;
  const signature = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${expiresAt}.${signature}`;
}

export function verifyDownloadToken(assetId: string, token: string): boolean {
  const [expiresAtStr, signature] = token.split('.');
  const expiresAt = Number(expiresAtStr);
  if (!expiresAtStr || !signature || Number.isNaN(expiresAt)) return false;
  if (Date.now() > expiresAt) return false;
  const payload = `${assetId}.${expiresAt}`;
  const expected = createHmac('sha256', secret()).update(payload).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Passo 3: teste de `download-token.util.ts`**

```ts
import { generateDownloadToken, verifyDownloadToken } from './download-token.util';

describe('download-token.util', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
  });

  it('generates a token that verifies successfully for the same asset', () => {
    const token = generateDownloadToken('asset-1');
    expect(verifyDownloadToken('asset-1', token)).toBe(true);
  });

  it('rejects a token verified against a different asset id', () => {
    const token = generateDownloadToken('asset-1');
    expect(verifyDownloadToken('asset-2', token)).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(verifyDownloadToken('asset-1', 'garbage')).toBe(false);
  });

  it('rejects an expired token', () => {
    const payload = `asset-1.${Date.now() - 1000}`;
    const { createHmac } = require('crypto');
    const sig = createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(payload).digest('hex');
    const expiredToken = `${Date.now() - 1000}.${sig}`;
    expect(verifyDownloadToken('asset-1', expiredToken)).toBe(false);
  });
});
```

- [ ] **Passo 4: `FilesService`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { FileAssetPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const STORAGE_ROOT = join(process.cwd(), 'storage', 'attachments');
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // default; TimeTrackingSettings pode sobrepor por empresa
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  }

  async upload(
    companyId: string,
    uploadedByUserId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    purpose: FileAssetPurpose,
    maxSizeBytes: number = MAX_SIZE_BYTES,
  ) {
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(`Arquivo excede o tamanho máximo permitido (${maxSizeBytes} bytes)`);
    }
    // Nunca confiar só no mimetype declarado pelo cliente — confere a assinatura real do arquivo.
    const detected = await fileTypeFromBuffer(file.buffer);
    const realMime = detected?.mime ?? file.mimetype;
    if (!ALLOWED_MIME.has(realMime)) {
      throw new BadRequestException('Formato de arquivo não permitido (aceitos: PDF, JPG, PNG)');
    }

    let bufferToStore = file.buffer;
    if (realMime === 'image/jpeg' || realMime === 'image/png') {
      // Remove EXIF (pode conter GPS/modelo do aparelho) re-codificando a imagem.
      bufferToStore = await sharp(file.buffer).rotate().toBuffer();
    }

    await mkdir(STORAGE_ROOT, { recursive: true });
    const storedName = `${randomUUID()}${ALLOWED_EXT[realMime]}`;
    const storagePath = join('attachments', storedName); // relativo — nunca exposto ao cliente
    await writeFile(join(STORAGE_ROOT, storedName), bufferToStore);

    return this.prisma.fileAsset.create({
      data: {
        companyId,
        uploadedByUserId,
        originalFilename: this.sanitizeFilename(file.originalname),
        mimeType: realMime,
        sizeBytes: bufferToStore.length,
        storagePath,
        purpose,
      },
    });
  }

  // Autorização (dono OU ADMIN OU superior direto) é checada pelo chamador (FilesController),
  // que já tem acesso ao TimeManagementAuthService (Task 4) — este método só resolve o arquivo em
  // si depois que a autorização já passou, e sempre escopado por empresa via RLS (a query abaixo
  // roda dentro do contexto de tenant já estabelecido pelo interceptor global).
  async assertExistsForCompany(id: string, companyId: string) {
    const asset = await this.prisma.fileAsset.findFirst({ where: { id, companyId } });
    if (!asset) throw new NotFoundException(`Arquivo ${id} não encontrado`);
    return asset;
  }

  async streamPath(storagePath: string) {
    const fullPath = join(STORAGE_ROOT, storagePath.replace(/^attachments[\\/]/, ''));
    await stat(fullPath); // lança se não existir
    return createReadStream(fullPath);
  }
}
```

- [ ] **Passo 5: teste de `FilesService`**

Mockar `PrismaService` (mesmo padrão de todo o resto do backend). Casos mínimos: rejeita arquivo
acima do tamanho máximo; rejeita MIME não permitido mesmo que a extensão minta (mock
`fileTypeFromBuffer` retornando um tipo diferente do declarado); aceita PDF/JPG/PNG válidos e grava
`FileAsset` com os campos corretos; nome do arquivo em disco nunca é o nome original (usa
`randomUUID`).

- [ ] **Passo 6: `FilesController`**

```ts
import { Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { verifyDownloadToken } from './download-token.util';
import { FilesService } from './files.service';

@Controller('file-assets')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // Guard global (JwtAuthGuard) já exige um token de acesso válido pra chegar aqui — o `?token=`
  // na query é uma segunda camada (o token de download curto), não substitui a autenticação normal.
  @Get(':id')
  async download(
    @Param('id') id: string,
    @Query('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    if (!token || !verifyDownloadToken(id, token)) {
      throw new NotFoundException('Link de download inválido ou expirado');
    }
    const asset = await this.filesService.assertExistsForCompany(id, user.companyId);
    const stream = await this.filesService.streamPath(asset.storagePath);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${asset.originalFilename}"`);
    stream.pipe(res);
  }
}
```

**Nota para a Task 6 (endpoint de criação de batida) e Tasks 8/9 (anexos):** a checagem de "dono
OU ADMIN OU superior direto" descrita na spec para `GET /file-assets/:id` é responsabilidade de
quem CHAMA `generateDownloadToken` (só gera um link pra quem já provou ter esse direito ao listar
o recurso pai — uma batida, uma solicitação, uma justificativa) — o controller acima só confere
"o token é válido e a empresa bate," não precisa reimplementar a checagem de dono/superior de novo.

- [ ] **Passo 7: `.gitignore`, testes, build, lint, commit**

```bash
echo "backend/storage/" >> .gitignore
cd backend
npm test
npm run build
npm run lint
git add src/files package.json package-lock.json ../.gitignore
git commit -m "feat(backend): add first file-upload infrastructure (FilesModule)"
```

---

### Task 3: Feriados (`HolidaysModule`) — nacional + estadual semeados, customizado por empresa

**Files:**
- Create: `backend/src/holidays/holidays.module.ts`
- Create: `backend/src/holidays/holidays.service.ts`
- Create: `backend/src/holidays/holidays.service.spec.ts`
- Create: `backend/src/holidays/holidays.controller.ts`
- Create: `backend/src/holidays/dto/create-holiday.dto.ts`
- Create: `backend/src/holidays/brazilian-holidays.seed.ts`
- Create: `backend/src/holidays/brazilian-holidays.seed.spec.ts`
- Create: `backend/prisma/seed-holidays.ts` (script standalone, rodado uma vez por ambiente)

**Interfaces:**
- Produces: `HolidaysService.isHoliday(date: Date): Promise<boolean>` (resolve a empresa atual
  internamente via `CompanyContextService`, mesmo padrão de todo o resto do backend — consumido
  pela Task 7, apuração); `computeEasterSunday(year: number): Date`;
  `getNationalAndMovableHolidays(year: number): { date: Date; name: string }[]`;
  `getStateHolidays(state: string, year: number): { date: Date; name: string }[]`;
  `POST/GET/DELETE /holidays` (customizados da empresa).

- [ ] **Passo 1: Cálculo de feriados nacionais e móveis**

`backend/src/holidays/brazilian-holidays.seed.ts`:
```ts
// Base de referência — feriados nacionais e os estaduais mais amplamente reconhecidos, na data
// desta implementação. NÃO é uma fonte oficial autoatualizável: leis estaduais específicas podem
// mudar; revisar periodicamente. Feriados municipais não são cobertos (inviável manter uma base
// exaustiva) — a empresa complementa via HolidaysController (escopo COMPANY).

// Algoritmo de Gauss/computus anônimo — calcula o Domingo de Páscoa pra qualquer ano do
// calendário gregoriano. Fórmula padrão, sem dependência externa.
export function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function getNationalAndMovableHolidays(year: number): { date: Date; name: string }[] {
  const easter = computeEasterSunday(year);
  return [
    { date: new Date(Date.UTC(year, 0, 1)), name: 'Confraternização Universal' },
    { date: addDays(easter, -47), name: 'Carnaval (segunda-feira)' },
    { date: addDays(easter, -46), name: 'Carnaval (terça-feira)' },
    { date: addDays(easter, -2), name: 'Sexta-feira Santa' },
    { date: addDays(easter, 60), name: 'Corpus Christi' },
    { date: new Date(Date.UTC(year, 3, 21)), name: 'Tiradentes' },
    { date: new Date(Date.UTC(year, 4, 1)), name: 'Dia do Trabalho' },
    { date: new Date(Date.UTC(year, 8, 7)), name: 'Independência do Brasil' },
    { date: new Date(Date.UTC(year, 9, 12)), name: 'Nossa Senhora Aparecida' },
    { date: new Date(Date.UTC(year, 10, 2)), name: 'Finados' },
    { date: new Date(Date.UTC(year, 10, 15)), name: 'Proclamação da República' },
    { date: new Date(Date.UTC(year, 10, 20)), name: 'Consciência Negra (data nacional desde 2023)' },
    { date: new Date(Date.UTC(year, 11, 25)), name: 'Natal' },
  ];
}

// Base curada dos feriados estaduais mais amplamente reconhecidos, por UF — não exaustiva, revisão
// periódica recomendada. Datas fixas por ano (mês/dia); repetidas para cada ano solicitado.
const STATE_HOLIDAYS: Record<string, { month: number; day: number; name: string }[]> = {
  SP: [{ month: 6, day: 9, name: 'Revolução Constitucionalista' }],
  RJ: [{ month: 3, day: 20, name: 'São Jorge' }, { month: 10, day: 28, name: 'Dia do Funcionário Público' }],
  BA: [{ month: 6, day: 2, name: 'Independência da Bahia' }],
  MG: [{ month: 3, day: 21, name: 'Data Magna de Minas Gerais' }],
  // ... demais UFs seguem o mesmo formato; lista completa deve ser expandida durante a
  // implementação consultando uma fonte pública por estado — deixado como TODO explícito de
  // implementação, não como lacuna silenciosa (ver Passo 2 abaixo).
};

export function getStateHolidays(state: string, year: number): { date: Date; name: string }[] {
  const entries = STATE_HOLIDAYS[state.toUpperCase()] ?? [];
  return entries.map((e) => ({ date: new Date(Date.UTC(year, e.month - 1, e.day)), name: e.name }));
}
```

**Nota de implementação obrigatória:** a lista `STATE_HOLIDAYS` acima está deliberadamente
incompleta neste plano (só 4 UFs de exemplo, pra provar o formato) — o implementador desta task
DEVE completar as 27 UFs (26 estados + DF) com pelo menos o feriado estadual mais conhecido de
cada, pesquisando uma fonte pública confiável para cada uma, e documentar no relatório da task
exatamente quais fontes usou e a data em que pesquisou (a mesma exigência de honestidade já
praticada neste projeto para dados que "precisam de revisão periódica"). Nunca inventar uma data
sem checar.

- [ ] **Passo 2: teste do algoritmo de Páscoa e da geração de feriados**

```ts
import { computeEasterSunday, getNationalAndMovableHolidays } from './brazilian-holidays.seed';

describe('brazilian-holidays.seed', () => {
  it('computes known Easter Sundays correctly', () => {
    expect(computeEasterSunday(2024).toISOString().slice(0, 10)).toBe('2024-03-31');
    expect(computeEasterSunday(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
    expect(computeEasterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
  });

  it('generates exactly 13 national/movable holidays for a given year', () => {
    expect(getNationalAndMovableHolidays(2026)).toHaveLength(13);
  });

  it('derives Carnaval and Corpus Christi correctly relative to Easter', () => {
    const holidays = getNationalAndMovableHolidays(2026);
    const carnavalSegunda = holidays.find((h) => h.name.includes('segunda'));
    expect(carnavalSegunda?.date.toISOString().slice(0, 10)).toBe('2026-02-16');
  });
});
```

- [ ] **Passo 3: script de seed (roda uma vez, idempotente)**

`backend/prisma/seed-holidays.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { getNationalAndMovableHolidays, getStateHolidays } from '../src/holidays/brazilian-holidays.seed';

const prisma = new PrismaClient();
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

async function main() {
  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4];

  for (const year of years) {
    for (const h of getNationalAndMovableHolidays(year)) {
      await prisma.holiday.upsert({
        where: { scope_state_companyId_date: { scope: 'NATIONAL', state: null, companyId: null, date: h.date } },
        create: { scope: 'NATIONAL', date: h.date, name: h.name },
        update: { name: h.name },
      });
    }
    for (const uf of UFS) {
      for (const h of getStateHolidays(uf, year)) {
        await prisma.holiday.upsert({
          where: { scope_state_companyId_date: { scope: 'STATE', state: uf, companyId: null, date: h.date } },
          create: { scope: 'STATE', state: uf, date: h.date, name: h.name },
          update: { name: h.name },
        });
      }
    }
  }
  console.log(`Feriados semeados para os anos: ${years.join(', ')}`);
}

main().finally(() => prisma.$disconnect());
```
Adicionar em `backend/package.json`: `"seed:holidays": "ts-node prisma/seed-holidays.ts"`.

- [ ] **Passo 4: `HolidaysService`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyContextService } from '../company/company-context.service';

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // Consumido pela apuração (Task 7): um dia é feriado se bater com o nacional, com o estadual da
  // UF configurada na empresa (Company.state), ou com um customizado da própria empresa.
  async isHoliday(date: Date): Promise<boolean> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const found = await this.prisma.holiday.findFirst({
      where: {
        date,
        OR: [
          { scope: 'NATIONAL' },
          ...(company.state ? [{ scope: 'STATE' as const, state: company.state }] : []),
          { scope: 'COMPANY', companyId },
        ],
      },
    });
    return !!found;
  }

  async createCustom(dto: { date: string; name: string }) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.holiday.create({
      data: { scope: 'COMPANY', companyId, date: new Date(dto.date), name: dto.name },
    });
  }

  async listForCompany() {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return this.prisma.holiday.findMany({
      where: { OR: [{ scope: 'NATIONAL' }, ...(company.state ? [{ scope: 'STATE' as const, state: company.state }] : []), { scope: 'COMPANY', companyId }] },
      orderBy: { date: 'asc' },
    });
  }

  async removeCustom(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const holiday = await this.prisma.holiday.findFirst({ where: { id, scope: 'COMPANY', companyId } });
    if (!holiday) throw new (require('@nestjs/common').NotFoundException)(`Feriado ${id} não encontrado`);
    await this.prisma.holiday.delete({ where: { id } });
  }
}
```

- [ ] **Passo 5: teste de `HolidaysService`, `HolidaysController` (`GET/POST /holidays`, `DELETE /holidays/:id`, gated `@Roles('ADMIN')` + `@RequireModule('RH')`), rodar o seed contra o banco de dev, testes/build/lint, commit**

```bash
cd backend
npm run seed:holidays
npm test
npm run build
npm run lint
git add src/holidays prisma/seed-holidays.ts package.json
git commit -m "feat(backend): add national/state holiday calendar (HolidaysModule)"
```

---

### Task 4: Hierarquia de superior + auto-vínculo admin↔funcionário + serviço de autorização compartilhado

**Files:**
- Modify: `backend/src/employees/employees.service.ts`, `dto/create-employee.dto.ts`, `dto/update-employee.dto.ts`, `employee-response.mapper.ts`
- Modify: `backend/src/auth/auth.controller.ts`, `auth.module.ts`
- Create: `backend/src/auth/auth-employee-link.service.ts` (ou método em `AuthService` — ver nota)
- Create: `backend/src/time-management/time-management-auth.module.ts`
- Create: `backend/src/time-management/time-management-auth.service.ts`
- Create: `backend/src/time-management/time-management-auth.service.spec.ts`

**Interfaces:**
- Produces: `Employee.managerId` (validado: mesma empresa, não pode ser o próprio id, não pode
  criar um ciclo direto de 2 nós onde A gerencia B e B gerencia A); `PATCH /auth/me/employee-link`;
  `TimeManagementAuthService.canManage(currentUser: AuthenticatedUser, targetEmployeeId: string): Promise<boolean>` — `true` se `role === 'ADMIN'`, ou se `currentUser.employeeId` (resolvido via `User`) é o `managerId` direto do funcionário-alvo. `TimeManagementAuthService.resolveOwnEmployee(currentUser: AuthenticatedUser): Promise<Employee>` — resolve o `Employee` vinculado ao login atual (lança `ForbiddenException` se não houver vínculo ou se o funcionário estiver `INACTIVE`). Este é o único lugar do projeto que resolve "o funcionário do login atual" — todo módulo que precisa disso (Tasks 6, 7, 8, 9) injeta `TimeManagementAuthService` e chama este método, em vez de cada um reimplementar a mesma checagem.

- [ ] **Passo 1: `managerId` nos DTOs e serviço de Funcionários**

Em `CreateEmployeeDto`/`UpdateEmployeeDto`, adicionar `@IsOptional() @IsString() managerId?: string`.
Em `EmployeesService.create()`/`update()`, antes de gravar, validar (novo método privado
`assertManagerUsable`): se `managerId` informado, confirma que existe um `Employee` com esse id na
mesma empresa, que `managerId !== id` (não pode ser seu próprio superior), e que o funcionário
apontado por `managerId` não tem, ele mesmo, `managerId` igual ao `id` sendo salvo (ciclo direto de
2 nós — ciclos mais longos ficam como limitação conhecida, documentada, não bloqueada nesta etapa).
Incluir `managerId`/`managerName` (via join) no `employee-response.mapper.ts`, mesmo padrão já
usado para `roleId`/`roleName`.

- [ ] **Passo 2: teste dos novos casos em `employees.service.spec.ts`**

Casos mínimos: aceita `managerId` de um funcionário válido da mesma empresa; rejeita `managerId` de
outra empresa; rejeita `managerId` igual ao próprio `id`; rejeita um ciclo direto de 2 nós.

- [ ] **Passo 3: auto-vínculo `PATCH /auth/me/employee-link`**

Em `AuthController` (mesmo arquivo/padrão de `me`/`me/password`):
```ts
@UseGuards(JwtAuthGuard)
@Patch('me/employee-link')
async linkEmployee(@CurrentUser() user: AuthenticatedUser, @Body() dto: LinkEmployeeDto) {
  return this.auth.linkCurrentUserToEmployee(user.userId, user.companyId, dto.employeeId);
}
```
`LinkEmployeeDto`: `{ @IsString() employeeId: string }`. Em `AuthService`, novo método
`linkCurrentUserToEmployee(userId, companyId, employeeId)`: confirma que o `Employee` existe na
mesma empresa, confirma que ele **não tem nenhum `User` já vinculado** (mesma checagem de
unicidade que `UsersService.create()` já faz pra login `EMPLOYEE`), confirma que o `User` chamador
ainda **não tem** `employeeId` (não permite trocar um vínculo já existente por esta rota — trocar
de funcionário vinculado, se algum dia for necessário, é uma decisão administrativa separada, fora
de escopo), e então faz `prisma.user.update({ where: { id: userId }, data: { employeeId } })`.
Devolve o perfil atualizado (mesmo formato de `getProfile()`).

- [ ] **Passo 4: teste do auto-vínculo, incluindo o caso de rejeição de troca de vínculo já existente**

- [ ] **Passo 5: `TimeManagementAuthService`, compartilhado por toda task administrativa depois desta**

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimeManagementAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async canManage(currentUser: AuthenticatedUser, targetEmployeeId: string): Promise<boolean> {
    if (currentUser.role === 'ADMIN') return true;

    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!currentUserRecord?.employeeId) return false;

    const target = await this.prisma.employee.findFirst({
      where: { id: targetEmployeeId, companyId: currentUser.companyId },
    });
    if (!target) return false;

    return target.managerId === currentUserRecord.employeeId;
  }

  async assertCanManage(currentUser: AuthenticatedUser, targetEmployeeId: string): Promise<void> {
    if (!(await this.canManage(currentUser, targetEmployeeId))) {
      throw new NotFoundException(`Funcionário ${targetEmployeeId} não encontrado`);
      // 404, não 403 — mesmo padrão de "não revelar existência entre escopos não autorizados"
      // já estabelecido em todo o resto do backend (RolesService, ReceivablesService, etc.).
    }
  }

  // Único lugar do projeto que resolve "o Employee vinculado ao login atual" — todo módulo que
  // precisa bater o ponto/gerenciar o próprio ponto (Tasks 6, 7, 8, 9) injeta este serviço e chama
  // este método, em vez de cada um reimplementar a mesma checagem de vínculo/status.
  async resolveOwnEmployee(currentUser: AuthenticatedUser): Promise<Employee> {
    const record = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!record?.employeeId) {
      throw new ForbiddenException('Seu login ainda não está vinculado a um cadastro de funcionário — vincule antes de continuar');
    }
    const employee = await this.prisma.employee.findUnique({ where: { id: record.employeeId } });
    if (!employee || employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Funcionário inativo não pode realizar esta ação');
    }
    return employee;
  }
}
```

- [ ] **Passo 6: teste de `TimeManagementAuthService`**

Casos mínimos: `ADMIN` sempre pode; `EMPLOYEE` que é o `managerId` direto do alvo pode; `EMPLOYEE`
sem `employeeId` (login não vinculado) nunca pode; `EMPLOYEE` de outra empresa nunca pode (o filtro
`companyId` no `findFirst` já garante isso); `EMPLOYEE` que não é superior direto do alvo não pode.
Para `resolveOwnEmployee`: devolve o `Employee` quando o login tem vínculo ativo; lança
`ForbiddenException` quando não há `employeeId` vinculado; lança `ForbiddenException` quando o
`Employee` vinculado está `INACTIVE`.

- [ ] **Passo 7: testes/build/lint, commit**

```bash
cd backend
npm test
npm run build
npm run lint
git add src/employees src/auth src/time-management
git commit -m "feat(backend): add manager hierarchy, admin employee self-link, and shared time-management authorization"
```

---

### Task 5: Configuração administrativa — jornadas, locais de trabalho, configurações da empresa

**Files:**
- Create: `backend/src/work-schedules/{work-schedules.module,work-schedules.service,work-schedules.service.spec,work-schedules.controller}.ts`, `dto/{create,update}-work-schedule.dto.ts`
- Create: `backend/src/work-locations/{work-locations.module,work-locations.service,work-locations.service.spec,work-locations.controller}.ts`, `dto/{create,update}-work-location.dto.ts`
- Create: `backend/src/time-tracking-settings/{time-tracking-settings.module,time-tracking-settings.service,time-tracking-settings.service.spec,time-tracking-settings.controller}.ts`, `dto/update-time-tracking-settings.dto.ts`

**Interfaces:**
- Consumes: `CompanyContextService`, `ModulesGuard`/`@RequireModule('RH')`, `@Roles('ADMIN')`.
- Produces: `WorkSchedulesService`/`WorkLocationsService` (CRUD completo, mesmo padrão de
  `RolesService` — `assertExists` escopado por `companyId`, paginação/filtro em `findAll`);
  `TimeTrackingSettingsService.getOrCreateDefault(companyId)` / `.update(dto)` (upsert — só uma
  linha por empresa); rotas `GET/POST/PATCH/DELETE /work-schedules`,
  `GET/POST/PATCH/DELETE /work-locations`, `GET/PATCH /time-tracking-settings`.

- [ ] **Passo 1: `WorkSchedulesModule` — espelhar exatamente `RolesModule`/`RolesService`/`RolesController`**

Ler `backend/src/roles/roles.service.ts` e `roles.controller.ts` (já lidos nesta sessão) como
referência estrutural exata: mesmo padrão de `assertExists` privado, `findAll` paginado com
`search`, `create`/`update` validando antes de gravar. Diferenças específicas de `WorkSchedule`:
- `create`/`update` recebem `employeeId` no corpo (não é "meu próprio recurso" — é o admin
  configurando a jornada de outro funcionário) — validar que o `Employee` referenciado existe na
  mesma empresa (mesmo padrão de `assertRoleUsable` em `EmployeesService`).
- Validar `expectedStartTime`/`expectedEndTime` no formato `HH:mm` (regex simples,
  `/^([01]\d|2[0-3]):[0-5]\d$/`) via `@Matches` no DTO.
- Validar `weekDays` como array de inteiros `0-6`, sem repetição.
- Restringir mutação a `@Roles('ADMIN')` (jornada é configuração de empresa, não delegada ao
  superior direto nesta etapa — decisão registrada aqui, não pré-aprovada na spec, mas
  razoável dentro do silêncio da spec sobre este ponto específico; documentar no relatório da task).
- Endpoint de leitura (`GET /work-schedules?employeeId=`) liberado também pro superior direto via
  `TimeManagementAuthService.canManage` (não só `ADMIN`), já que ele precisa ver a jornada do
  subordinado pra fazer sentido de qualquer inconsistência.

- [ ] **Passo 2: teste de `WorkSchedulesService`**

Casos mínimos: cria jornada válida; rejeita `employeeId` de outra empresa; rejeita horário fora do
formato `HH:mm`; rejeita `weekDays` com valor fora de 0-6; lista filtrando por `employeeId`.

- [ ] **Passo 3: `WorkLocationsModule` — espelhar o mesmo padrão, mais simples (sem vínculo a funcionário, é da empresa toda)**

CRUD direto: `id, companyId, name, latitude, longitude, radiusMeters, active`. `@Roles('ADMIN')`
em toda mutação, leitura liberada pra qualquer login com módulo `RH`. Além do CRUD padrão,
`WorkLocationsService` produz um método extra, consumido pela Task 6 (`TimeClockService`, batida):
```ts
findAllActive(): Promise<WorkLocation[]> {
  return this.companyContext.getCurrentCompanyId().then((companyId) =>
    this.prisma.workLocation.findMany({ where: { companyId, active: true } }),
  );
}
```

- [ ] **Passo 4: teste de `WorkLocationsService`**, incluindo `findAllActive()` (devolve só os
ativos da empresa atual, nunca de outra empresa).

- [ ] **Passo 5: `TimeTrackingSettingsModule` — upsert de linha única por empresa**

```ts
async getOrCreateDefault(companyId: string) {
  const existing = await this.prisma.timeTrackingSettings.findUnique({ where: { companyId } });
  if (existing) return existing;
  return this.prisma.timeTrackingSettings.create({ data: { companyId } }); // todos os defaults do schema
}

async update(dto: UpdateTimeTrackingSettingsDto) {
  const companyId = await this.companyContext.getCurrentCompanyId();
  await this.getOrCreateDefault(companyId);
  return this.prisma.timeTrackingSettings.update({ where: { companyId }, data: dto });
}
```
`@Roles('ADMIN')` em `PATCH`, leitura liberada pra qualquer login com módulo `RH` (o frontend do
funcionário também precisa saber se foto/localização são obrigatórias antes de bater o ponto).

- [ ] **Passo 6: teste de `TimeTrackingSettingsService`, testes/build/lint, commit**

```bash
cd backend
npm test
npm run build
npm run lint
git add src/work-schedules src/work-locations src/time-tracking-settings
git commit -m "feat(backend): add work schedule, work location, and time-tracking settings admin config"
```

---

### Task 6: Núcleo da batida — `TimeClockModule` (status + criação de evento)

**Files:**
- Create: `backend/src/time-clock/time-clock.module.ts`
- Create: `backend/src/time-clock/time-clock.service.ts`
- Create: `backend/src/time-clock/time-clock.service.spec.ts`
- Create: `backend/src/time-clock/time-clock.controller.ts`
- Create: `backend/src/time-clock/time-sequence.util.ts`
- Create: `backend/src/time-clock/time-sequence.util.spec.ts`
- Create: `backend/src/time-clock/geo-distance.util.ts`
- Create: `backend/src/time-clock/geo-distance.util.spec.ts`
- Create: `backend/src/time-clock/dto/create-punch.dto.ts`

**Interfaces:**
- Consumes: `FilesService.upload()`, `WorkLocationsService`, `TimeTrackingSettingsService`.
- Produces: `TimeSequenceValidator.getNextAllowedType(lastEvents: TimeEvent[]): TimeEventType | null`
  e `.validateTransition(lastEvents, requestedType): 'VALID' | 'INVALID' | 'PENDING_REVIEW'`;
  `haversineDistanceMeters(lat1, lon1, lat2, lon2): number`; rotas `GET /time-clock/status`,
  `POST /time-clock/punches`, `GET /time-clock/punches`.

- [ ] **Passo 1: máquina de estados da sequência (função pura, testável isoladamente)**

```ts
import { TimeEventType } from '@prisma/client';

// Não é uma sequência posicional fixa — decide a partir do ÚLTIMO evento aberto do funcionário.
// "Aberto" = ainda não teve seu par de fechamento (CLOCK_IN sem CLOCK_OUT, BREAK_START sem
// BREAK_END, EXTRA_IN sem EXTRA_OUT) considerando TODOS os eventos do dia/jornada corrente, na
// ordem em que ocorreram — não só o último evento isolado.
export interface OpenState {
  clockOpen: boolean;
  breakOpen: boolean;
  extraOpen: boolean;
}

export function computeOpenState(eventsInOrder: { type: TimeEventType }[]): OpenState {
  let clockOpen = false;
  let breakOpen = false;
  let extraOpen = false;
  for (const e of eventsInOrder) {
    switch (e.type) {
      case 'CLOCK_IN': clockOpen = true; break;
      case 'CLOCK_OUT': clockOpen = false; break;
      case 'BREAK_START': breakOpen = true; break;
      case 'BREAK_END': breakOpen = false; break;
      case 'EXTRA_IN': extraOpen = true; break;
      case 'EXTRA_OUT': extraOpen = false; break;
    }
  }
  return { clockOpen, breakOpen, extraOpen };
}

export function getNextAllowedType(state: OpenState, allowExtraPeriods: boolean): TimeEventType | null {
  if (!state.clockOpen) return 'CLOCK_IN';
  if (state.breakOpen) return 'BREAK_END';
  if (state.extraOpen) return 'EXTRA_OUT';
  if (!state.clockOpen) return null;
  // Jornada aberta, sem intervalo/extra em andamento: pode sair, começar intervalo, ou (se
  // permitido) iniciar período extra.
  return 'CLOCK_OUT'; // o front oferece as outras opções (BREAK_START/EXTRA_IN) como alternativas,
  // ver validateTransition abaixo para a lista completa de transições válidas neste estado.
}

export function validateTransition(
  state: OpenState,
  requestedType: TimeEventType,
  allowExtraPeriods: boolean,
): 'VALID' | 'INVALID' {
  if (requestedType === 'CLOCK_IN') return state.clockOpen ? 'INVALID' : 'VALID';
  if (requestedType === 'CLOCK_OUT') return state.clockOpen && !state.breakOpen && !state.extraOpen ? 'VALID' : 'INVALID';
  if (requestedType === 'BREAK_START') return state.clockOpen && !state.breakOpen && !state.extraOpen ? 'VALID' : 'INVALID';
  if (requestedType === 'BREAK_END') return state.breakOpen ? 'VALID' : 'INVALID';
  if (requestedType === 'EXTRA_IN') return allowExtraPeriods && state.clockOpen && !state.breakOpen && !state.extraOpen ? 'VALID' : 'INVALID';
  if (requestedType === 'EXTRA_OUT') return state.extraOpen ? 'VALID' : 'INVALID';
  return 'INVALID';
}
```

- [ ] **Passo 2: teste de `time-sequence.util.ts`**

Casos mínimos (todos os cenários de sequência inválida listados na spec): `CLOCK_IN` duas vezes
seguidas sem `CLOCK_OUT` é inválido; `BREAK_END` sem `BREAK_START` é inválido; `CLOCK_OUT` sem
jornada aberta é inválido; `EXTRA_IN` com outro período já aberto é inválido; `EXTRA_IN` quando
`allowExtraPeriods=false` é inválido mesmo com jornada aberta; sequência completa
`CLOCK_IN→BREAK_START→BREAK_END→CLOCK_OUT` é válida em cada passo; jornada com múltiplos intervalos
(`BREAK_START→BREAK_END→BREAK_START→BREAK_END`) é válida.

- [ ] **Passo 3: distância geográfica (Haversine)**

```ts
export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

- [ ] **Passo 4: teste de `geo-distance.util.ts`** (distância conhecida entre dois pontos reais, ex. dois pontos na mesma cidade com distância aproximada verificável).

- [ ] **Passo 5: `TimeClockService`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CompanyContextService } from '../company/company-context.service';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { TimeTrackingSettingsService } from '../time-tracking-settings/time-tracking-settings.service';
import { WorkLocationsService } from '../work-locations/work-locations.service';
import { CreatePunchDto } from './dto/create-punch.dto';
import { haversineDistanceMeters } from './geo-distance.util';
import { computeOpenState, getNextAllowedType, validateTransition } from './time-sequence.util';

const DUPLICATE_WINDOW_MS = 10_000; // bloqueio de curto prazo contra clique duplo/requisição repetida

// "Resolver meu próprio Employee vinculado" (assert de vínculo + status ACTIVE) NÃO é
// reimplementado aqui — vem de TimeManagementAuthService.resolveOwnEmployee (Task 4), o único
// lugar do projeto que faz essa checagem, reutilizado também pelas Tasks 7/8/9.
@Injectable()
export class TimeClockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly files: FilesService,
    private readonly settings: TimeTrackingSettingsService,
    private readonly workLocations: WorkLocationsService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  private async getTodayOpenState(employeeId: string) {
    // "Hoje" pra fins de sequência olha as últimas 24h de eventos, não a data civil — cobre
    // jornada que atravessa a meia-noite sem confundir com o dia civil seguinte.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const events = await this.prisma.timeEvent.findMany({
      where: { employeeId, serverRecordedAt: { gte: since } },
      orderBy: { serverRecordedAt: 'asc' },
    });
    return { events, state: computeOpenState(events) };
  }

  async getStatus(user: AuthenticatedUser) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    const settings = await this.settings.getOrCreateDefault(user.companyId);
    const { state } = await this.getTodayOpenState(employee.id);
    return {
      nextAllowedType: getNextAllowedType(state, settings.allowExtraPeriods),
      requirePhoto: settings.requirePhoto,
      requireLocation: settings.requireLocation,
    };
  }

  async createPunch(
    user: AuthenticatedUser,
    dto: CreatePunchDto,
    photo: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
  ) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    const settings = await this.settings.getOrCreateDefault(user.companyId);

    // Bloqueio de curto prazo contra duplo clique / requisição repetida (inclusive de dois
    // dispositivos quase simultâneos).
    const recent = await this.prisma.timeEvent.findFirst({
      where: { employeeId: employee.id, serverRecordedAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      orderBy: { serverRecordedAt: 'desc' },
    });
    if (recent) throw new BadRequestException('Aguarde alguns segundos antes de registrar outra marcação');

    const { events, state } = await this.getTodayOpenState(employee.id);
    const outcome = validateTransition(state, dto.type, settings.allowExtraPeriods);
    if (outcome === 'INVALID') {
      throw new BadRequestException(`Não é possível registrar "${dto.type}" no estado atual da jornada`);
    }

    if (settings.requirePhoto && !photo) {
      throw new BadRequestException('Foto obrigatória para registrar o ponto');
    }
    if (settings.requireLocation && dto.latitude == null) {
      if (!settings.allowLocationException) {
        throw new BadRequestException('Localização obrigatória para registrar o ponto');
      }
    }

    let locationStatus: 'WITHIN_RANGE' | 'OUT_OF_RANGE' | 'IMPRECISE' | 'UNAVAILABLE' | 'NOT_REQUIRED' = 'NOT_REQUIRED';
    let workLocationId: string | null = null;
    if (dto.latitude != null && dto.longitude != null) {
      const activeLocations = await this.workLocations.findAllActive();
      if (activeLocations.length > 0) {
        const match = activeLocations.find(
          (loc) => haversineDistanceMeters(dto.latitude!, dto.longitude!, Number(loc.latitude), Number(loc.longitude)) <= loc.radiusMeters,
        );
        locationStatus = match ? 'WITHIN_RANGE' : 'OUT_OF_RANGE';
        workLocationId = match?.id ?? null;
      }
    } else if (settings.requireLocation) {
      locationStatus = 'UNAVAILABLE';
    }

    let photoAssetId: string | null = null;
    if (photo) {
      const asset = await this.files.upload(user.companyId, user.userId, photo, 'TIME_PUNCH_PHOTO', settings.maxAttachmentSizeBytes);
      photoAssetId = asset.id;
    }

    const validationStatus =
      outcome === 'PENDING_REVIEW' || locationStatus === 'OUT_OF_RANGE' || (locationStatus === 'UNAVAILABLE' && settings.allowLocationException)
        ? 'PENDING_REVIEW'
        : 'VALID';

    const event = await this.prisma.timeEvent.create({
      data: {
        companyId: user.companyId,
        employeeId: employee.id,
        type: dto.type,
        source: dto.isMobile ? 'MOBILE' : 'WEB',
        deviceReportedAt: dto.deviceReportedAt ? new Date(dto.deviceReportedAt) : undefined,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyMeters: dto.accuracyMeters,
        locationStatus,
        workLocationId,
        photoAssetId,
        validationStatus,
      },
    });

    const { state: newState } = await this.getTodayOpenState(employee.id);
    return { event, nextAllowedType: getNextAllowedType(newState, settings.allowExtraPeriods) };
  }

  async listOwnPunches(user: AuthenticatedUser, from?: string, to?: string) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    return this.prisma.timeEvent.findMany({
      where: {
        employeeId: employee.id,
        ...(from || to ? { serverRecordedAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } } : {}),
      },
      orderBy: { serverRecordedAt: 'desc' },
    });
  }
}
```

- [ ] **Passo 6: `CreatePunchDto`**

```ts
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional } from 'class-validator';
import { TimeEventType } from '@prisma/client';

export class CreatePunchDto {
  @IsEnum(TimeEventType) type!: TimeEventType;
  @IsOptional() @IsISO8601() deviceReportedAt?: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() accuracyMeters?: number;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isMobile?: boolean;
}
```

- [ ] **Passo 7: teste de `TimeClockService`**

Mockar `PrismaService`/`FilesService`/`TimeTrackingSettingsService`/`WorkLocationsService`. Casos
mínimos (todos listados na seção "Testes obrigatórios" da spec): funcionário registra o próprio
ponto; rejeição de funcionário inativo; rejeição de login sem `employeeId` vinculado; prevenção de
batida duplicada dentro da janela de bloqueio; sequência válida completa com intervalo; sequência
inválida (duas entradas seguidas); jornada com hora extra permitida/rejeitada conforme
`allowExtraPeriods`; localização dentro do raio; localização fora do raio (grava mas sinaliza);
localização ausente quando obrigatória sem exceção (rejeita); localização ausente quando obrigatória
com exceção (grava como `PENDING_REVIEW`); foto ausente quando obrigatória (rejeita).

- [ ] **Passo 8: `TimeClockController`**

```ts
import { Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreatePunchDto } from './dto/create-punch.dto';
import { TimeClockService } from './time-clock.service';

// Sem @RequireModule aqui de propósito: bater o próprio ponto não depende de módulo — é uma ação
// de "quem sou eu", não de "o que meu login pode administrar" (mesmo espírito de /auth/me).
@Controller('time-clock')
export class TimeClockController {
  constructor(private readonly timeClock: TimeClockService) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.timeClock.getStatus(user);
  }

  @Post('punches')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 8 * 1024 * 1024 } }))
  createPunch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePunchDto,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    return this.timeClock.createPunch(user, dto, photo);
  }

  @Get('punches')
  listOwnPunches(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeClock.listOwnPunches(user, from, to);
  }
}
```

- [ ] **Passo 9: testes/build/lint, commit**

```bash
cd backend
npm test
npm run build
npm run lint
git add src/time-clock
git commit -m "feat(backend): add TimeClockModule (punch sequence state machine, geofencing, photo)"
```

---

### Task 7: Apuração de carga horária + resumo do funcionário

**Files:**
- Create: `backend/src/time-clock/time-attendance-calculation.service.ts`
- Create: `backend/src/time-clock/time-attendance-calculation.service.spec.ts`
- Modify: `backend/src/time-clock/time-clock.controller.ts`, `time-clock.module.ts`

**Interfaces:**
- Consumes: `HolidaysService.isHoliday()`, `VacationSchedule`/`LeaveSchedule` (consulta direta, sem
  duplicar lógica), `WorkSchedule` vigente na data.
- Produces: `TimeAttendanceCalculationService.calculateDailySummary(employeeId, date): Promise<DailySummary>`
  e `.calculateMonthlySummary(employeeId, year, month): Promise<MonthlySummary>`; rota
  `GET /time-clock/summary?month=&year=`.

- [ ] **Passo 1: `TimeAttendanceCalculationService` — pareamento por tipo, não por posição**

```ts
import { Injectable } from '@nestjs/common';
import { TimeEvent, TimeEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysService } from '../holidays/holidays.service';

export interface DailySummary {
  date: string;
  workedMinutes: number;
  expectedMinutes: number;
  breakMinutes: number;
  extraMinutes: number;
  balanceMinutes: number; // workedMinutes - expectedMinutes
  isHoliday: boolean;
  isOnVacationOrLeave: boolean;
  hasOpenJourney: boolean; // CLOCK_IN sem CLOCK_OUT correspondente
  events: TimeEvent[];
}

@Injectable()
export class TimeAttendanceCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holidays: HolidaysService,
  ) {}

  // Pareia por TIPO em sequência (CLOCK_IN->CLOCK_OUT, BREAK_START->BREAK_END,
  // EXTRA_IN->EXTRA_OUT), nunca por posição no array — corrige o bug real do mock anterior.
  private pairEvents(events: TimeEvent[]) {
    const sorted = [...events].sort((a, b) => a.serverRecordedAt.getTime() - b.serverRecordedAt.getTime());
    let workedMs = 0;
    let breakMs = 0;
    let extraMs = 0;
    let openClockIn: TimeEvent | null = null;
    let openBreakStart: TimeEvent | null = null;
    let openExtraIn: TimeEvent | null = null;

    for (const e of sorted) {
      if (e.type === 'CLOCK_IN') openClockIn = e;
      if (e.type === 'CLOCK_OUT' && openClockIn) {
        workedMs += e.serverRecordedAt.getTime() - openClockIn.serverRecordedAt.getTime();
        openClockIn = null;
      }
      if (e.type === 'BREAK_START') openBreakStart = e;
      if (e.type === 'BREAK_END' && openBreakStart) {
        breakMs += e.serverRecordedAt.getTime() - openBreakStart.serverRecordedAt.getTime();
        openBreakStart = null;
      }
      if (e.type === 'EXTRA_IN') openExtraIn = e;
      if (e.type === 'EXTRA_OUT' && openExtraIn) {
        extraMs += e.serverRecordedAt.getTime() - openExtraIn.serverRecordedAt.getTime();
        openExtraIn = null;
      }
    }

    return {
      workedMinutes: Math.round((workedMs - breakMs) / 60000),
      breakMinutes: Math.round(breakMs / 60000),
      extraMinutes: Math.round(extraMs / 60000),
      hasOpenJourney: openClockIn !== null,
    };
  }

  // Busca a WorkSchedule vigente NA DATA (validFrom <= data <= validTo OU validTo nulo).
  private async getScheduleForDate(employeeId: string, date: Date) {
    return this.prisma.workSchedule.findFirst({
      where: { employeeId, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
      orderBy: { validFrom: 'desc' },
    });
  }

  async calculateDailySummary(employeeId: string, date: Date): Promise<DailySummary> {
    // Janela de 24h a partir do início do dia local — cobre jornada que atravessa a meia-noite
    // sem cortar eventos no meio.
    const startWindow = new Date(date);
    const endWindow = new Date(date.getTime() + 24 * 60 * 60 * 1000);

    const [events, schedule, isHoliday, vacation, leave] = await Promise.all([
      this.prisma.timeEvent.findMany({ where: { employeeId, serverRecordedAt: { gte: startWindow, lt: endWindow } } }),
      this.getScheduleForDate(employeeId, date),
      this.holidays.isHoliday(date),
      this.prisma.vacationSchedule.findFirst({ where: { employeeId, startDate: { lte: date }, endDate: { gte: date }, status: { not: 'CANCELLED' } } }),
      this.prisma.leaveSchedule.findFirst({ where: { employeeId, startDate: { lte: date }, endDate: { gte: date }, status: { not: 'CANCELLED' } } }),
    ]);

    const paired = this.pairEvents(events);
    const expectedMinutes = schedule && !isHoliday && !vacation && !leave ? schedule.dailyMinutes : 0;

    return {
      date: date.toISOString().slice(0, 10),
      workedMinutes: paired.workedMinutes,
      expectedMinutes,
      breakMinutes: paired.breakMinutes,
      extraMinutes: paired.extraMinutes,
      balanceMinutes: paired.workedMinutes - expectedMinutes,
      isHoliday,
      isOnVacationOrLeave: !!vacation || !!leave,
      hasOpenJourney: paired.hasOpenJourney,
      events,
    };
  }

  async calculateMonthlySummary(employeeId: string, year: number, month: number) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days: DailySummary[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(year, month - 1, d));
      if (date.getTime() > Date.now()) break; // não gera dias futuros
      days.push(await this.calculateDailySummary(employeeId, date));
    }
    const totals = days.reduce(
      (acc, d) => ({
        workedMinutes: acc.workedMinutes + d.workedMinutes,
        expectedMinutes: acc.expectedMinutes + d.expectedMinutes,
        extraMinutes: acc.extraMinutes + d.extraMinutes,
        balanceMinutes: acc.balanceMinutes + d.balanceMinutes,
      }),
      { workedMinutes: 0, expectedMinutes: 0, extraMinutes: 0, balanceMinutes: 0 },
    );
    return { days, totals };
  }
}
```

- [ ] **Passo 2: teste de `TimeAttendanceCalculationService`**

Casos mínimos (seção "Apuração" da spec): cálculo de períodos trabalhados; desconto correto de
intervalos (múltiplos pares `BREAK_START`/`BREAK_END`); jornada incompleta (`CLOCK_IN` sem
`CLOCK_OUT` → `hasOpenJourney: true`, não conta como trabalhado); hora extra (par
`EXTRA_IN`/`EXTRA_OUT` soma em `extraMinutes`, não em `workedMinutes`); turno noturno atravessando
a meia-noite (jornada iniciada às 22h com `CLOCK_OUT` às 06h do dia seguinte, dentro da janela de
24h); feriado zera `expectedMinutes`; férias/afastamento zeram `expectedMinutes` mesmo sem feriado.

- [ ] **Passo 3: rota `GET /time-clock/summary`**

`TimeClockController` ganha `TimeManagementAuthService` injetado (mesmo serviço da Task 4):
```ts
@Get('summary')
async getSummary(@CurrentUser() user: AuthenticatedUser, @Query('year') year: string, @Query('month') month: string) {
  const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
  return this.calculation.calculateMonthlySummary(employee.id, Number(year), Number(month));
}
```

- [ ] **Passo 4: testes/build/lint, commit**

```bash
cd backend
npm test
npm run build
npm run lint
git add src/time-clock
git commit -m "feat(backend): add attendance calculation service (type-paired, midnight-safe, holiday/vacation-aware)"
```

---

### Task 8: Solicitações de ajuste — criação, cancelamento, aprovação/rejeição, correção proativa

**Files:**
- Create: `backend/src/time-adjustments/{time-adjustments.module,time-adjustments.service,time-adjustments.service.spec,time-adjustments.controller}.ts`
- Create: `backend/src/time-adjustments/dto/{create-adjustment-request,review-adjustment-request,proactive-correction}.dto.ts`

**Interfaces:**
- Consumes: `TimeManagementAuthService.assertCanManage()` e `.resolveOwnEmployee()` (Task 4 —
  `TimeAdjustmentsService` injeta `TimeManagementAuthService` no construtor, mesmo padrão de
  `TimeClockService` na Task 6), `runTenantInteractiveTransaction`, `FilesService.upload()`.
- Produces: `POST /time-adjustment-requests`, `GET /time-adjustment-requests/me`,
  `PATCH /time-adjustment-requests/:id/cancel`, `GET /time-adjustment-requests` (admin/superior,
  paginado/filtrado por status), `PATCH /time-adjustment-requests/:id/approve|reject`,
  `POST /employees/:employeeId/time-events/correct` (correção proativa).

- [ ] **Passo 1: `TimeAdjustmentsService` — criação e cancelamento (funcionário)**

```ts
async create(user: AuthenticatedUser, dto: CreateAdjustmentRequestDto, attachment?: MulterFile) {
  const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
  let attachmentAssetId: string | undefined;
  if (attachment) {
    const asset = await this.files.upload(user.companyId, user.userId, attachment, 'ADJUSTMENT_ATTACHMENT');
    attachmentAssetId = asset.id;
  }
  return this.prisma.timeAdjustmentRequest.create({
    data: {
      companyId: user.companyId,
      employeeId: employee.id,
      targetDate: new Date(dto.targetDate),
      relatedEventId: dto.relatedEventId,
      type: dto.type,
      requestedEventType: dto.requestedEventType,
      requestedTime: dto.requestedTime ? new Date(dto.requestedTime) : undefined,
      reason: dto.reason,
      justification: dto.justification,
      attachmentAssetId,
    },
  });
}

async cancel(user: AuthenticatedUser, id: string) {
  const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
  const request = await this.prisma.timeAdjustmentRequest.findFirst({ where: { id, employeeId: employee.id } });
  if (!request) throw new NotFoundException(`Solicitação ${id} não encontrada`);
  if (request.status !== 'PENDING') throw new ConflictException('Só é possível cancelar solicitações pendentes');
  return this.prisma.timeAdjustmentRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
}
```

- [ ] **Passo 2: aprovação — transação única (criar `TimeEvent` + `TimeCorrection` + atualizar status)**

```ts
async approve(user: AuthenticatedUser, id: string, reviewNote: string | undefined) {
  const request = await this.prisma.timeAdjustmentRequest.findFirst({ where: { id, companyId: user.companyId } });
  if (!request) throw new NotFoundException(`Solicitação ${id} não encontrada`);
  await this.timeManagementAuth.assertCanManage(user, request.employeeId);
  if (request.status !== 'PENDING') {
    throw new ConflictException('Esta solicitação já foi processada e não pode ser aprovada novamente');
  }

  let originalValue: unknown = null;
  if (request.relatedEventId) {
    const original = await this.prisma.timeEvent.findUnique({ where: { id: request.relatedEventId } });
    originalValue = original ? { type: original.type, serverRecordedAt: original.serverRecordedAt } : null;
  }

  return runTenantInteractiveTransaction(this.prisma, async (tx) => {
    const correctedEvent = await tx.timeEvent.create({
      data: {
        companyId: request.companyId,
        employeeId: request.employeeId,
        type: request.requestedEventType ?? 'CLOCK_IN',
        source: 'ADMIN_MANUAL',
        serverRecordedAt: request.requestedTime ?? new Date(),
        validationStatus: 'CORRECTED',
      },
    });
    const correction = await tx.timeCorrection.create({
      data: {
        companyId: request.companyId,
        adjustmentRequestId: request.id,
        originalEventId: request.relatedEventId,
        originalValue,
        correctedEventId: correctedEvent.id,
        correctedValue: { type: correctedEvent.type, serverRecordedAt: correctedEvent.serverRecordedAt },
        requestedByEmployeeId: request.employeeId,
        reviewedByUserId: user.userId,
        reason: reviewNote ?? request.reason,
      },
    });
    await tx.timeAdjustmentRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedByUserId: user.userId, reviewNote, reviewedAt: new Date() },
    });
    return correction;
  });
}

async reject(user: AuthenticatedUser, id: string, reviewNote: string) {
  const request = await this.prisma.timeAdjustmentRequest.findFirst({ where: { id, companyId: user.companyId } });
  if (!request) throw new NotFoundException(`Solicitação ${id} não encontrada`);
  await this.timeManagementAuth.assertCanManage(user, request.employeeId);
  if (request.status !== 'PENDING') {
    throw new ConflictException('Esta solicitação já foi processada e não pode ser rejeitada novamente');
  }
  if (!reviewNote) throw new BadRequestException('Motivo da rejeição é obrigatório');
  return this.prisma.timeAdjustmentRequest.update({
    where: { id },
    data: { status: 'REJECTED', reviewedByUserId: user.userId, reviewNote, reviewedAt: new Date() },
  });
}
```

- [ ] **Passo 3: correção proativa (sem solicitação prévia) — mesma trilha de auditoria**

```ts
async proactiveCorrect(user: AuthenticatedUser, employeeId: string, dto: ProactiveCorrectionDto) {
  await this.timeManagementAuth.assertCanManage(user, employeeId);
  const request = await this.prisma.timeAdjustmentRequest.create({
    data: {
      companyId: user.companyId,
      employeeId,
      targetDate: new Date(dto.targetDate),
      relatedEventId: dto.relatedEventId,
      type: dto.type,
      requestedEventType: dto.requestedEventType,
      requestedTime: dto.requestedTime ? new Date(dto.requestedTime) : undefined,
      reason: dto.reason, // obrigatório no DTO — sem exceção
      status: 'PENDING', // criado PENDING e imediatamente aprovado logo abaixo, reaproveitando
      // o mesmo método approve() — nunca um caminho de escrita "silencioso" separado.
    },
  });
  return this.approve(user, request.id, dto.reason);
}
```

- [ ] **Passo 4: teste de `TimeAdjustmentsService`**

Casos mínimos (seção "Ajustes" da spec): funcionário cria solicitação; funcionário não tem nenhum
endpoint pra alterar `TimeEvent` diretamente (confirmado pela ausência de rota, não por teste
unitário — anotar no relatório); superior direto da mesma empresa aprova; superior/admin de outra
empresa não acessa (404); solicitação rejeitada exige motivo; solicitação já processada não é
reprocessada (aprovar ou rejeitar uma segunda vez lança `ConflictException`); registro original é
preservado (o `TimeEvent` antigo, se existir, nunca é alterado/apagado — só um novo é criado);
aprovação gera `TimeCorrection` auditável com valores antes/depois.

- [ ] **Passo 5: `TimeAdjustmentsController` — rotas de funcionário e administrativas, paginação/filtro nas listagens administrativas**

- [ ] **Passo 6: testes/build/lint, commit**

```bash
cd backend
npm test
npm run build
npm run lint
git add src/time-adjustments
git commit -m "feat(backend): add TimeAdjustmentsModule (request/approve/reject/proactive correction with audit trail)"
```

---

### Task 9: Justificativas e atestados

**Files:**
- Create: `backend/src/time-justifications/{time-justifications.module,time-justifications.service,time-justifications.service.spec,time-justifications.controller}.ts`
- Create: `backend/src/time-justifications/dto/{create-justification,review-justification}.dto.ts`

**Interfaces:**
- Consumes: `TimeManagementAuthService.assertCanManage()` e `.resolveOwnEmployee()` (Task 4 —
  injetado no construtor, mesmo padrão de `TimeAdjustmentsService` na Task 8 — nunca reimplementar
  essa checagem aqui), `FilesService.upload()`.
- Produces: `POST /time-justifications` (multipart, anexo opcional/obrigatório conforme
  `type`), `GET /time-justifications/me`, `GET /time-justifications` (admin/superior),
  `PATCH /time-justifications/:id/approve|reject`.

- [ ] **Passo 1: `TimeJustificationsService` — mesmo padrão de `TimeAdjustmentsService`, sem efeito colateral em `TimeEvent`**

`create`: `MEDICAL_CERTIFICATE` exige anexo (`BadRequestException` se ausente); demais tipos,
anexo opcional. `approve`/`reject`: só atualiza `status`/`reviewedByUserId`/`reviewNote`/`reviewedAt`
— **nunca** cria/altera `TimeEvent` (diferente de `TimeAdjustmentsService` de propósito — uma
justificativa aprovada não corrige automaticamente nada, é só um registro analisado). Envio nunca
aprova automaticamente (status sempre nasce `PENDING`, independente de ter anexo ou não).

- [ ] **Passo 2: teste de `TimeJustificationsService`**

Casos mínimos (seção "Justificativas e arquivos" da spec): upload válido; rejeição de formato
inválido (delegado ao `FilesService`, já testado na Task 2 — aqui só confirma que o erro propaga);
rejeição de arquivo acima do limite; proteção contra acesso de terceiros (via `GET /file-assets/:id`
já testado na Task 2, aqui confirma que `attachmentAssetId` só é resolvido pra quem tem
`canManage`); envio não aprova automaticamente; preservação do histórico (justificativa rejeitada
continua existindo, nunca é apagada).

- [ ] **Passo 3: `TimeJustificationsController`, testes/build/lint, commit**

```bash
cd backend
npm test
npm run build
npm run lint
git add src/time-justifications
git commit -m "feat(backend): add TimeJustificationsModule"
```

---

### Task 10: Visões administrativas agregadas + validação final do backend

**Files:**
- Modify: `backend/src/employees/employees.controller.ts` (novas rotas aninhadas)
- Create: `backend/src/time-clock/dto/query-time-events.dto.ts`
- Modify: `backend/src/app.module.ts` (registrar todos os módulos novos)

**Interfaces:**
- Produces: `GET /employees/:employeeId/time-events` (paginado/filtrado por período/status,
  `TimeManagementAuthService.assertCanManage`), `GET /employees/:employeeId/time-summary`,
  `GET /time-events/inconsistencies` (todas as `PENDING_REVIEW` que o login atual pode gerenciar —
  a própria empresa inteira se `ADMIN`, só subordinados diretos se superior).

- [ ] **Passo 1: rotas administrativas agregadas**, reaproveitando `TimeAttendanceCalculationService`/`TimeClockService`/`TimeManagementAuthService` já prontos — sem nenhuma lógica de negócio nova, só composição.

- [ ] **Passo 2: registrar todos os módulos novos em `AppModule`**

```ts
// Adicionar aos imports de backend/src/app.module.ts:
FilesModule, HolidaysModule, WorkSchedulesModule, WorkLocationsModule,
TimeTrackingSettingsModule, TimeClockModule, TimeAdjustmentsModule, TimeJustificationsModule,
```

- [ ] **Passo 3: validação final do backend**

```bash
cd backend
npx prisma migrate status
npm test
npm run build
npm run lint
npm run test:e2e
```
Rodar também um percurso manual real (servidor + Postgres reais): registrar duas empresas, criar
funcionários com hierarquia (`managerId`), configurar jornada/local de trabalho, bater ponto
completo (com foto/localização reais via navegador), criar uma solicitação de ajuste, aprovar como
superior direto, confirmar isolamento entre empresas em todas as rotas novas (mesmo padrão de
verificação cruzada já usado em toda auditoria/plano anterior deste projeto).

- [ ] **Passo 4: commit**

```bash
git add backend/src/app.module.ts backend/src/employees
git commit -m "feat(backend): wire Time Tracking modules into AppModule; add aggregated admin views"
```

---

### Task 11: Frontend — funções de API (`src/lib/api.ts`)

**Files:**
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: `getTimeClockStatus`, `createTimePunch` (multipart), `listOwnTimePunches`,
  `getOwnTimeSummary`, `createAdjustmentRequest`, `listOwnAdjustmentRequests`,
  `cancelAdjustmentRequest`, `createJustification`, `listOwnJustifications`,
  `listCompanyTimeEvents`, `listPendingAdjustmentRequests`, `approveAdjustmentRequest`,
  `rejectAdjustmentRequest`, `proactiveCorrection`, `listJustificationsForReview`,
  `reviewJustification`, `listTimeInconsistencies`, `listWorkSchedules`, `createWorkSchedule`,
  `updateWorkSchedule`, `listWorkLocations`, `createWorkLocation`, `updateWorkLocation`,
  `getTimeTrackingSettings`, `updateTimeTrackingSettings`, `linkMyEmployee`,
  `getFileDownloadUrl` (monta a URL com o token já embutido, já que o backend devolve o token
  junto de qualquer resposta que referencie um `attachmentAssetId`/`photoAssetId` — decisão de
  implementação: o mapeador de resposta de cada endpoint que devolve um asset também devolve um
  campo `downloadUrl` pronto, o frontend nunca monta o token sozinho).

- [ ] **Passo 1: seguir o padrão já estabelecido no arquivo inteiro** (`Api*` → `map*` → tipo de UI
→ função assíncrona, `request()` já autenticado e com retry de 401 desde a Task 8 do plano de
autenticação) — mirror de `listEmployees`/`createEmployee` para o shape de cada recurso novo. Para
os endpoints multipart (`createTimePunch`, `createAdjustmentRequest` com anexo,
`createJustification` com anexo), usar `FormData` em vez de `JSON.stringify`, sem o header
`Content-Type` manual (o browser define o boundary sozinho).

- [ ] **Passo 2: `npx tsc --noEmit -p .`, `npm run lint`, commit**

```bash
git add src/lib/api.ts
git commit -m "feat(frontend): add Time Tracking API client functions"
```

---

### Task 12: Frontend — `TimeTracking.tsx` real (visão do funcionário)

**Files:**
- Modify: `src/pages/app/TimeTracking.tsx`

**Interfaces:**
- Consumes: todas as funções da Task 11.

- [ ] **Passo 1: substituir `generateMockRecords`/estado local pelo consumo real**, preservando o
layout atual inteiro (cards, tabela, drawer de ajuste, modal de confirmação com câmera/localização).
Adicionar: estado vazio quando o login não tem `employeeId` vinculado (mensagem clara + link pra
completar o cadastro, em vez do botão de bater ponto); estado de carregamento nas listagens;
tratamento de erro visível (banner, não `alert()`); prevenção de envio duplicado (desabilitar o
botão de confirmação enquanto a requisição está em voo, não só enquanto câmera/GPS carregam como
hoje); pré-visualização da foto capturada antes de enviar; upload de anexo no formulário de
solicitação de ajuste (novo campo de arquivo); campos de tipo de solicitação e horário solicitado
no formulário (hoje só tem texto livre); exibição do "próximo ponto permitido" vindo da API, não
mais calculado no frontend por posição.

- [ ] **Passo 2: nunca simular sucesso antes da confirmação do backend** — toda ação otimista do
mock atual (`setRecords`/`setLiveTodayPunches` direto) passa a esperar a resposta real da API antes
de atualizar a tela.

- [ ] **Passo 3: teste manual em navegador real** (câmera/GPS reais, upload de anexo real, criação e
cancelamento de solicitação), `npx tsc --noEmit -p .`, `npm run lint`, commit.

```bash
git add src/pages/app/TimeTracking.tsx
git commit -m "feat(frontend): connect TimeTracking.tsx to real Time Tracking backend"
```

---

### Task 13: Frontend — nova tela administrativa

**Files:**
- Create: `src/pages/app/TimeTrackingAdmin.tsx`
- Modify: `src/App.tsx` (nova rota, ex. `/app/ponto-administracao`)
- Modify: `src/layouts/AppLayout.tsx` (novo item no submenu de RH, module-gated por `RH` como todo
  o resto — sem bypass de `ADMIN`, mesmo padrão já estabelecido)

**Interfaces:**
- Consumes: as funções administrativas da Task 11.

- [ ] **Passo 1: nova página, seguindo o padrão visual já usado em `EmployeesList.tsx`/`Roles.tsx`**
(cards de resumo, tabela paginada/filtrada, drawer de detalhe) — não é um redesenho, é uma tela
nova que ainda não existia, então segue o padrão de OUTRAS telas de RH já existentes no projeto,
não inventa um visual novo. Seções: lista de funcionários com inconsistências pendentes,
solicitações de ajuste pendentes (aprovar/rejeitar inline, com campo de motivo obrigatório na
rejeição), justificativas pendentes (aprovar/rejeitar, visualizar anexo via `downloadUrl`),
correção proativa (formulário simples: funcionário, data, tipo, motivo obrigatório),
configuração de jornadas/locais de trabalho/`TimeTrackingSettings` (CRUD simples).

- [ ] **Passo 2: gating de acesso** — rota visível só pra quem tem módulo `RH` (mesmo padrão do
resto do app); dentro da tela, ações de aprovação/correção só aparecem pra quem `canManage` aquele
funcionário especificamente (o backend já impõe isso, o frontend só evita mostrar um botão que vai
dar 404 — nunca é a única camada de proteção).

- [ ] **Passo 3: teste manual em navegador real** (aprovar como superior direto, confirmar rejeição
por superior de outro funcionário dá erro, configurar jornada/local), `npx tsc --noEmit -p .`,
`npm run lint`, commit.

```bash
git add src/pages/app/TimeTrackingAdmin.tsx src/App.tsx src/layouts/AppLayout.tsx
git commit -m "feat(frontend): add Time Tracking admin screen"
```

---

### Task 14: Validação final completa + documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify/Create: notas do vault em `B:\Quickflow\Quickflow` (`ControleDePonto.md`,
  `TimeTrackingAdmin.md`, atualizar `EmployeesList.md`/`EmployeeForm.md` se o campo de superior for
  exposto lá, atualizar `Indice.md`)

- [ ] **Passo 1: validação de ponta a ponta**

```bash
cd backend && npx prisma migrate status && npm test && npm run lint && npm run build && npm run test:e2e
cd .. && npx tsc --noEmit -p . && npm run lint && npm run build
```
Percurso manual completo no navegador: duas empresas, hierarquia de superior configurada, ponto
completo com câmera/localização/anexo reais, ajuste solicitado/aprovado/rejeitado, justificativa
com atestado, tela administrativa funcionando, isolamento entre empresas confirmado em cada rota
nova.

- [ ] **Passo 2: `CLAUDE.md`** — nova seção "Controle de Ponto" no mesmo estilo das seções de
Auth/RH já existentes: modelo de eventos flexível, hierarquia de superior, feriados (com o mesmo
aviso de "base de referência, revisão periódica" já usado noutras pendências), upload de arquivo
(primeira infra do projeto), pendências documentadas (retenção de dados, feriados municipais,
skip-level).

- [ ] **Passo 3: vault Obsidian** — notas novas com wikilinks pras já existentes
(`[[EmployeesList]]`, `[[DECISOES-TECNICAS]]`), documentando arquitetura, entidades/relacionamentos,
endpoints, fluxos, decisões técnicas (por que `User`/`Employee`, por que HMAC em vez de nuvem, por
que feriado semeado não é fonte autoatualizável), limitações conhecidas.

- [ ] **Passo 4: commit final**

```bash
git add CLAUDE.md
git commit -m "docs: document Time Tracking module implementation"
```

Sem `git push`. Sem Docker. Nenhum módulo fora do escopo de Controle de Ponto é alterado.
