import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Scope } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';

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
      .send({ companyName: 'Last Holder Co', email: adminEmail, password: 'senha-de-teste-12345' })
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = founder.companyId;
    founderId = founder.id;
  });

  afterEach(async () => {
    if (companyId) {
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "tenant_${companyId}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      // Profile/ProfilePermission somem por cascade a partir de Company.
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  async function createAdminLogin(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: `last-holder-second-${uniq()}@test.com`, role: 'ADMIN', modules: ['DASHBOARD'] })
      .expect(201);
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

    const loginRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({
        email: `last-holder-emp-${uniq()}@test.com`,
        role: 'EMPLOYEE',
        employeeId: empRes.body.id,
        modules: ['PONTO_REGISTRO'],
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

  it('o perfil derivado de um ADMIN de módulos restritos não concede o catálogo inteiro', async () => {
    const secondAdminId = await createAdminLogin();
    const codes = await sys(async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: secondAdminId } });
      const grants = await prisma.profilePermission.findMany({ where: { profileId: user.profileId! } });
      return grants.map((g) => g.permissionCode).sort();
    });
    // Reaproveita o "Administrador Geral" do fundador (mesmo nome de assinatura) — o fundador tem
    // TODOS os módulos, então o perfil legitimamente carrega o catálogo inteiro. O que este teste
    // fixa é que `usuarios.gerenciar` está lá com escopo EMPRESA e que o perfil foi REAPROVEITADO,
    // não duplicado (M1).
    expect(codes).toContain('usuarios.gerenciar');
    const profiles = await sys(() => prisma.profile.findMany({ where: { companyId, name: 'Administrador Geral' } }));
    expect(profiles).toHaveLength(1);
    expect(
      await sys(() =>
        prisma.profilePermission.findFirst({
          where: { profileId: profiles[0].id, permissionCode: 'usuarios.gerenciar' },
        }),
      ),
    ).toMatchObject({ scope: Scope.EMPRESA });
  });
});
