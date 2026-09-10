import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // Checagem em nível de aplicação (não uma constraint única no banco): o
  // risco de corrida de um duplo-clique cadastrando dois cargos com o mesmo
  // nome é aceitável aqui — diferente da geração de fatura recorrente, onde
  // duplicidade tem impacto financeiro direto (ver SubscriptionsService).
  private async assertNoActiveDuplicate(companyId: string, name: string, excludeId?: string) {
    const conflict = await this.prisma.role.findFirst({
      where: { companyId, name, active: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (conflict) throw new ConflictException(`Já existe um cargo ativo com o nome "${name}"`);
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    await this.assertNoActiveDuplicate(companyId, dto.name);
    return this.prisma.role.create({
      data: { ...dto, companyId, colorHex: dto.colorHex ?? '#2563EB' },
    });
  }

  async findAll(query: QueryRolesDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { department: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.role.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { name: 'asc' } }),
      this.prisma.role.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findActive() {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.role.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } });
  }

  private async assertExists(id: string): Promise<Role> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const role = await this.prisma.role.findFirst({ where: { id, companyId } });
    if (!role) throw new NotFoundException(`Cargo ${id} não encontrado`);
    return role;
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.assertExists(id);
    if (dto.name && dto.name !== role.name) {
      await this.assertNoActiveDuplicate(role.companyId, dto.name, id);
    }
    return this.prisma.role.update({ where: { id }, data: dto });
  }

  async deactivate(id: string) {
    const role = await this.assertExists(id);
    if (!role.active) throw new ConflictException(`Cargo ${id} já está inativo`);
    return this.prisma.role.update({ where: { id }, data: { active: false } });
  }

  async reactivate(id: string) {
    const role = await this.assertExists(id);
    if (role.active) throw new ConflictException(`Cargo ${id} já está ativo`);
    await this.assertNoActiveDuplicate(role.companyId, role.name, id);
    return this.prisma.role.update({ where: { id }, data: { active: true } });
  }
}
