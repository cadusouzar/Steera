import { Injectable } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { findDirectReportIds } from '../time-management/hierarchy.util';
import { PrismaService } from '../prisma/prisma.service';

// Central: calcula as permissões efetivas de um usuário (login/refresh — vai pro JWT) e resolve
// escopo (`PROPRIO`/`EQUIPE`/`DEPARTAMENTO`/`EMPRESA`) pra um resource aplicar num filtro de query.
// `'ALL'` (mesmo sentinela já usado em TimeManagementAuthService.getManageableEmployeeIds) sinaliza
// "sem filtro necessário", nunca materializa a lista inteira de funcionários da empresa.
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectivePermissions(userId: string): Promise<Record<string, Scope | null>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.profileId) return {};

    const grants = await this.prisma.profilePermission.findMany({ where: { profileId: user.profileId } });
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
      return findDirectReportIds(this.prisma, currentUser.companyId, own);
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
