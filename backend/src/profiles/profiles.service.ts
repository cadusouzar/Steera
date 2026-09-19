import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { CreateProfileDto, ProfileGrantDto } from './dto/create-profile.dto';

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
