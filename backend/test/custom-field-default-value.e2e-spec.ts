import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// Cobre a lacuna do defaultValue de ponta a ponta (17/09/2026) — pedido do usuário depois de já
// existir o widget de "Valor Padrão" na tela de configuração: poder ADICIONAR, EDITAR e REMOVER um
// valor padrão. Os testes unitários de CustomFieldValuesService/CustomFieldDefinitionsService já
// cobrem cada peça isolada (mockada); este arquivo confirma o fluxo real contra Postgres, porque a
// classe de bug mais provável aqui (`FORCE ROW LEVEL SECURITY`/roteamento por schema físico) só
// aparece contra o banco de verdade — já aconteceu duas vezes neste projeto (ver [[DECISOES-TECNICAS]]).
describe('Valor padrão de campo personalizado — criar, editar e remover (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let token: string;
  const runId = Date.now();

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) throw new Error('DATABASE_URL must point to a *_test database');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Default Value Co', email: `def-value-${runId}@test.com`, password: 'senha-de-teste-12345' }))
      .expect(201);
    token = `Bearer ${reg.body.accessToken}`;
    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: `def-value-${runId}@test.com` } }));
    companyId = user.companyId;
  });

  afterAll(async () => {
    const schemaName = await getTenantSchemaName(prisma, companyId);
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await app.close();
  });

  it('cria um campo já com valor padrão, e um Cliente sem preencher esse campo herda o padrão', async () => {
    const field = await request(app.getHttpServer())
      .post('/custom-fields')
      .set('Authorization', token)
      .send({ entity: 'client', displayName: 'Segmento', type: 'TEXT', defaultValue: 'Pequeno' })
      .expect(201);
    expect(field.body.defaultValue).toBe('Pequeno');

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Sem Segmento', contact: 'contato@teste.com' })
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/clients/${client.body.id}`)
      .set('Authorization', token)
      .expect(200);
    expect(fetched.body.customFields[field.body.columnName]).toBe('Pequeno');
  });

  it('editar o valor padrão passa a valer só pra registros novos, nunca pros já existentes', async () => {
    const field = await request(app.getHttpServer())
      .post('/custom-fields')
      .set('Authorization', token)
      .send({ entity: 'client', displayName: 'Prioridade', type: 'TEXT', defaultValue: 'Baixa' })
      .expect(201);

    const before = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Prioridade Baixa', contact: 'contato@teste.com' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/custom-fields/${field.body.id}`)
      .set('Authorization', token)
      .send({ defaultValue: 'Alta' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Prioridade Alta', contact: 'contato@teste.com' })
      .expect(201);

    const fetchedBefore = await request(app.getHttpServer())
      .get(`/clients/${before.body.id}`)
      .set('Authorization', token)
      .expect(200);
    const fetchedAfter = await request(app.getHttpServer())
      .get(`/clients/${after.body.id}`)
      .set('Authorization', token)
      .expect(200);

    expect(fetchedBefore.body.customFields[field.body.columnName]).toBe('Baixa');
    expect(fetchedAfter.body.customFields[field.body.columnName]).toBe('Alta');
  });

  it('remover o valor padrão (defaultValue: null) volta o campo a nascer vazio pra registros novos', async () => {
    const field = await request(app.getHttpServer())
      .post('/custom-fields')
      .set('Authorization', token)
      .send({ entity: 'client', displayName: 'Origem', type: 'TEXT', defaultValue: 'Indicação' })
      .expect(201);

    const cleared = await request(app.getHttpServer())
      .patch(`/custom-fields/${field.body.id}`)
      .set('Authorization', token)
      .send({ defaultValue: null })
      .expect(200);
    expect(cleared.body.defaultValue).toBeNull();

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Sem Origem', contact: 'contato@teste.com' })
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/clients/${client.body.id}`)
      .set('Authorization', token)
      .expect(200);
    expect(fetched.body.customFields[field.body.columnName] ?? null).toBeNull();
  });
});
