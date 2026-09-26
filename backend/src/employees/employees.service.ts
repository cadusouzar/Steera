import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee, EmployeeStatus, Prisma } from '@prisma/client';
import { normalizeCpf } from '../common/cpf.util';
import { parseDateOnly } from '../common/date.util';
import { normalizePhone } from '../common/phone.util';
import { CompanyContextService } from '../company/company-context.service';
import { CustomFieldValuesService } from '../custom-fields/custom-field-values.service';
import { assertBelowPlanLimit } from '../plans/plan-limits.util';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly customFieldValues: CustomFieldValuesService,
  ) {}

  private async assertRoleUsable(roleId: string, companyId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId } });
    if (!role) throw new NotFoundException(`Cargo ${roleId} não encontrado`);
    if (!role.active) {
      throw new BadRequestException(`Cargo ${roleId} está inativo e não pode ser usado em novos vínculos`);
    }
  }

  // `currentEmployeeId` só é informado em update() (em create() o funcionário
  // ainda não existe, então nem auto-referência nem ciclo direto são
  // possíveis ainda). Ciclos de 3+ nós são uma limitação conhecida e
  // documentada, não tratada aqui de propósito (ver task brief).
  private async assertManagerUsable(managerId: string, companyId: string, currentEmployeeId?: string) {
    const manager = await this.prisma.employee.findFirst({ where: { id: managerId, companyId } });
    if (!manager) throw new NotFoundException(`Funcionário ${managerId} não encontrado`);

    if (currentEmployeeId && managerId === currentEmployeeId) {
      throw new BadRequestException('Um funcionário não pode ser seu próprio superior');
    }
    if (currentEmployeeId && manager.managerId === currentEmployeeId) {
      throw new BadRequestException(
        'Isso criaria um ciclo direto de hierarquia: o funcionário escolhido como superior já tem este funcionário como seu próprio superior',
      );
    }
  }

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    // Planos grátis e pagos (26/09/2026): teto de funcionários ativos do plano Grátis (ver plan-catalog.ts).
    await assertBelowPlanLimit(this.prisma, companyId, 'employees', () =>
      this.prisma.employee.count({ where: { companyId, status: EmployeeStatus.ACTIVE } }),
    );
    await this.assertRoleUsable(dto.roleId, companyId);
    const cpf = normalizeCpf(dto.cpf);

    const existingCpf = await this.prisma.employee.findFirst({ where: { companyId, cpf } });
    if (existingCpf) throw new ConflictException('Já existe um funcionário com este CPF nesta empresa');

    if (dto.managerId) {
      await this.assertManagerUsable(dto.managerId, companyId);
    }

    const { customFields, ...nativeDto } = dto;
    const resolvedCustomFields = await this.customFieldValues.resolveValuesForCreate('employee', customFields);

    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const created = await tx.employee.create({
        data: {
          companyId,
          roleId: nativeDto.roleId,
          fullName: nativeDto.fullName,
          cpf,
          email: nativeDto.email,
          phone: nativeDto.phone ? normalizePhone(nativeDto.phone) : nativeDto.phone,
          address: nativeDto.address,
          contractType: nativeDto.contractType,
          admissionDate: parseDateOnly(nativeDto.admissionDate),
          department: nativeDto.department,
          baseValue: nativeDto.baseValue,
          paymentDueDay: nativeDto.paymentDueDay,
          payOnLastBusinessDay: nativeDto.payOnLastBusinessDay ?? false,
          bankDetails: nativeDto.bankDetails,
          salaryRecurrenceEnabled: nativeDto.salaryRecurrenceEnabled ?? true,
          managerId: nativeDto.managerId,
        },
        include: { manager: { select: { fullName: true } } },
      });
      await this.customFieldValues.setValues('employee', created.id, resolvedCustomFields, tx);
      return this.withCustomFields(created, tx);
    });
  }

  async findAll(query: QueryEmployeesDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' as const } },
              { department: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { fullName: 'asc' } }),
      this.prisma.employee.count({ where }),
    ]);

    const customFieldsMap = await this.customFieldValues.getValuesForRecords('employee', items.map((i) => i.id));
    const itemsWithCustomFields = items.map((item) => ({ ...item, customFields: customFieldsMap.get(item.id) ?? {} }));

    return { items: itemsWithCustomFields, total, page, pageSize };
  }

  async assertExists(id: string): Promise<Employee> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) throw new NotFoundException(`Funcionário ${id} não encontrado`);
    return employee;
  }

  // Join com `manager` de propósito (diferente de assertExists, usado
  // internamente por outros módulos que só precisam de campos do próprio
  // Employee) — este é o único método chamado pelo GET /employees/:id, que
  // precisa do nome do superior pro mapper (employee-response.mapper.ts).
  async findOne(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: { manager: { select: { fullName: true } } },
    });
    if (!employee) throw new NotFoundException(`Funcionário ${id} não encontrado`);
    return this.withCustomFields(employee);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const employee = await this.assertExists(id);

    if (dto.roleId && dto.roleId !== employee.roleId) {
      await this.assertRoleUsable(dto.roleId, employee.companyId);
    }

    if (dto.managerId && dto.managerId !== employee.managerId) {
      await this.assertManagerUsable(dto.managerId, employee.companyId, id);
    }

    let cpf: string | undefined;
    if (dto.cpf !== undefined) {
      cpf = normalizeCpf(dto.cpf);
      const conflict = await this.prisma.employee.findFirst({
        where: { companyId: employee.companyId, cpf, NOT: { id } },
      });
      if (conflict) throw new ConflictException('Já existe um funcionário com este CPF nesta empresa');
    }

    let phone: string | undefined;
    if (dto.phone !== undefined) {
      phone = normalizePhone(dto.phone);
    }

    const { customFields, ...nativeDto } = dto;

    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: {
          ...nativeDto,
          ...(cpf ? { cpf } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(nativeDto.admissionDate ? { admissionDate: parseDateOnly(nativeDto.admissionDate) } : {}),
        },
        include: { manager: { select: { fullName: true } } },
      });
      if (customFields) await this.customFieldValues.setValues('employee', id, customFields, tx);
      return this.withCustomFields(updated, tx);
    });
  }

  // `tx` opcional: create/update já estão dentro de uma transação de tenant e passam a mesma pra
  // reaproveitar a conexão (ver o comentário em CustomFieldValuesService.getActiveDefinitions).
  private async withCustomFields<T extends { id: string }>(
    record: T,
    tx?: Prisma.TransactionClient,
  ): Promise<T & { customFields: Record<string, unknown> }> {
    const map = await this.customFieldValues.getValuesForRecords('employee', [record.id], tx);
    return { ...record, customFields: map.get(record.id) ?? {} };
  }

  // Nunca apaga o funcionário — só marca INACTIVE e, na mesma transação,
  // pausa as recorrências ativas dele (mesmo padrão de
  // ClientsService.deactivate, que pausa Subscriptions ativas do cliente —
  // impede novas recorrências futuras sem apagar o histórico já gerado).
  async deactivate(id: string) {
    const employee = await this.assertExists(id);
    if (employee.status === EmployeeStatus.INACTIVE) {
      throw new ConflictException(`Funcionário ${id} já está inativo`);
    }

    const updated = await runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const result = await tx.employee.update({
        where: { id },
        data: { status: EmployeeStatus.INACTIVE, terminationDate: new Date() },
      });
      await tx.employeeRecurringPayment.updateMany({
        where: { employeeId: id, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
      return result;
    });

    return updated;
  }

  async reactivate(id: string) {
    const employee = await this.assertExists(id);
    if (employee.status === EmployeeStatus.ACTIVE) {
      throw new ConflictException(`Funcionário ${id} já está ativo`);
    }
    // Planos grátis e pagos (26/09/2026): teto de funcionários ativos do plano Grátis (ver plan-catalog.ts).
    await assertBelowPlanLimit(this.prisma, employee.companyId, 'employees', () =>
      this.prisma.employee.count({ where: { companyId: employee.companyId, status: EmployeeStatus.ACTIVE } }),
    );
    return this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.ACTIVE, terminationDate: null },
    });
  }
}
