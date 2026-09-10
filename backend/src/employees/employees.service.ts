import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee, EmployeeStatus } from '@prisma/client';
import { normalizeCpf } from '../common/cpf.util';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private async assertRoleUsable(roleId: string, companyId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId } });
    if (!role) throw new NotFoundException(`Cargo ${roleId} não encontrado`);
    if (!role.active) {
      throw new BadRequestException(`Cargo ${roleId} está inativo e não pode ser usado em novos vínculos`);
    }
  }

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    await this.assertRoleUsable(dto.roleId, companyId);
    const cpf = normalizeCpf(dto.cpf);

    const existingCpf = await this.prisma.employee.findFirst({ where: { companyId, cpf } });
    if (existingCpf) throw new ConflictException('Já existe um funcionário com este CPF nesta empresa');

    return this.prisma.employee.create({
      data: {
        companyId,
        roleId: dto.roleId,
        fullName: dto.fullName,
        cpf,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        contractType: dto.contractType,
        admissionDate: parseDateOnly(dto.admissionDate),
        department: dto.department,
        baseValue: dto.baseValue,
        paymentDueDay: dto.paymentDueDay,
        payOnLastBusinessDay: dto.payOnLastBusinessDay ?? false,
        bankDetails: dto.bankDetails,
        salaryRecurrenceEnabled: dto.salaryRecurrenceEnabled ?? true,
      },
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

    return { items, total, page, pageSize };
  }

  async assertExists(id: string): Promise<Employee> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) throw new NotFoundException(`Funcionário ${id} não encontrado`);
    return employee;
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const employee = await this.assertExists(id);

    if (dto.roleId && dto.roleId !== employee.roleId) {
      await this.assertRoleUsable(dto.roleId, employee.companyId);
    }

    let cpf: string | undefined;
    if (dto.cpf !== undefined) {
      cpf = normalizeCpf(dto.cpf);
      const conflict = await this.prisma.employee.findFirst({
        where: { companyId: employee.companyId, cpf, NOT: { id } },
      });
      if (conflict) throw new ConflictException('Já existe um funcionário com este CPF nesta empresa');
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        ...(cpf ? { cpf } : {}),
        ...(dto.admissionDate ? { admissionDate: parseDateOnly(dto.admissionDate) } : {}),
      },
    });
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

    const [updated] = await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id },
        data: { status: EmployeeStatus.INACTIVE, terminationDate: new Date() },
      }),
      this.prisma.employeeRecurringPayment.updateMany({
        where: { employeeId: id, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      }),
    ]);

    return updated;
  }

  async reactivate(id: string) {
    const employee = await this.assertExists(id);
    if (employee.status === EmployeeStatus.ACTIVE) {
      throw new ConflictException(`Funcionário ${id} já está ativo`);
    }
    return this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.ACTIVE, terminationDate: null },
    });
  }
}
