import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Scope } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem, runWithTenant } from '../src/prisma/tenant-context';
import { ProfilesService } from '../src/profiles/profiles.service';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

/**
 * Prova, contra Postgres real (não mockado), que `ProfilesService.reassignAndDelete()` NÃO repete
 * o bug de "checagem por usuário" achado e corrigido em `update()` (ver
 * `profiles-shared-permission-guard.e2e-spec.ts` e task-5-report.md). A brief original desta task
 * pedia um loop chamando `assertNotLastHolderOfPermission` uma vez por usuário AFETADO, ANTES da
 * reatribuição em lote — o mesmo padrão que, em `update()`, deixava passar um lote que zerava por
 * completo os detentores ativos de `usuarios.gerenciar` da empresa quando TODOS os usuários
 * afetados pertenciam ao mesmo perfil sendo esvaziado (cada checagem individual via os OUTROS
 * como "ainda detentores", porque a reatribuição ainda não tinha rodado). A correção usa
 * `assertOtherProfileGrantsPermission` UMA única vez, pelo perfil de ORIGEM sendo excluído — ver
 * `ProfilesService.reassignAndDelete()`.
 *
 * Cenário: um perfil "Único" compartilhado por 2 logins ADMIN ativos é a ÚNICA fonte de
 * `usuarios.gerenciar` da empresa (o perfil protegido do fundador já teve a permissão removida,
 * mesma precondição do teste de `update()`). Mover os dois para um perfil "Sem Gerenciar" que não
 * concede a permissão, via `reassignAndDelete`, precisa ser rejeitado com `BadRequestException`/400
 * — e uma leitura direta no banco depois precisa confirmar que NADA foi movido (os dois logins
 * continuam no perfil original, que continua existindo, não excluído), provando que a transação
 * inteira foi revertida.
 *
 * `ProfilesService` não tem controller ainda nesta etapa do plano — por isso este teste chama
 * `ProfilesService.reassignAndDelete()` diretamente, envolto em `runWithTenant(companyId, ...)`,
 * mesmo padrão de `profiles-shared-permission-guard.e2e-spec.ts`.
 */
describe('ProfilesService.reassignAndDelete() — trava de último detentor entre perfis compartilhados (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let profiles: ProfilesService;
  let companyId: string;
  let adminToken: string;
  let administradorGeralId: string;

  const runId = Date.now();
  const adminEmail = `profiles-reassign-admin-${runId}@test.com`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }

    app = await bootApp();
    prisma = app.get(PrismaService);
    profiles = new ProfilesService(prisma);

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Profiles Reassign Co', email: adminEmail, password: 'senha-de-teste-12345' })
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = founder.companyId;
    administradorGeralId = founder.profileId!;

    // Mesma precondição do teste de update(): remove `usuarios.gerenciar` do perfil protegido
    // "Administrador Geral" do fundador, pra ele não contar como "outro perfil que ainda concede
    // a permissão".
    await sys(() =>
      prisma.profilePermission.deleteMany({
        where: { companyId, profileId: administradorGeralId, permissionCode: 'usuarios.gerenciar' },
      }),
    );
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = `tenant_${companyId}`;
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId } }));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  // profileId aqui é só pra passar na validação de create() — todo chamador desta função move o
  // login criado pra um profileId de teste específico logo em seguida (via prisma.user.update
  // direto), então qual perfil ele nasce com não importa pras asserções do teste.
  async function createAdmin(label: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: `${label}-${runId}@test.com`, role: 'ADMIN', profileId: administradorGeralId })
      .expect(201);
    return res.body.user.id as string;
  }

  function countActiveHoldersOfUsuariosGerenciar(): Promise<number> {
    return sys(() =>
      prisma.user.count({
        where: {
          companyId,
          status: 'ACTIVE',
          profile: { permissions: { some: { permissionCode: 'usuarios.gerenciar' } } },
        },
      }),
    );
  }

  it('rejeita e NÃO move/exclui nada (transação inteira revertida) quando o perfil de origem é a ÚNICA fonte da permissão para 2 logins ativos', async () => {
    const unico = await runWithTenant(companyId, () =>
      profiles.create(companyId, {
        name: 'Único',
        grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }],
      }),
    );
    const semGerenciar = await runWithTenant(companyId, () =>
      profiles.create(companyId, {
        name: 'Sem Gerenciar',
        grants: [{ permissionCode: 'dashboard.ver', scope: null }],
      }),
    );

    const adminAId = await createAdmin('disaster-a');
    const adminBId = await createAdmin('disaster-b');
    await sys(() => prisma.user.update({ where: { id: adminAId }, data: { profileId: unico.id } }));
    await sys(() => prisma.user.update({ where: { id: adminBId }, data: { profileId: unico.id } }));

    // Precondição confirmada: exatamente 2 detentores ativos, os dois via "Único".
    expect(await countActiveHoldersOfUsuariosGerenciar()).toBe(2);

    await expect(
      runWithTenant(companyId, () =>
        profiles.reassignAndDelete(companyId, unico.id, { targetProfileId: semGerenciar.id }),
      ),
    ).rejects.toThrow(BadRequestException);

    // Nada foi parcialmente aplicado — a transação foi revertida por inteiro.
    const profileAfter = await sys(() => prisma.profile.findUniqueOrThrow({ where: { id: unico.id } }));
    expect(profileAfter.name).toBe('Único'); // perfil de origem não excluído

    const adminAAfter = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: adminAId } }));
    const adminBAfter = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: adminBId } }));
    expect(adminAAfter.profileId).toBe(unico.id); // não movido
    expect(adminBAfter.profileId).toBe(unico.id); // não movido

    expect(await countActiveHoldersOfUsuariosGerenciar()).toBe(2); // adminA e adminB continuam com a permissão
  });

  it('permite mover e excluir quando o destino também concede a permissão', async () => {
    const unico = await runWithTenant(companyId, () => profiles.findAllForCompany(companyId)).then(
      (list) => list.find((p) => p.name === 'Único')!,
    );

    const comGerenciar = await runWithTenant(companyId, () =>
      profiles.create(companyId, {
        name: 'Com Gerenciar',
        grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }],
      }),
    );

    await runWithTenant(companyId, () =>
      profiles.reassignAndDelete(companyId, unico.id, { targetProfileId: comGerenciar.id }),
    );

    // Perfil de origem excluído de verdade desta vez.
    await expect(sys(() => prisma.profile.findUniqueOrThrow({ where: { id: unico.id } }))).rejects.toThrow();

    // Os dois logins afetados foram movidos pro destino.
    const usersOnTarget = await sys(() =>
      prisma.user.count({ where: { companyId, profileId: comGerenciar.id, status: 'ACTIVE' } }),
    );
    expect(usersOnTarget).toBe(2);

    // Os dois continuam detentores (agora via "Com Gerenciar").
    expect(await countActiveHoldersOfUsuariosGerenciar()).toBe(2);
  });
});
