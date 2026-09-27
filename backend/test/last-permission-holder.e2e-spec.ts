import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// Gera um CPF aleatório mas matematicamente válido (mesmo algoritmo de checksum de
// backend/src/common/cpf.util.ts), copiado de granular-modules.e2e-spec.ts.
function generateValidCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const checkDigit = (digits: number[], firstWeight: number) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (firstWeight - i), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = checkDigit(base, 10);
  const d2 = checkDigit([...base, d1], 11);
  return [...base, d1, d2].join('');
}

/**
 * Cobertura e2e (contra Postgres real) de `assertNotLastHolderOfPermission` — até a revisão final
 * da branch de authorization-architecture, essa função só tinha testes unitários MOCKADOS, e foi
 * exatamente por isso que três bugs distintos passaram por ela em três rodadas seguidas.
 *
 * O bug C2 desta rodada era live-breakage puro: a checagem rodava incondicionalmente, e como
 * `UsersService.create()` nunca atribuía `profileId` a um login novo, NINGUÉM detinha permissão
 * nenhuma por aquele join — `block()`/`remove()` rejeitavam TODA ação de TODA empresa. Os três
 * testes abaixo cobrem os três estados que importam: alvo detém + sobra outro detentor (passa),
 * alvo detém + é o último detentor (400), e alvo não detém nada (no-op, passa).
 */
