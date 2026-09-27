import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { findDirectReportIds } from '../time-management/hierarchy.util';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { PrismaService } from '../prisma/prisma.service';

// Central: calcula as permissões efetivas de um usuário (login/refresh — vai pro JWT) e resolve
// escopo (`PROPRIO`/`EQUIPE`/`DEPARTAMENTO`/`EMPRESA`) pra um resource aplicar num filtro de query.
// `'ALL'` (mesmo sentinela já usado em TimeManagementAuthService.getManageableEmployeeIds) sinaliza
// "sem filtro necessário", nunca materializa a lista inteira de funcionários da empresa.
@Injectable()
export class AuthorizationService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  // Auto-semeadura do catálogo de permissões (achado crítico na revisão final da branch de
  // authorization-architecture): `ProfilePermission.permissionCode` tem uma FK `ON DELETE RESTRICT`
  // pra `Permission.code`, e `POST /auth/register` insere uma linha de ProfilePermission por
  // entrada do catálogo. Com a tabela `Permission` vazia (nenhum ambiente rodava
  // `npm run seed:permissions`, um script manual que nunca foi chamado por migration nem por boot),
  // TODO register() falhava com um P2003 cru virando 500 — ou seja, nenhuma empresa nova conseguia
  // ser criada num banco recém-migrado. Semear aqui, no boot, torna o catálogo auto-suficiente:
  // `Permission` é um catálogo COMPARTILHADO por todo o sistema (sem `companyId`, sem RLS — ver a
  // seção RLS da migration 20260918194622_add_authorization_core, que habilita RLS só em
  // `Profile`/`ProfilePermission`), então não precisa de `runAsSystem`/contexto de tenant nenhum.
  // `scripts/seed-permissions.ts` continua existindo como ferramenta manual/de CI, só deixou de ser
  // o único caminho pra correção.
  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const p of PERMISSION_CATALOG) {
        await this.prisma.permission.upsert({
          where: { code: p.code },
          create: { code: p.code, resource: p.resource, action: p.action, labelPt: p.labelPt, validScopes: p.validScopes },
          update: { resource: p.resource, action: p.action, labelPt: p.labelPt, validScopes: p.validScopes },
        });
      }
    } catch (err) {
      // Nunca derruba o boot — mesmo padrão de BillingSchedulerService/TenantMigrationManagerService:
      // uma falha aqui não deve impedir o resto da aplicação de subir; o próximo boot tenta de novo.
      // eslint-disable-next-line no-console
      console.error('Falha ao semear o catálogo de permissões:', err);
    }
  }

  async getEffectivePermissions(userId: string): Promise<Record<string, Scope | null>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.profileId) return {};

    // `companyId` explícito além do `profileId` (defesa em profundidade, mesma postura já usada em
    // praticamente toda query deste projeto): não existe FK composta garantindo que o `Profile`
    // apontado por `User.profileId` pertença à MESMA empresa do usuário, então hoje isso só é
    // seguro porque nenhum caminho de código escreve um `profileId` cross-company. Filtrar aqui
    // fecha estruturalmente a possibilidade de um perfil de outra empresa virar permissão no JWT.
    const grants = await this.prisma.profilePermission.findMany({
      where: { profileId: user.profileId, companyId: user.companyId },
    });
    const result: Record<string, Scope | null> = {};
    for (const grant of grants) {
      result[grant.permissionCode] = grant.scope;
    }
    return result;
  }

  // Resolve o Employee vinculado ao login atual — retorna null se não houver vínculo (fundador
  // ainda não linkado), nunca lança. Todo resolvedor abaixo depende disso.
  private async resolveOwnEmployee(currentUser: AuthenticatedUser): Promise<{ id: string; departmentId: string | null } | null> {
    const userRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!userRecord?.employeeId) return null;
    return this.prisma.employee.findUnique({ where: { id: userRecord.employeeId }, select: { id: true, departmentId: true } });
  }

  async resolveScope(scope: Scope, currentUser: AuthenticatedUser): Promise<string[] | 'ALL'> {
    if (scope === Scope.EMPRESA) return 'ALL';

    if (scope === Scope.PROPRIO) {
      const own = await this.getOwnEmployeeIdOrNull(currentUser);
      return own ? [own] : [];
    }

    if (scope === Scope.EQUIPE) {
      const own = await this.getOwnEmployeeIdOrNull(currentUser);
      if (!own) return [];
      // EQUIPE = a própria pessoa + subordinados diretos (sem propagação em cadeia) — o próprio id
      // vem primeiro, pra quem só tem EQUIPE também enxergar/administrar a própria ficha.
      const reports = await findDirectReportIds(this.prisma, currentUser.companyId, own);
      return [own, ...reports];
    }

    // DEPARTAMENTO
    const employee = await this.resolveOwnEmployee(currentUser);
    if (!employee?.departmentId) return [];
    const peers = await this.prisma.employee.findMany({
      where: { departmentId: employee.departmentId, companyId: currentUser.companyId },
      select: { id: true },
    });
    return peers.map((p) => p.id);
  }

  private async getOwnEmployeeIdOrNull(currentUser: AuthenticatedUser): Promise<string | null> {
    const userRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    return userRecord?.employeeId ?? null;
  }
}
