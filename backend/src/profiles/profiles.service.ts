import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { runInsideExplicitTenantTransaction } from '../prisma/tenant-context';
import { recomputeAndSaveUserAccess } from '../permissions/profile-assignment.util';
import { assertNotLastHolderOfPermission } from '../users/last-permission-holder.util';
import { CreateProfileDto, ProfileGrantDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

interface ProfileWithCount {
  id: string;
  name: string;
  isProtected: boolean;
  permissions: { permissionCode: string; scope: Scope | null }[];
  _count: { users: number };
}

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForCompany(companyId: string) {
    const profiles = await this.prisma.profile.findMany({
      where: { companyId },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return profiles.map((p) => this.toPublicProfile(p));
  }

  async findOne(companyId: string, id: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { id, companyId },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    if (!profile) throw new NotFoundException(`Perfil ${id} não encontrado nesta empresa`);
    return this.toPublicProfile(profile);
  }

  async create(companyId: string, dto: CreateProfileDto) {
    this.validateGrants(dto.grants);
    const profile = await this.prisma.profile.create({
      data: {
        companyId,
        name: dto.name,
        isProtected: false,
        permissions: {
          create: dto.grants.map((g) => ({ companyId, permissionCode: g.permissionCode, scope: g.scope ?? null })),
        },
      },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    return this.toPublicProfile(profile);
  }

  async update(companyId: string, id: string, dto: UpdateProfileDto) {
    this.validateGrants(dto.grants);
    const profile = await this.prisma.profile.findFirst({ where: { id, companyId } });
    if (!profile) throw new NotFoundException(`Perfil ${id} não encontrado nesta empresa`);
    if (profile.isProtected) {
      throw new ForbiddenException('Este perfil é protegido e não pode ser editado');
    }

    const willGrantUsuariosGerenciar = dto.grants.some((g) => g.permissionCode === 'usuarios.gerenciar');

    // Transação montada à mão no client CENTRAL (nunca runTenantTransaction/
    // runTenantInteractiveTransaction) — mesmo padrão e mesmo motivo já usado por
    // UsersService.block()/remove(): `User`/`Profile`/`ProfilePermission` são tabelas CENTRAIS,
    // inalcançáveis por um client de TENANT. O `set_config` de RLS é emitido manualmente como
    // primeira instrução.
    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId})::bigint)`;

        const affectedUsers = await tx.user.findMany({ where: { profileId: id, status: 'ACTIVE' } });

        if (!willGrantUsuariosGerenciar) {
          // Sequencial de propósito (nunca Promise.all) — cada checagem precisa enxergar o estado
          // já gravado pelos usuários anteriores desta mesma leva, senão um lote que zera os
          // detentores da empresa passaria sem ser detectado (ver Global Constraints do plano).
          for (const user of affectedUsers) {
            await assertNotLastHolderOfPermission(tx, companyId, 'usuarios.gerenciar', user.id);
          }
        }

        await tx.profilePermission.deleteMany({ where: { profileId: id } });
        await tx.profilePermission.createMany({
          data: dto.grants.map((g) => ({ companyId, profileId: id, permissionCode: g.permissionCode, scope: g.scope ?? null })),
        });
        await tx.profile.update({ where: { id }, data: { name: dto.name } });

        for (const user of affectedUsers) {
          await recomputeAndSaveUserAccess(tx, user.id, id);
        }
      }),
    );

    return this.findOne(companyId, id);
  }

  // Reaproveitado pelas Tasks 4/5 (validação idêntica ao editar) — método protegido, não privado.
  protected validateGrants(grants: ProfileGrantDto[]): void {
    for (const g of grants) {
      const def = PERMISSION_CATALOG.find((p) => p.code === g.permissionCode);
      if (!def) throw new BadRequestException(`Permissão desconhecida: ${g.permissionCode}`);
      if (def.validScopes.length === 0) {
        if (g.scope != null) {
          throw new BadRequestException(`A permissão "${def.labelPt}" não aceita alcance (scope)`);
        }
      } else if (g.scope == null || !def.validScopes.includes(g.scope)) {
        throw new BadRequestException(
          `A permissão "${def.labelPt}" precisa de um alcance válido: ${def.validScopes.join(', ')}`,
        );
      }
    }
    const codes = grants.map((g) => g.permissionCode);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException('Cada permissão só pode aparecer uma vez na lista');
    }
  }

  protected toPublicProfile(profile: ProfileWithCount) {
    return {
      id: profile.id,
      name: profile.name,
      isProtected: profile.isProtected,
      userCount: profile._count.users,
      grants: profile.permissions.map((p) => ({ permissionCode: p.permissionCode, scope: p.scope })),
    };
  }
}