describe('Trava do último detentor de usuarios.gerenciar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let adminToken: string;
  let founderId: string;
  let administradorGeralId: string;

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeEach(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const adminEmail = `last-holder-founder-${uniq()}@test.com`;
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Last Holder Co', email: adminEmail, password: 'senha-de-teste-12345' }))
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = founder.companyId;
    founderId = founder.id;
    administradorGeralId = founder.profileId!;
    await markEmailVerified(prisma, adminEmail);
  });

  afterEach(async () => {
    if (companyId) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      // Profile/ProfilePermission somem por cascade a partir de Company.
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  // Cria o segundo ADMIN direto no perfil "Administrador Geral" do fundador (compartilhado, não um
  // perfil próprio) — create() não deriva mais um perfil a partir de `modules` (Task 7,
  // authorization-profiles-screen), então "dois ADMINs detendo usuarios.gerenciar" hoje é
  // simplesmente dois logins no MESMO perfil que concede a permissão, o que basta pros três testes
  // que usam este helper (nenhum deles afirma nada sobre o segundo login ter um perfil PRÓPRIO).
  //
  // Aceita o convite na hora (senha descartável, nenhum teste loga com este login) — "Acesso e
  // sessões" (26/09/2026): login criado por um admin nasce INVITED, e tanto
  // `assertNotLastActiveAdmin` quanto `assertNotLastHolderOfPermission` só contam login ACTIVE.
  // Sem aceitar, o segundo admin nunca contaria como "ainda ativo", e excluir/bloquear o FUNDADOR
  // cairia sempre na trava de "último ADMIN ativo" genérica, nunca alcançando a trava específica de
  // `usuarios.gerenciar` que este arquivo existe pra testar.
  async function createAdminLogin(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: `last-holder-second-${uniq()}@test.com`, role: 'ADMIN', profileId: administradorGeralId })
      .expect(201);
    await acceptInvite(app, res.body.inviteUrl, 'senha-descartavel-123');
    return res.body.user.id;
  }

  function holdsUsuariosGerenciar(userId: string): Promise<boolean> {
    return sys(async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.profileId) return false;
      const grant = await prisma.profilePermission.findFirst({
        where: { profileId: user.profileId, permissionCode: 'usuarios.gerenciar' },
      });
      return grant !== null;
    });
  }

  it('dois ADMINs detendo usuarios.gerenciar: excluir um deles funciona (prova que o login criado pelo admin recebe perfil de verdade)', async () => {
    const secondAdminId = await createAdminLogin();

    // Regressão-alvo do I2: antes do fix, este login nascia com profileId null — invisível pra
    // trava, e com `permissions: {}` no JWT pra sempre.
    expect(await holdsUsuariosGerenciar(secondAdminId)).toBe(true);
    expect(await holdsUsuariosGerenciar(founderId)).toBe(true);

    await request(app.getHttpServer())
      .delete(`/companies/me/users/${secondAdminId}`)
      .set('Authorization', adminToken)
      .expect(204);
  });

  it('último detentor de usuarios.gerenciar é recusado com 400 e a mensagem da permissão', async () => {
    const secondAdminId = await createAdminLogin();

    // O segundo ADMIN é movido pra um perfil SEM `usuarios.gerenciar`. Assim a empresa continua com
    // 2 logins ADMIN ativos (o guard mais antigo, assertNotLastActiveAdmin, passa) mas com um único
    // detentor da permissão — exatamente o estado que só a trava desta rodada protege.
    await sys(async () => {
      const limited = await prisma.profile.create({
        data: {
          companyId,
          name: 'Somente Dashboard',
          isProtected: false,
          permissions: { create: [{ companyId, permissionCode: 'dashboard.ver', scope: null }] },
        },
      });
      await prisma.user.update({ where: { id: secondAdminId }, data: { profileId: limited.id } });
    });
    expect(await holdsUsuariosGerenciar(secondAdminId)).toBe(false);

    const res = await request(app.getHttpServer())
      .delete(`/companies/me/users/${founderId}`)
      .set('Authorization', adminToken)
      .expect(400);
    expect(res.body.message).toMatch(/permissão para gerenciar usuários/i);

    // O fundador continua existindo — a transação inteira foi revertida, não só a mensagem.
    const stillThere = await sys(() => prisma.user.findUnique({ where: { id: founderId } }));
    expect(stillThere).not.toBeNull();
  });

  it('login que NUNCA deteve usuarios.gerenciar (EMPLOYEE) é bloqueado/excluído normalmente', async () => {
    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', adminToken)
      .send({ name: 'Cargo Teste', department: 'Depto Teste' })
      .expect(201);

    const empRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', adminToken)
      .send({
        fullName: 'Funcionário Sem Permissão', cpf: generateValidCpf(),
        roleId: roleRes.body.id, contractType: 'CLT', admissionDate: '2026-01-01',
        department: 'Depto Teste', baseValue: 3000, paymentDueDay: 5,
      })
      .expect(201);

    // Perfil dedicado (só `ponto.registrar`, nunca `usuarios.gerenciar`) — via POST /profiles
    // (Task 6), já que create() não aceita mais `modules` diretamente (Task 7). O propósito deste
    // teste é confirmar que um EMPLOYEE nunca detém `usuarios.gerenciar`, então o perfil precisa
    // genuinamente não concedê-lo (usar o perfil do fundador aqui invalidaria a asserção abaixo).
    const restrictedProfileRes = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', adminToken)
      .send({ name: `Só Ponto ${uniq()}`, grants: [{ permissionCode: 'ponto.registrar' }] })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({
        email: `last-holder-emp-${uniq()}@test.com`,
        role: 'EMPLOYEE',
        employeeId: empRes.body.id,
        profileId: restrictedProfileRes.body.id,
      })
      .expect(201);
    const employeeLoginId = loginRes.body.user.id;

    // Um login EMPLOYEE nunca recebe `usuarios.gerenciar` (nenhum módulo concede esse código, e a
    // união de "códigos gated só por papel" só se aplica a ADMIN).
    expect(await holdsUsuariosGerenciar(employeeLoginId)).toBe(false);
    await request(app.getHttpServer())
      .patch(`/companies/me/users/${employeeLoginId}/block`)
      .set('Authorization', adminToken)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/companies/me/users/${employeeLoginId}`)
      .set('Authorization', adminToken)
      .expect(204);
  });

  // Este é o teste que de fato falha SEM o fix C2 (verificado ao vivo removendo o early-return:
  // 400 em vez de 204). É o estado de TODA empresa que já existia antes deste plano, e o que
  // tornava block()/remove() completamente inutilizáveis: ninguém detém `usuarios.gerenciar` por
  // este join, então a contagem de "outros detentores" dá 0 e a checagem incondicional rejeitava
  // qualquer alvo, mesmo um que nunca teve nada a ver com o invariante protegido.
  it('empresa em que NINGUÉM detém usuarios.gerenciar (estado pré-backfill): excluir um login sem a permissão ainda funciona', async () => {
    const secondAdminId = await createAdminLogin();

    // Simula o estado legado: nenhum Profile da empresa concede `usuarios.gerenciar`.
    await sys(() => prisma.profilePermission.deleteMany({ where: { companyId, permissionCode: 'usuarios.gerenciar' } }));
    expect(await holdsUsuariosGerenciar(founderId)).toBe(false);
    expect(await holdsUsuariosGerenciar(secondAdminId)).toBe(false);

    await request(app.getHttpServer())
      .delete(`/companies/me/users/${secondAdminId}`)
      .set('Authorization', adminToken)
      .expect(204);
  });

  // ————— Quem gerencia a assinatura (27/09/2026): a mesma trava cobre `assinatura.gerenciar`. —————
  // Estado montado: o segundo ADMIN fica num perfil que concede `usuarios.gerenciar` MAS NÃO
  // `assinatura.gerenciar` — a trava de usuários passa (sobra um detentor), só a da assinatura segura.
  async function moveSecondAdminToUsersOnlyProfile(secondAdminId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', adminToken)
      .send({ name: `Só Usuários ${uniq()}`, grants: [{ permissionCode: 'usuarios.gerenciar', scope: 'EMPRESA' }] })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/companies/me/users/${secondAdminId}/profile`)
      .set('Authorization', adminToken)
      .send({ profileId: res.body.id })
      .expect(204);
    return res.body.id;
  }

  it('último detentor de assinatura.gerenciar: excluir ou bloquear é recusado com a mensagem da assinatura', async () => {
    const secondAdminId = await createAdminLogin();
    await moveSecondAdminToUsersOnlyProfile(secondAdminId);

    const del = await request(app.getHttpServer())
      .delete(`/companies/me/users/${founderId}`)
      .set('Authorization', adminToken)
      .expect(400);
    expect(del.body.message).toMatch(/permissão para gerenciar a assinatura/i);

    const block = await request(app.getHttpServer())
      .patch(`/companies/me/users/${founderId}/block`)
      .set('Authorization', adminToken)
      .expect(400);
    expect(block.body.message).toMatch(/permissão para gerenciar a assinatura/i);

    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: founderId } }));
    expect(founder.status).toBe('ACTIVE');
  });

  it('último detentor de assinatura.gerenciar: trocar o perfil dele por um sem a permissão é recusado', async () => {
    const secondAdminId = await createAdminLogin();
    const usersOnlyProfileId = await moveSecondAdminToUsersOnlyProfile(secondAdminId);

    const res = await request(app.getHttpServer())
      .patch(`/companies/me/users/${founderId}/profile`)
      .set('Authorization', adminToken)
      .send({ profileId: usersOnlyProfileId })
      .expect(400);
    expect(res.body.message).toMatch(/permissão para gerenciar a assinatura/i);
  });

  it('perfil compartilhado que é a única fonte de assinatura.gerenciar: remover a permissão (PATCH) ou reatribuir-e-excluir é recusado', async () => {
    // "Gestão" concede usuários + assinatura; o fundador vai pra ele e o Administrador Geral fica
    // sem nenhum login — "Gestão" vira a única fonte ATIVA da assinatura. O segundo admin (perfil
    // "Só Usuários") segura `usuarios.gerenciar`, então só a trava da assinatura pode disparar.
    const secondAdminId = await createAdminLogin();
    const usersOnlyProfileId = await moveSecondAdminToUsersOnlyProfile(secondAdminId);
    const gestao = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', adminToken)
      .send({
        name: `Gestão ${uniq()}`,
        grants: [
          { permissionCode: 'usuarios.gerenciar', scope: 'EMPRESA' },
          { permissionCode: 'assinatura.gerenciar' },
          { permissionCode: 'ponto.administrar', scope: 'EMPRESA' },
        ],
      })
      .expect(201);
    await sys(() => prisma.user.update({ where: { id: founderId }, data: { profileId: gestao.body.id } }));

    const patch = await request(app.getHttpServer())
      .patch(`/profiles/${gestao.body.id}`)
      .set('Authorization', adminToken)
      .send({
        name: 'Gestão sem assinatura',
        grants: [
          { permissionCode: 'usuarios.gerenciar', scope: 'EMPRESA' },
          { permissionCode: 'ponto.administrar', scope: 'EMPRESA' },
        ],
      })
      .expect(400);
    expect(patch.body.message).toMatch(/permissão para gerenciar a assinatura/i);

    const reassign = await request(app.getHttpServer())
      .post(`/profiles/${gestao.body.id}/reassign-and-delete`)
      .set('Authorization', adminToken)
      .send({ targetProfileId: usersOnlyProfileId });
    expect(reassign.status).toBe(400);
    expect(reassign.body.message).toMatch(/permissão para gerenciar a assinatura/i);

    const stillGranted = await sys(() =>
      prisma.profilePermission.findFirst({ where: { profileId: gestao.body.id, permissionCode: 'assinatura.gerenciar' } }),
    );
    expect(stillGranted).not.toBeNull();
  });

  // Os dois testes que existiam aqui ("um ADMIN de módulos restritos NÃO herda o perfil completo
  // do fundador — vai pra um perfil próprio" e "dois ADMINs com a mesma assinatura restrita
  // compartilham o mesmo perfil desambiguado") cobriam `getOrCreateProfileForSignature`/
  // `computeProfileSignature` sendo exercitados a partir de `POST /companies/me/users` com um
  // `modules: [...]` cru — o próprio mecanismo de "derivar/desambiguar um Profile automaticamente a
  // partir de `modules`" que `UsersService.create()` usava. Isso deixou de existir em `create()` na
  // Fase 2a (Task 7, authorization-profiles-screen, `1a824c5`): o endpoint agora exige um
  // `profileId` já escolhido pelo chamador, e nunca mais deriva um perfil a partir de `modules` — a
  // premissa central dos dois testes ("o backend cria/reaproveita um perfil sozinho a partir dos
  // módulos pedidos") não é mais alcançável por essa rota, então não há `profileId` que os deixe
  // passar sem reescrever o que eles de fato verificam. A LÓGICA em si
  // (`computeProfileSignature`/`getOrCreateProfileForSignature`) não foi removida do código —
  // continua coberta diretamente por `src/permissions/profile-signature.util.spec.ts` e em uso pelo
  // script de backfill (`backend/scripts/backfill-profiles.ts`, para empresas legadas de antes desta
  // fase) — só parou de ser alcançável via este endpoint HTTP, que é o que estes dois testes
  // exercitavam.
});
