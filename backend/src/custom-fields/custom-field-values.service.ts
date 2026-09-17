import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomFieldDefinition, CustomFieldType, Prisma } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CUSTOM_FIELD_ENTITIES, CustomFieldEntityKey } from './custom-field-entities';

type ConfigurationWithOptions = { options?: string[] };

@Injectable()
export class CustomFieldValuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async getActiveDefinitions(entity: CustomFieldEntityKey): Promise<CustomFieldDefinition[]> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.customFieldDefinition.findMany({
      where: { companyId, entity, active: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getValuesForRecords(
    entity: CustomFieldEntityKey,
    recordIds: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const result = new Map<string, Record<string, unknown>>();
    if (recordIds.length === 0) return result;

    const definitions = await this.getActiveDefinitions(entity);
    if (definitions.length === 0) return result;

    const tableName = CUSTOM_FIELD_ENTITIES[entity];
    const columns = definitions.map((d) => `"${d.columnName}"`).join(', ');
    const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, ${columns} FROM "${tableName}" WHERE id IN (${placeholders})`,
      ...recordIds,
    );

    for (const row of rows) {
      const { id, ...values } = row;
      result.set(id as string, values);
    }
    return result;
  }

  // Chamado ANTES de criar o registro nativo: monta o objeto final de valores (aplicando
  // defaultValue pra quem não veio no body) e valida obrigatoriedade — nunca grava um campo
  // required como NULL silenciosamente.
  async resolveValuesForCreate(
    entity: CustomFieldEntityKey,
    values: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const definitions = await this.getActiveDefinitions(entity);
    const resolved: Record<string, unknown> = { ...(values ?? {}) };
    for (const def of definitions) {
      if (resolved[def.columnName] === undefined) {
        if (def.defaultValue !== null && def.defaultValue !== undefined) {
          resolved[def.columnName] = this.parseDefaultValue(def);
        } else if (def.required) {
          throw new BadRequestException(`O campo "${def.displayName}" é obrigatório`);
        }
      }
    }
    return resolved;
  }

  // Escreve só as colunas PRESENTES em `values` (update parcial — colunas ausentes mantêm seu
  // valor atual). Deve rodar dentro da mesma transação da escrita nativa (ver Task 5).
  async setValues(
    entity: CustomFieldEntityKey,
    recordId: string,
    values: Record<string, unknown> | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const definitions = await this.getActiveDefinitions(entity);
    if (definitions.length === 0) return;

    const provided = values ?? {};
    const unknownKeys = Object.keys(provided).filter((k) => !definitions.some((d) => d.columnName === k));
    if (unknownKeys.length > 0) {
      throw new BadRequestException(`Campo(s) personalizado(s) desconhecido(s): ${unknownKeys.join(', ')}`);
    }

    const assignments: { column: string; value: unknown; isArray: boolean }[] = [];
    for (const def of definitions) {
      if (!(def.columnName in provided)) continue;
      const resolved = this.validateValue(def, provided[def.columnName]);
      assignments.push({ column: def.columnName, value: resolved, isArray: def.type === CustomFieldType.MULTI_SELECT });
    }
    if (assignments.length === 0) return;

    const tableName = CUSTOM_FIELD_ENTITIES[entity];
    const setClauses = assignments
      .map((a, i) => `"${a.column}" = $${i + 1}${a.isArray ? '::text[]' : ''}`)
      .join(', ');
    const params = [...assignments.map((a) => a.value), recordId];
    await tx.$executeRawUnsafe(`UPDATE "${tableName}" SET ${setClauses} WHERE id = $${params.length}`, ...params);
  }

  private validateValue(definition: CustomFieldDefinition, value: unknown): unknown {
    if (value === null || value === undefined) {
      if (definition.required) {
        throw new BadRequestException(`O campo "${definition.displayName}" é obrigatório`);
      }
      return null;
    }
    switch (definition.type) {
      case CustomFieldType.NUMBER:
      case CustomFieldType.CURRENCY: {
        const n = Number(value);
        if (Number.isNaN(n)) throw new BadRequestException(`O campo "${definition.displayName}" precisa ser um número`);
        return n;
      }
      case CustomFieldType.BOOLEAN:
        if (typeof value !== 'boolean') {
          throw new BadRequestException(`O campo "${definition.displayName}" precisa ser sim ou não`);
        }
        return value;
      case CustomFieldType.SELECT: {
        const options = (definition.configuration as ConfigurationWithOptions | null)?.options ?? [];
        if (!options.includes(String(value))) {
          throw new BadRequestException(`Valor inválido para o campo "${definition.displayName}"`);
        }
        return String(value);
      }
      case CustomFieldType.MULTI_SELECT: {
        const options = (definition.configuration as ConfigurationWithOptions | null)?.options ?? [];
        if (!Array.isArray(value) || value.some((v) => !options.includes(String(v)))) {
          throw new BadRequestException(`Valor inválido para o campo "${definition.displayName}"`);
        }
        return value.map(String);
      }
      case CustomFieldType.EMAIL:
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          throw new BadRequestException(`O campo "${definition.displayName}" precisa ser um e-mail válido`);
        }
        return String(value);
      default:
        return String(value);
    }
  }

  private parseDefaultValue(def: CustomFieldDefinition): unknown {
    switch (def.type) {
      case CustomFieldType.NUMBER:
      case CustomFieldType.CURRENCY:
        return Number(def.defaultValue);
      case CustomFieldType.BOOLEAN:
        return def.defaultValue === 'true';
      case CustomFieldType.MULTI_SELECT:
        return JSON.parse(def.defaultValue as string);
      default:
        return def.defaultValue;
    }
  }
}
