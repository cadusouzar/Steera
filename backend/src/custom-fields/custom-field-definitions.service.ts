import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomFieldDefinition, CustomFieldType, Prisma } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { assertValidCustomColumnName, buildCustomColumnName, POSTGRES_TYPE_BY_FIELD_TYPE } from './custom-field-column.util';
import { CUSTOM_FIELD_ENTITIES, CustomFieldEntityKey } from './custom-field-entities';
import { CreateCustomFieldDefinitionDto } from './dto/create-custom-field-definition.dto';
import { UpdateCustomFieldDefinitionDto } from './dto/update-custom-field-definition.dto';

@Injectable()
export class CustomFieldDefinitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async findAll(entity: CustomFieldEntityKey): Promise<CustomFieldDefinition[]> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.customFieldDefinition.findMany({
      where: { companyId, entity },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async create(dto: CreateCustomFieldDefinitionDto): Promise<CustomFieldDefinition> {
    if (dto.type === CustomFieldType.SELECT || dto.type === CustomFieldType.MULTI_SELECT) {
      if (!dto.configuration?.options || dto.configuration.options.length === 0) {
        throw new BadRequestException('Campos de lista de opções precisam de pelo menos uma opção');
      }
    }
    const companyId = await this.companyContext.getCurrentCompanyId();
    const entity = dto.entity as CustomFieldEntityKey;

    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      // Serializa criações concorrentes de campo pra mesma empresa+entidade — sem isso, duas
      // tentativas na mesma janela ainda seriam bloqueadas pelo Postgres (coluna duplicada), só que
      // como um erro cru em vez de uma checagem de colisão limpa.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':' + entity}))`;

      const existing = await tx.customFieldDefinition.findMany({ where: { companyId, entity } });
      const columnName = buildCustomColumnName(dto.displayName, existing.map((d) => d.columnName));
      assertValidCustomColumnName(columnName);

      const tableName = CUSTOM_FIELD_ENTITIES[entity];
      const pgType = POSTGRES_TYPE_BY_FIELD_TYPE[dto.type];
      await tx.$executeRawUnsafe(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${pgType}`);

      return tx.customFieldDefinition.create({
        data: {
          companyId,
          entity,
          displayName: dto.displayName,
          columnName,
          type: dto.type,
          required: dto.required ?? false,
          defaultValue: dto.defaultValue,
          description: dto.description,
          configuration: (dto.configuration ?? undefined) as Prisma.InputJsonValue,
          displayOrder: dto.displayOrder ?? existing.length,
          active: true,
        },
      });
    });
  }

  async update(id: string, dto: UpdateCustomFieldDefinitionDto): Promise<CustomFieldDefinition> {
    await this.assertExists(id);
    return this.prisma.customFieldDefinition.update({
      where: { id },
      data: { ...dto, configuration: (dto.configuration ?? undefined) as Prisma.InputJsonValue },
    });
  }

  async deactivate(id: string): Promise<CustomFieldDefinition> {
    const def = await this.assertExists(id);
    if (!def.active) throw new ConflictException('Campo já está desativado');
    return this.prisma.customFieldDefinition.update({ where: { id }, data: { active: false } });
  }

  async reactivate(id: string): Promise<CustomFieldDefinition> {
    const def = await this.assertExists(id);
    if (def.active) throw new ConflictException('Campo já está ativo');
    return this.prisma.customFieldDefinition.update({ where: { id }, data: { active: true } });
  }

  async countFilledValues(id: string): Promise<number> {
    const def = await this.assertExists(id);
    const tableName = CUSTOM_FIELD_ENTITIES[def.entity as CustomFieldEntityKey];
    const rows = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint as count FROM "${tableName}" WHERE "${def.columnName}" IS NOT NULL`,
    );
    return Number(rows[0].count);
  }

  async remove(id: string): Promise<void> {
    const def = await this.assertExists(id);
    await runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const tableName = CUSTOM_FIELD_ENTITIES[def.entity as CustomFieldEntityKey];
      await tx.$executeRawUnsafe(`ALTER TABLE "${tableName}" DROP COLUMN "${def.columnName}"`);
      await tx.customFieldDefinition.delete({ where: { id } });
    });
  }

  private async assertExists(id: string): Promise<CustomFieldDefinition> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const def = await this.prisma.customFieldDefinition.findFirst({ where: { id, companyId } });
    if (!def) throw new NotFoundException(`Campo personalizado ${id} não encontrado`);
    return def;
  }
}
