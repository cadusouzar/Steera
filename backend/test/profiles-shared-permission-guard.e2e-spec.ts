import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Scope } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem, runWithTenant } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';
import { ProfilesService } from '../src/profiles/profiles.service';
import { TimeManagementAuthService } from '../src/time-management/time-management-auth.service';
import { AuthenticatedUser } from '../src/auth/decorators/current-user.decorator';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// Chamador destes testes: um ADMIN de acesso total ao Ponto — passa livremente pelo gate
// restaurado na revisão final da branch (22/09/2026), que não é o assunto destes dois arquivos.
function fullAccessCaller(companyIdArg: string): AuthenticatedUser {
  return {
    userId: 'e2e-caller',
    companyId: companyIdArg,
    role: 'ADMIN',
    modules: [],
    mustChangePassword: false,
    hasFullPontoAccess: true,
    permissions: {},
  };
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
 * Prova, contra Postgres real (não mockado), do bug crítico achado numa revisão de segurança logo
 * depois da Task 4 (authorization-profiles-screen) ser mesclada: `ProfilesService.update()`
 * chamava `assertNotLastHolderOfPermission` uma vez POR USUÁRIO afetado, ANTES da reescrita em
 * lote das `ProfilePermission` do perfil editado. Quando um perfil compartilhado por 2+ usuários
 * ativos é a ÚNICA fonte de `usuarios.gerenciar` na empresa, cada checagem individual via os
 * OUTROS usuários do MESMO perfil ainda "detentores" (a reescrita ainda não tinha rodado) — as
 * duas checagens passavam, e a reescrita em lote que vinha em seguida zerava por completo os
 * detentores ativos da empresa de uma vez, exatamente o desastre que o guard existe pra evitar.
 * `ProfilesService` não tem controller ainda nesta etapa do plano (só a Task 4 implementou o
 * service) — por isso este teste chama `ProfilesService.update()` diretamente, envolto em
 * `runWithTenant(companyId, ...)` pra estabelecer o mesmo contexto de tenant/RLS que o
 * `TenantContextInterceptor` estabeleceria numa requisição HTTP real (ver `tenant-rls.extension.ts`
 * — sem isso, as leituras de `Profile`/`ProfilePermission` fora da transação manual do método
 * veriam zero linhas, o comportamento seguro-por-padrão de RLS sem contexto de tenant ativo).
 */
describe('ProfilesService.update() — trava de último detentor entre perfis compartilhados (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let profiles: ProfilesService;
  let companyId: string;
  let adminToken: string;
  let administradorGeralId: string;

  const runId = Date.now();
  const adminEmail = `profiles-guard-admin-${runId}@test.com`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }

    app = await bootApp();
    prisma = app.get(PrismaService);
    profiles = new ProfilesService(prisma, new TimeManagementAuthService(prisma));

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Profiles Guard Co', email: adminEmail, password: 'senha-de-teste-12345' }))
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = founder.companyId;
    administradorGeralId = founder.profileId!;
    await markEmailVerified(prisma, adminEmail);

    // Precondição do cenário de desastre: remove `usuarios.gerenciar` do perfil "Administrador
    // Geral" do fundador (protegido — não editável via ProfilesService.update(), então mutado
    // direto no banco só pra montar o estado de partida do teste) para que ele deixe de contar
    // como "outro perfil que ainda concede a permissão".
    await sys(() =>
      prisma.profilePermission.deleteMany({
        where: { companyId, profileId: administradorGeralId, permissionCode: 'usuarios.gerenciar' },
      }),
    );
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
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
  //
  // Aceita o convite na hora (senha descartável — nenhum teste deste arquivo loga com este login) —
  // "Acesso e sessões" (26/09/2026): login criado por um admin nasce INVITED, e todo
  // `countActiveHoldersOfUsuariosGerenciar()`/guard de último detentor abaixo só conta login
  // ACTIVE. Sem aceitar, este login nunca contaria como "detentor", quebrando a precondição que
  // todo teste deste arquivo monta.
  async function createAdmin(label: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: `${label}-${runId}@test.com`, role: 'ADMIN', profileId: administradorGeralId })
      .expect(201);
    await acceptInvite(app, res.body.inviteUrl, 'senha-descartavel-123');
    return res.body.user.id as string;
  }

  // Via a API de modelo do Prisma (não `$queryRawUnsafe`) — de propósito, mesmo padrão já usado
  // por `test/last-permission-holder.e2e-spec.ts`. SQL bruto nunca passa pela extensão de
  // roteamento/RLS deste projeto (nem em modo bypass de `runAsSystem`, que só envolve chamadas
  // `.model.op()` num `$transaction` com `set_config('app.rls_bypass', ...)` — uma chamada raw
  // não passa por esse hook de jeito nenhum), então uma contagem em SQL bruto sob `sys()` bateria
  // na política de RLS sem nenhum contexto ativo e voltaria sempre zero, silenciosamente.
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

  it('rejeita e NÃO aplica nada (transação inteira revertida) quando o perfil editado é a ÚNICA fonte da permissão para 2 logins ativos', async () => {
    // Perfil "Único", compartilhado por 2 admins ativos, única fonte de usuarios.gerenciar na
    // empresa até aqui (Administrador Geral já teve a permissão removida no beforeAll).
    const unico = await runWithTenant(companyId, () =>
      profiles.create(companyId, {
        name: 'Único',
        grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }],
      }),
    );

    const adminAId = await createAdmin('disaster-a');
    const adminBId = await createAdmin('disaster-b');
    await sys(() => prisma.user.update({ where: { id: adminAId }, data: { profileId: unico.id } }));
    await sys(() => prisma.user.update({ where: { id: adminBId }, data: { profileId: unico.id } }));

    // Precondição confirmada: exatamente 2 detentores ativos, os dois via "Único".
    expect(await countActiveHoldersOfUsuariosGerenciar()).toBe(2);

    await expect(
      runWithTenant(companyId, () => profiles.update(companyId, unico.id, { name: 'Único', grants: [] }, fullAccessCaller(companyId))),
    ).rejects.toThrow(BadRequestException);

    // Nada foi parcialmente aplicado — a transação foi revertida por inteiro.
    const profileAfter = await sys(() => prisma.profile.findUniqueOrThrow({ where: { id: unico.id } }));
    expect(profileAfter.name).toBe('Único'); // não renomeado
    const stillGranted = await sys(() =>
      prisma.profilePermission.findFirst({ where: { profileId: unico.id, permissionCode: 'usuarios.gerenciar' } }),
    );
    expect(stillGranted).not.toBeNull(); // ProfilePermission não foi apagada
    expect(await countActiveHoldersOfUsuariosGerenciar()).toBe(2); // adminA e adminB continuam com a permissão

    const adminAAfter = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: adminAId } }));
    const adminBAfter = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: adminBId } }));
    expect(adminAAfter.profileId).toBe(unico.id);
    expect(adminBAfter.profileId).toBe(unico.id);
  });

  it('permite a edição quando OUTRO perfil ainda concede a permissão a um login ativo', async () => {
    // Mesmo perfil "Único" do teste anterior (ainda concede usuarios.gerenciar, ver asserts acima)
    // — desta vez um TERCEIRO perfil ("Extra"), com um TERCEIRO admin, também concede a permissão,
    // então remover de "Único" não deveria mais zerar a empresa.
    const unico = await runWithTenant(companyId, () => profiles.findAllForCompany(companyId)).then((list) =>
      list.find((p) => p.name === 'Único')!,
    );

    const extra = await runWithTenant(companyId, () =>
      profiles.create(companyId, {
        name: 'Extra',
        grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }],
      }),
    );
    const adminCId = await createAdmin('safe-c');
    await sys(() => prisma.user.update({ where: { id: adminCId }, data: { profileId: extra.id } }));

    // Precondição: 3 detentores ativos agora (adminA, adminB via Único; adminC via Extra).
    expect(await countActiveHoldersOfUsuariosGerenciar()).toBe(3);

    const updated = await runWithTenant(companyId, () =>
      profiles.update(companyId, unico.id, { name: 'Único', grants: [] }, fullAccessCaller(companyId)),
    );
    expect(updated.grants.find((g) => g.permissionCode === 'usuarios.gerenciar')).toBeUndefined();

    const stillGrantedOnUnico = await sys(() =>
      prisma.profilePermission.findFirst({ where: { profileId: unico.id, permissionCode: 'usuarios.gerenciar' } }),
    );
    expect(stillGrantedOnUnico).toBeNull(); // removida de verdade desta vez

    const stillGrantedOnExtra = await sys(() =>
      prisma.profilePermission.findFirst({ where: { profileId: extra.id, permissionCode: 'usuarios.gerenciar' } }),
    );
    expect(stillGrantedOnExtra).not.toBeNull(); // Extra continua intocado

    // Só adminC (via Extra) segue detentor.
    expect(await countActiveHoldersOfUsuariosGerenciar()).toBe(1);
  });
});
