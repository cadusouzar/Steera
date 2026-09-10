import { Injectable, NotFoundException } from '@nestjs/common';
import { parseDateOnly } from '../common/date.util';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeWarningDto } from './dto/create-employee-warning.dto';
import { UpdateEmployeeWarningDto } from './dto/update-employee-warning.dto';

@Injectable()
export class EmployeeWarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
  ) {}

  async create(employeeId: string, dto: CreateEmployeeWarningDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.prisma.employeeWarning.create({
      data: {
        companyId: employee.companyId,
        employeeId,
        occurredAt: parseDateOnly(dto.occurredAt),
        reason: dto.reason,
      },
    });
  }

  async findAllForEmployee(employeeId: string) {
    await this.employeesService.assertExists(employeeId);
    return this.prisma.employeeWarning.findMany({ where: { employeeId }, orderBy: { occurredAt: 'desc' } });
  }

  private async assertExists(id: string, companyId: string) {
    const warning = await this.prisma.employeeWarning.findFirst({ where: { id, companyId } });
    if (!warning) throw new NotFoundException(`Advertência ${id} não encontrada`);
    return warning;
  }

  async findOne(id: string, employeeId: string) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.assertExists(id, employee.companyId);
  }

  async update(id: string, employeeId: string, dto: UpdateEmployeeWarningDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    await this.assertExists(id, employee.companyId);
    return this.prisma.employeeWarning.update({
      where: { id },
      data: { ...dto, ...(dto.occurredAt ? { occurredAt: parseDateOnly(dto.occurredAt) } : {}) },
    });
  }
}
