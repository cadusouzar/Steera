import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { CustomFieldValuesService } from '../custom-fields/custom-field-values.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly customFieldValues: CustomFieldValuesService,
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
    const { customFields, ...nativeDto } = dto;
    const resolvedCustomFields = await this.customFieldValues.resolveValuesForCreate('role', customFields);

    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const created = await tx.role.create({
        data: { ...nativeDto, companyId, colorHex: dto.colorHex ?? '#2563EB' },
      });
      await this.customFieldValues.setValues('role', created.id, resolvedCustomFields, tx);
      return this.withCustomFields(created, tx);
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

    const customFieldsMap = await this.customFieldValues.getValuesForRecords('role', items.map((i) => i.id));
    const itemsWithCustomFields = items.map((item) => ({ ...item, customFields: customFieldsMap.get(item.id) ?? {} }));

    return { items: itemsWithCustomFields, total, page, pageSize };
  }

  async findActive() {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const items = await this.prisma.role.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } });
    const customFieldsMap = await this.customFieldValues.getValuesForRecords('role', items.map((i) => i.id));
    return items.map((item) => ({ ...item, customFields: customFieldsMap.get(item.id) ?? {} }));
  }

  private async assertExists(id: string): Promise<Role> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const role = await this.prisma.role.findFirst({ where: { id, companyId } });
    if (!role) throw new NotFoundException(`Cargo ${id} não encontrado`);
    return role;
  }

  findOne(id: string) {
    return this.assertExists(id).then((role) => this.withCustomFields(role));
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.assertExists(id);
    if (dto.name && dto.name !== role.name) {
      await this.assertNoActiveDuplicate(role.companyId, dto.name, id);
    }
    const { customFields, ...nativeDto } = dto;

    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const updated = await tx.role.update({ where: { id }, data: nativeDto });
      if (customFields) await this.customFieldValues.setValues('role', id, customFields, tx);
      return this.withCustomFields(updated, tx);
    });
  }

  // `tx` opcional: create/update já estão dentro de uma transação de tenant e passam a mesma pra
  // reaproveitar a conexão (ver o comentário em CustomFieldValuesService.getActiveDefinitions).
  private async withCustomFields<T extends { id: string }>(
    record: T,
    tx?: Prisma.TransactionClient,
  ): Promise<T & { customFields: Record<string, unknown> }> {
    const map = await this.customFieldValues.getValuesForRecords('role', [record.id], tx);
    return { ...record, customFields: map.get(record.id) ?? {} };
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
