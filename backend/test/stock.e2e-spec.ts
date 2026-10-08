import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { translateValidationErrors } from '../src/common/validation-message-translator.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem, runWithTenant } from '../src/prisma/tenant-context';
import { ProductTrashService } from '../src/stock/product-trash.service';
import { acceptInvite, markEmailVerified } from './access.util';
import { setCompanyPlan } from './plan.util';
import { buildRegisterBody } from './register-body.util';
import { selectBypassingRls } from './tenant-physical-read.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

type Grant = { permissionCode: string; scope: 'EMPRESA' | null };

// Estoque v1 (08/10/2026): cadastro, custo médio, ajuste, estorno, idempotência, concorrência,
// isolamento entre empresas, ocultação de custos, lixeira/arquivamento e relatórios — tudo contra
// Postgres real, com logins de verdade.
describe('Estoque v1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const companies: string[] = [];
  const runId = Date.now();
  const password = 'senha-de-teste-12345';

  let tokenA: string;
  let companyA: string;
  let tokenB: string;
  let noCostToken: string;
  let viewOnlyToken: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => `Bearer ${t}`;

  async function register(label: string) {
    const email = `stock-${label}-${runId}@test.com`;
    const res = await http()
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: `Estoque ${label}`, email, password }))
      .expect(201);
    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    await markEmailVerified(prisma, email);
    await setCompanyPlan(prisma, user.companyId, 'EMPRESARIAL');
    companies.push(user.companyId);
    return { token: res.body.accessToken as string, companyId: user.companyId };
  }

  // Papel ADMIN só porque login EMPLOYEE exige ficha de funcionário: o que vale aqui é o PERFIL
  // restrito (as permissões do token vêm só dele).
  async function createLogin(founderToken: string, grants: Grant[]): Promise<string> {
    const profile = await http().post('/profiles').set('Authorization', auth(founderToken))
      .send({ name: `Perfil ${Math.random().toString(36).slice(2)}`, grants }).expect(201);
    const email = `stock-login-${Math.random().toString(36).slice(2)}-${runId}@test.com`;
    const res = await http().post('/companies/me/users').set('Authorization', auth(founderToken))
      .send({ email, role: 'ADMIN', profileId: profile.body.id }).expect(201);
    await acceptInvite(app, res.body.inviteUrl, password);
    const login = await http().post('/auth/login').set('x-requested-with', 'XMLHttpRequest').send({ email, password }).expect(201);
    return login.body.accessToken;
  }

  function createProduct(token: string, body: Record<string, unknown>) {
    return http().post('/stock/products').set('Authorization', auth(token)).send({ name: 'Produto', ...body });
  }

  const entry = (token: string, id: string, quantity: string, unitCost: string, requestId = randomUUID()) =>
    http().post(`/stock/products/${id}/entries`).set('Authorization', auth(token))
      .send({ requestId, quantity, unitCost, reason: 'MANUAL_ENTRY' });
  const exit = (token: string, id: string, quantity: string, requestId = randomUUID()) =>
    http().post(`/stock/products/${id}/exits`).set('Authorization', auth(token))
      .send({ requestId, quantity, reason: 'LOSS' });
  const getProduct = (token: string, id: string) => http().get(`/stock/products/${id}`).set('Authorization', auth(token));

  async function setTrashedDaysAgo(companyId: string, productId: string, days: number) {
    const schema = await getTenantSchemaName(prisma, companyId);
    const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await sys(() =>
      prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`,
        prisma.$executeRawUnsafe(`UPDATE "${schema}"."Product" SET "trashedAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, when, productId),
      ]),
    );
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard).useValue(allow)
      .overrideGuard(FriendlyThrottlerGuard).useValue(allow)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, transform: true, forbidNonWhitelisted: true,
      exceptionFactory: (errors) => new BadRequestException(translateValidationErrors(errors)),
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const a = await register('a');
    tokenA = a.token;
    companyA = a.companyId;
    tokenB = (await register('b')).token;

    const allStockExceptCosts = [
      'estoque.ver', 'estoque.produtos.gerenciar', 'estoque.movimentar', 'estoque.ajustar', 'estoque.estornar',
      'estoque.exportar', 'estoque.lixeira.gerenciar',
    ];
    noCostToken = await createLogin(tokenA, allStockExceptCosts.map((code) => ({ permissionCode: code, scope: 'EMPRESA' })));
    viewOnlyToken = await createLogin(tokenA, [{ permissionCode: 'estoque.ver', scope: 'EMPRESA' }]);
  }, 120_000);

  afterAll(async () => {
    for (const id of companies) {
      const schemaName = await getTenantSchemaName(prisma, id);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.company.delete({ where: { id } }));
    }
    await app.close();
  });

  it('cadastro sem saldo inicial: SKU automático, unidade UN, saldo zero e sem movimentação', async () => {
    const res = await createProduct(tokenA, { name: 'Caneta azul' }).expect(201);
    expect(res.body.sku).toMatch(/^PRD-\d{6}$/);
    expect(res.body.unit).toBe('UN');
    expect(res.body.balance).toBe(0);
    expect(res.body.hasMovements).toBe(false);
    expect(res.body.situation).toBe('OUT_OF_STOCK');
    const second = await createProduct(tokenA, { name: 'Caneta preta' }).expect(201);
    expect(Number(second.body.sku.slice(4))).toBe(Number(res.body.sku.slice(4)) + 1);
  });

  it('cadastro com saldo inicial gera a movimentação de saldo inicial na mesma operação', async () => {
    const res = await createProduct(tokenA, {
      name: 'Parafuso', sku: 'par-001', barcode: '00012345', initialQuantity: '10', initialUnitCost: '2.5', minStock: '3', targetStock: '20',
    }).expect(201);
    expect(res.body.sku).toBe('PAR-001');
    expect(res.body.barcode).toBe('00012345'); // zeros à esquerda preservados
    expect(res.body.balance).toBe(10);
    expect(res.body.averageCost).toBe(2.5);
    expect(res.body.stockValue).toBe(25);
    const movements = await http().get('/stock/movements').query({ productId: res.body.id }).set('Authorization', auth(tokenA)).expect(200);
    expect(movements.body.items).toHaveLength(1);
    expect(movements.body.items[0]).toMatchObject({ type: 'INITIAL', reason: 'INITIAL_BALANCE', quantity: 10, balanceBefore: 0, balanceAfter: 10 });
  });

  it('validações do cadastro: saldo inicial sem custo, alvo menor que mínimo, fração em UN, SKU duplicado', async () => {
    const noCost = await createProduct(tokenA, { name: 'X', initialQuantity: '5' }).expect(400);
    expect(noCost.body.message).toBe('Informe o custo unitário do saldo inicial');
    // Atomicidade: o produto não foi criado sem o saldo inicial.
    const listed = await http().get('/stock/products').query({ search: 'X' }).set('Authorization', auth(tokenA)).expect(200);
    expect(listed.body.items.find((p: { name: string }) => p.name === 'X')).toBeUndefined();
    const target = await createProduct(tokenA, { name: 'Y', minStock: '10', targetStock: '5' }).expect(400);
    expect(target.body.message).toBe('O estoque alvo não pode ser menor que o estoque mínimo');
    await createProduct(tokenA, { name: 'Z', initialQuantity: '1.5', initialUnitCost: '1' }).expect(400);
    const dup = await createProduct(tokenA, { name: 'Outro', sku: 'PAR-001' }).expect(409);
    expect(dup.body.message).toContain('PAR-001');
    await createProduct(tokenA, { name: '' }).expect(400);
  });

  it('entrada recalcula o custo médio; saída usa o custo médio e bloqueia saldo negativo; zerar e reentrar', async () => {
    const p = (await createProduct(tokenA, { name: 'Farinha', unit: 'KG' }).expect(201)).body;
    await entry(tokenA, p.id, '10', '2').expect(201);
    await entry(tokenA, p.id, '10', '4').expect(201);
    let current = (await getProduct(tokenA, p.id).expect(200)).body;
    expect(current.averageCost).toBe(3);
    expect(current.stockValue).toBe(60);

    const tooMuch = await exit(tokenA, p.id, '20.5').expect(400);
    expect(tooMuch.body.message).toBe('Quantidade maior que o saldo disponível');

    const out = await exit(tokenA, p.id, '2.5').expect(201);
    expect(out.body.unitCost).toBe(3);
    expect(out.body.valueDelta).toBe(-7.5);
    await exit(tokenA, p.id, '17.5').expect(201);
    current = (await getProduct(tokenA, p.id).expect(200)).body;
    expect(current.balance).toBe(0);
    expect(current.stockValue).toBe(0);
    expect(current.averageCost).toBe(0);

    await entry(tokenA, p.id, '4', '7.1234').expect(201);
    current = (await getProduct(tokenA, p.id).expect(200)).body;
    expect(current.averageCost).toBe(7.1234); // a entrada após saldo zero fixa o custo informado
  });

  it('ajuste por contagem: positivo, negativo, sem diferença, saldo mudado e custo exigido com saldo zero', async () => {
    const p = (await createProduct(tokenA, { name: 'Copo', initialQuantity: '10', initialUnitCost: '1' }).expect(201)).body;
    const adjust = (body: Record<string, unknown>) =>
      http().post(`/stock/products/${p.id}/adjustments`).set('Authorization', auth(tokenA))
        .send({ requestId: randomUUID(), notes: 'Contagem mensal', ...body });

    const same = await adjust({ countedQuantity: '10', expectedBalance: '10' }).expect(400);
    expect(same.body.message).toContain('Nenhum ajuste');
    const stale = await adjust({ countedQuantity: '8', expectedBalance: '9' }).expect(409);
    expect(stale.body).toMatchObject({ code: 'STOCK_BALANCE_CHANGED', currentBalance: 10 });
    await adjust({ countedQuantity: '8', expectedBalance: '10', notes: '' }).expect(400);

    const down = await adjust({ countedQuantity: '7', expectedBalance: '10' }).expect(201);
    expect(down.body).toMatchObject({ type: 'ADJUSTMENT', quantity: 3, quantityDelta: -3, balanceAfter: 7, unitCost: 1 });
    const up = await adjust({ countedQuantity: '9', expectedBalance: '7' }).expect(201);
    expect(up.body).toMatchObject({ quantityDelta: 2, balanceAfter: 9, unitCost: 1 });

    await adjust({ countedQuantity: '0', expectedBalance: '9' }).expect(201);
    const needCost = await adjust({ countedQuantity: '5', expectedBalance: '0' }).expect(400);
    expect(needCost.body.code).toBe('UNIT_COST_REQUIRED');
    const withCost = await adjust({ countedQuantity: '5', expectedBalance: '0', unitCost: '2' }).expect(201);
    expect(withCost.body.averageCostAfter).toBe(2);
  });

  it('estorno: só a última movimentação, reverte quantidade e valor exatos, não estorna duas vezes', async () => {
    const p = (await createProduct(tokenA, { name: 'Lápis', initialQuantity: '3', initialUnitCost: '1' }).expect(201)).body;
    const first = (await entry(tokenA, p.id, '1', '5').expect(201)).body; // saldo 4, valor 8, médio 2
    const second = (await exit(tokenA, p.id, '1').expect(201)).body; // saldo 3, valor 6

    const reverse = (id: string, notes = 'Lançado errado') =>
      http().post(`/stock/movements/${id}/reverse`).set('Authorization', auth(tokenA)).send({ requestId: randomUUID(), notes });

    const notLast = await reverse(first.id).expect(409);
    expect(notLast.body.message).toContain('só a última movimentação');
    await reverse(second.id, '').expect(400);

    const rev = (await reverse(second.id).expect(201)).body;
    expect(rev).toMatchObject({ type: 'REVERSAL', reversalOfId: second.id, quantityDelta: 1, valueDelta: 2 });
    let current = (await getProduct(tokenA, p.id).expect(200)).body;
    expect(current).toMatchObject({ balance: 4, stockValue: 8, averageCost: 2 });

    await reverse(second.id).expect(409); // já estornada
    await reverse(rev.id).expect(409); // estorno não se estorna

    // Com o par fechado, a entrada anterior passa a ser a última elegível.
    expect(current.reversibleMovementId).toBe(first.id);
    await reverse(first.id).expect(201);
    current = (await getProduct(tokenA, p.id).expect(200)).body;
    expect(current).toMatchObject({ balance: 3, stockValue: 3, averageCost: 1 });

    const detail = await http().get(`/stock/movements/${rev.id}`).set('Authorization', auth(tokenA)).expect(200);
    expect(detail.body.original.id).toBe(second.id);
  });

  it('reenvio com o mesmo requestId não duplica; saídas simultâneas nunca deixam saldo negativo', async () => {
    const p = (await createProduct(tokenA, { name: 'Clipe', initialQuantity: '5', initialUnitCost: '1' }).expect(201)).body;
    const requestId = randomUUID();
    const [r1, r2] = await Promise.all([exit(tokenA, p.id, '1', requestId), exit(tokenA, p.id, '1', requestId)]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.id).toBe(r2.body.id);
    expect((await getProduct(tokenA, p.id)).body.balance).toBe(4);

    const results = await Promise.all(Array.from({ length: 6 }, () => exit(tokenA, p.id, '1')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    const final = (await getProduct(tokenA, p.id)).body;
    expect(final.balance).toBe(0);
    expect(final.stockValue).toBe(0);
  });

  it('campos personalizados: criação, edição preservando valores, consulta e obrigatório novo sinalizado', async () => {
    await http().post('/custom-fields').set('Authorization', auth(tokenA))
      .send({ entity: 'product', displayName: 'Material', type: 'TEXT' }).expect(201);
    const p = (await createProduct(tokenA, { name: 'Mesa', customFields: { custom_material: 'Madeira' } }).expect(201)).body;
    expect(p.customFields.custom_material).toBe('Madeira');
    const edited = (await http().patch(`/stock/products/${p.id}`).set('Authorization', auth(tokenA)).send({ name: 'Mesa grande' }).expect(200)).body;
    expect(edited.customFields.custom_material).toBe('Madeira');

    // Lixeira com o valor preservado; um obrigatório criado depois é sinalizado ao restaurar.
    await http().patch(`/stock/products/${p.id}/trash`).set('Authorization', auth(tokenA)).expect(200);
    await http().post('/custom-fields').set('Authorization', auth(tokenA))
      .send({ entity: 'product', displayName: 'Voltagem', type: 'TEXT', required: true }).expect(201);
    const restored = (await http().patch(`/stock/products/${p.id}/restore`).set('Authorization', auth(tokenA)).expect(200)).body;
    expect(restored.lifecycle).toBe('ACTIVE');
    expect(restored.customFields.custom_material).toBe('Madeira');
    expect(restored.missingRequiredCustomFields.map((f: { displayName: string }) => f.displayName)).toEqual(['Voltagem']);
    // Desativa o obrigatório para não afetar os outros testes.
    const defs = await http().get('/custom-fields').query({ entity: 'product' }).set('Authorization', auth(tokenA)).expect(200);
    const voltagem = defs.body.find((d: { displayName: string }) => d.displayName === 'Voltagem');
    await http().patch(`/custom-fields/${voltagem.id}/deactivate`).set('Authorization', auth(tokenA)).expect(200);
  });

  it('unidade não muda depois de movimentação', async () => {
    const p = (await createProduct(tokenA, { name: 'Tinta', unit: 'L' }).expect(201)).body;
    await http().patch(`/stock/products/${p.id}`).set('Authorization', auth(tokenA)).send({ unit: 'ML' }).expect(200);
    await entry(tokenA, p.id, '1.5', '10').expect(201);
    const res = await http().patch(`/stock/products/${p.id}`).set('Authorization', auth(tokenA)).send({ unit: 'L' }).expect(409);
    expect(res.body.message).toContain('unidade');
  });

  it('isolamento: outra empresa não vê nem movimenta o produto', async () => {
    const p = (await createProduct(tokenA, { name: 'Sigiloso', initialQuantity: '2', initialUnitCost: '1' }).expect(201)).body;
    await getProduct(tokenB, p.id).expect(404);
    await entry(tokenB, p.id, '1', '1').expect(404);
    await http().patch(`/stock/products/${p.id}/trash`).set('Authorization', auth(tokenB)).expect(404);
    const listB = await http().get('/stock/products').set('Authorization', auth(tokenB)).expect(200);
    expect(listB.body.items).toHaveLength(0);
    const movB = await http().get('/stock/movements').set('Authorization', auth(tokenB)).expect(200);
    expect(movB.body.items).toHaveLength(0);
  });

  it('sem estoque.custos.ver nenhum custo sai da API (produto, histórico, indicadores, CSV)', async () => {
    const p = (await createProduct(tokenA, { name: 'Café', initialQuantity: '2', initialUnitCost: '9' }).expect(201)).body;
    const product = (await getProduct(noCostToken, p.id).expect(200)).body;
    for (const key of ['averageCost', 'stockValue', 'referenceCost']) expect(product).not.toHaveProperty(key);
    const movements = (await http().get('/stock/movements').query({ productId: p.id }).set('Authorization', auth(noCostToken)).expect(200)).body;
    for (const key of ['unitCost', 'valueDelta', 'valueBefore', 'valueAfter', 'averageCostBefore', 'averageCostAfter']) {
      expect(movements.items[0]).not.toHaveProperty(key);
    }
    const overview = (await http().get('/stock/reports/overview').set('Authorization', auth(noCostToken)).expect(200)).body;
    expect(overview).not.toHaveProperty('totalValue');
    const csv = await http().get('/stock/reports/export/position.csv').set('Authorization', auth(noCostToken)).expect(200);
    expect(csv.text).not.toContain('Custo médio');
    expect(csv.text).not.toContain('Valor em estoque');
    // Também não consegue gravar custo de referência.
    await createProduct(noCostToken, { name: 'Com custo', referenceCost: '1' }).expect(403);
    // Mas registra entrada informando o custo, e a resposta vem sem custos.
    const e = await entry(noCostToken, p.id, '1', '9').expect(201);
    expect(e.body).not.toHaveProperty('unitCost');
  });

  it('permissões por ação: só visualizar não cadastra, não movimenta, não exporta', async () => {
    const p = (await createProduct(tokenA, { name: 'Restrito' }).expect(201)).body;
    await getProduct(viewOnlyToken, p.id).expect(200);
    expect((await createProduct(viewOnlyToken, { name: 'Novo' })).status).toBe(403);
    expect((await entry(viewOnlyToken, p.id, '1', '1')).body.code).toBe('PERMISSION_REQUIRED');
    await http().get('/stock/reports/export/position.csv').set('Authorization', auth(viewOnlyToken)).expect(403);
    await http().get('/stock/products/trash').set('Authorization', auth(viewOnlyToken)).expect(403);
  });

  it('lixeira: bloqueia com saldo, envia com saldo zero, não movimenta, restaura dentro do prazo', async () => {
    const p = (await createProduct(tokenA, { name: 'Régua', initialQuantity: '1', initialUnitCost: '3' }).expect(201)).body;
    const blocked = await http().patch(`/stock/products/${p.id}/trash`).set('Authorization', auth(tokenA)).expect(409);
    expect(blocked.body.code).toBe('STOCK_NOT_ZERO');
    expect((await getProduct(tokenA, p.id)).body.balance).toBe(1); // nunca zera sozinho

    await exit(tokenA, p.id, '1').expect(201);
    const trashed = (await http().patch(`/stock/products/${p.id}/trash`).set('Authorization', auth(tokenA)).expect(200)).body;
    expect(trashed.lifecycle).toBe('TRASHED');
    expect(trashed.afterTrashOutcome).toBe('ARCHIVE');
    await entry(tokenA, p.id, '1', '1').expect(409);
    const selectable = await http().get('/stock/products').query({ selectable: true, search: 'Régua' }).set('Authorization', auth(tokenA)).expect(200);
    expect(selectable.body.items).toHaveLength(0);
    const trash = await http().get('/stock/products/trash').set('Authorization', auth(tokenA)).expect(200);
    expect(trash.body.find((t: { id: string }) => t.id === p.id)).toMatchObject({ daysLeft: 30, afterTrashOutcome: 'ARCHIVE' });
    // SKU continua reservado enquanto está na lixeira.
    await createProduct(tokenA, { name: 'Clone', sku: trashed.sku }).expect(409);

    await http().patch(`/stock/products/${p.id}/restore`).set('Authorization', auth(tokenA)).expect(200);
    const after = (await getProduct(tokenA, p.id)).body;
    expect(after.lifecycle).toBe('ACTIVE');
    expect(after.hasMovements).toBe(true);
  });

  it('após 30 dias: sem histórico exclui de vez; com histórico arquiva; totais históricos preservados', async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const empty = (await createProduct(tokenA, { name: 'Sem histórico' }).expect(201)).body;
    const withHistory = (await createProduct(tokenA, { name: 'Com histórico', initialQuantity: '2', initialUnitCost: '5' }).expect(201)).body;
    await exit(tokenA, withHistory.id, '2').expect(201);
    const to = new Date(Date.now() + 60_000).toISOString();
    const summaryBefore = (await http().get('/stock/reports/period-summary').query({ from, to }).set('Authorization', auth(tokenA)).expect(200)).body;

    for (const p of [empty, withHistory]) {
      await http().patch(`/stock/products/${p.id}/trash`).set('Authorization', auth(tokenA)).expect(200);
      await setTrashedDaysAgo(companyA, p.id, 31);
    }
    // Restaurar depois do prazo é recusado.
    await http().patch(`/stock/products/${empty.id}/restore`).set('Authorization', auth(tokenA)).expect(409);

    const result = await runWithTenant(companyA, () => app.get(ProductTrashService).processExpiredTrash(companyA));
    expect(result).toEqual({ deleted: 1, archived: 1 });

    await getProduct(tokenA, empty.id).expect(404);
    const archived = (await getProduct(tokenA, withHistory.id).expect(200)).body;
    expect(archived.lifecycle).toBe('ARCHIVED');
    await http().patch(`/stock/products/${withHistory.id}/restore`).set('Authorization', auth(tokenA)).expect(409);

    const schema = await getTenantSchemaName(prisma, companyA);
    const rows = await selectBypassingRls<{ c: number }[]>(prisma, `SELECT count(*)::int c FROM "${schema}"."StockMovement" WHERE "productId" = '${withHistory.id}'`);
    expect(rows[0].c).toBe(2);

    const summaryAfter = (await http().get('/stock/reports/period-summary').query({ from, to }).set('Authorization', auth(tokenA)).expect(200)).body;
    expect(summaryAfter.categories).toEqual(summaryBefore.categories);

    const deleted = await http().get('/stock/products').query({ view: 'deleted' }).set('Authorization', auth(tokenA)).expect(200);
    expect(deleted.body.items.map((p: { id: string }) => p.id)).toContain(withHistory.id);
    const history = await http().get('/stock/movements').query({ productId: withHistory.id }).set('Authorization', auth(tokenA)).expect(200);
    expect(history.body.items[0].productLifecycle).toBe('ARCHIVED');
  });

  it('foto: envia, troca apagando a anterior, recusa PDF e some junto na exclusão definitiva', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const p = (await createProduct(tokenA, { name: 'Com foto' }).expect(201)).body;
    const upload = (buffer: Buffer, name: string) =>
      http().post(`/stock/products/${p.id}/photo`).set('Authorization', auth(tokenA)).attach('photo', buffer, name);

    const first = (await upload(png, 'a.png').expect(201)).body;
    expect(first.photoUrl).toMatch(/^\/file-assets\//);
    const firstAssetId = first.photoUrl.split('/')[2].split('?')[0];
    const second = (await upload(png, 'b.png').expect(201)).body;
    const secondAssetId = second.photoUrl.split('/')[2].split('?')[0];
    expect(secondAssetId).not.toBe(firstAssetId);

    const schema = await getTenantSchemaName(prisma, companyA);
    const count = async (id: string) =>
      (await selectBypassingRls<{ c: number }[]>(prisma, `SELECT count(*)::int c FROM "${schema}"."FileAsset" WHERE id = '${id}'`))[0].c;
    expect(await count(firstAssetId)).toBe(0);
    expect(await count(secondAssetId)).toBe(1);

    await upload(Buffer.from('%PDF-1.4 fake'), 'x.pdf').expect(400);

    await http().patch(`/stock/products/${p.id}/trash`).set('Authorization', auth(tokenA)).expect(200);
    await setTrashedDaysAgo(companyA, p.id, 31);
    await runWithTenant(companyA, () => app.get(ProductTrashService).processExpiredTrash(companyA));
    await getProduct(tokenA, p.id).expect(404);
    expect(await count(secondAssetId)).toBe(0);
  });

  it('indicadores, reposição e CSV coerentes; produto inativo com saldo entra no valor total', async () => {
    const low = (await createProduct(tokenA, { name: 'Baixo', initialQuantity: '2', initialUnitCost: '1', minStock: '5', targetStock: '12' }).expect(201)).body;
    const inactive = (await createProduct(tokenA, { name: 'Inativo com saldo', initialQuantity: '3', initialUnitCost: '10' }).expect(201)).body;
    await http().patch(`/stock/products/${inactive.id}/deactivate`).set('Authorization', auth(tokenA)).expect(200);

    const overview = (await http().get('/stock/reports/overview').set('Authorization', auth(tokenA)).expect(200)).body;
    const products = await http().get('/stock/products').query({ view: 'all', pageSize: 200 }).set('Authorization', auth(tokenA)).expect(200);
    const sum = products.body.items.reduce((acc: number, p: { stockValue: number }) => acc + p.stockValue, 0);
    expect(overview.totalValue).toBeCloseTo(sum, 2);
    expect(overview.skusWithStock).toBe(products.body.items.filter((p: { balance: number }) => p.balance > 0).length);
    expect(overview.inactiveWithStock).toBeGreaterThanOrEqual(1);
    expect(overview.lowStock).toBe(products.body.items.filter((p: { situation: string }) => p.situation === 'LOW').length);
    expect(overview.outOfStock).toBe(products.body.items.filter((p: { situation: string }) => p.situation === 'OUT_OF_STOCK').length);

    const lowFilter = await http().get('/stock/products').query({ situation: 'LOW' }).set('Authorization', auth(tokenA)).expect(200);
    expect(lowFilter.body.items.map((p: { id: string }) => p.id)).toContain(low.id);

    const repl = (await http().get('/stock/reports/replenishment').set('Authorization', auth(tokenA)).expect(200)).body;
    expect(repl.find((p: { id: string }) => p.id === low.id)).toMatchObject({ quantityToTarget: 10, situation: 'LOW' });
    expect(repl.find((p: { id: string }) => p.id === inactive.id)).toBeUndefined();

    const csv = await http().get('/stock/reports/export/position.csv').set('Authorization', auth(tokenA)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Valor em estoque');
    expect(csv.text).toContain(low.sku);
    const movCsv = await http().get('/stock/reports/export/movements.csv').set('Authorization', auth(tokenA)).expect(200);
    expect(movCsv.text).toContain('Saldo inicial');

    const byCode = await http().get(`/stock/products/by-code/${encodeURIComponent(low.sku.toLowerCase())}`).set('Authorization', auth(tokenA)).expect(200);
    expect(byCode.body.id).toBe(low.id);
  });
});
