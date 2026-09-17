import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomFieldDefinition, CustomFieldType, Prisma } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { CUSTOM_FIELD_ENTITIES, CustomFieldEntityKey } from './custom-field-entities';

type ConfigurationWithOptions = { options?: string[] };

@Injectable()
export class CustomFieldValuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // `tx` opcional: quando o chamador já está dentro de uma transação de tenant (ex.:
  // ClientsService.create/update, via runTenantInteractiveTransaction), passar o mesmo `tx` aqui
  // reaproveita a MESMA conexão em vez de abrir uma segunda contra o pool (deliberadamente pequeno,
  // ver TENANT_CLIENT_CONNECTION_LIMIT) daquela empresa — crítico sob concorrência real (achado ao
  // rodar o teste de stress de conexões: sem isso, cada create() com campos personalizados ativos
  // disputava conexão consigo mesmo e estourava o timeout de transação interativa). Sem `tx` (uso
  // isolado, ex.: GET /custom-fields/active), cai pro client central de sempre.
  async getActiveDefinitions(
    entity: CustomFieldEntityKey,
    tx?: Prisma.TransactionClient,
  ): Promise<CustomFieldDefinition[]> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const client = tx ?? this.prisma;
    return client.customFieldDefinition.findMany({
      where: { companyId, entity, active: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  // `$queryRawUnsafe` nunca passa pela extensão de roteamento schema-per-tenant (é uma limitação
  // conhecida da própria extensão, documentada em tenant-rls.extension.ts — só operações de MODEL
  // são interceptadas). Chamado com um `tx` já aberto (dentro de uma transação de tenant), a leitura
  // roda direto nessa conexão, que já tem o search_path certo. Chamado sem `tx` (findOne/findAll,
  // fora de qualquer transação), abre uma transação interativa só pra ganhar esse mesmo search_path
  // corrigido — sem isso, uma empresa com schema físico próprio sempre lia `public."Client"` (vazio
  // ou de outra empresa), nunca o próprio schema, mesmo com o valor gravado com sucesso.
  async getValuesForRecords(
    entity: CustomFieldEntityKey,
    recordIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, Record<string, unknown>>> {
    const result = new Map<string, Record<string, unknown>>();
    if (recordIds.length === 0) return result;

    const definitions = await this.getActiveDefinitions(entity, tx);
    if (definitions.length === 0) return result;

    const tableName = CUSTOM_FIELD_ENTITIES[entity];
    const columns = definitions.map((d) => `"${d.columnName}"`).join(', ');
    const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `SELECT id, ${columns} FROM "${tableName}" WHERE id IN (${placeholders})`;

    const rows = tx
      ? await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...recordIds)
      : await runTenantInteractiveTransaction(this.prisma, (t) =>
          t.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...recordIds),
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
    tx?: Prisma.TransactionClient,
  ): Promise<Record<string, unknown>> {
    const definitions = await this.getActiveDefinitions(entity, tx);
    const provided = values ?? {};

    const unknownKeys = Object.keys(provided).filter((k) => !definitions.some((d) => d.columnName === k));
    if (unknownKeys.length > 0) {
      throw new BadRequestException(`Campo(s) personalizado(s) desconhecido(s): ${unknownKeys.join(', ')}`);
    }

    const resolved: Record<string, unknown> = {};
    for (const def of definitions) {
      if (def.columnName in provided) {
        resolved[def.columnName] = this.validateValue(def, provided[def.columnName]);
      } else if (def.defaultValue !== null && def.defaultValue !== undefined) {
        resolved[def.columnName] = this.parseDefaultValue(def);
      } else if (def.required) {
        throw new BadRequestException(`O campo "${def.displayName}" é obrigatório`);
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
    const definitions = await this.getActiveDefinitions(entity, tx);
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
