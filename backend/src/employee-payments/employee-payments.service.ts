import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeePayment } from '@prisma/client';
import { parseDateOnly, startOfToday } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeePaymentDto } from './dto/create-employee-payment.dto';
import { QueryEmployeePaymentsDto } from './dto/query-employee-payments.dto';
import { UpdateEmployeePaymentDto } from './dto/update-employee-payment.dto';

type DerivedStatus = 'pending' | 'paid' | 'overdue';

function deriveStatus(payment: Pick<EmployeePayment, 'status' | 'dueDate'>): DerivedStatus {
  if (payment.status === 'PAID') return 'paid';
  return payment.dueDate < startOfToday() ? 'overdue' : 'pending';
}

function toResponse(payment: EmployeePayment) {
  return { ...payment, derivedStatus: deriveStatus(payment) };
}

@Injectable()
export class EmployeePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async create(employeeId: string, dto: CreateEmployeePaymentDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    const created = await this.prisma.employeePayment.create({
      data: { ...dto, dueDate: parseDateOnly(dto.dueDate), companyId: employee.companyId, employeeId },
    });
    return toResponse(created);
  }

  async findAllForEmployee(employeeId: string, query: QueryEmployeePaymentsDto) {
    await this.employeesService.assertExists(employeeId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const today = startOfToday();

    const statusWhere =
      query.status === 'paid'
        ? { status: 'PAID' as const }
        : query.status === 'pending'
          ? { status: 'PENDING' as const, dueDate: { gte: today } }
          : query.status === 'overdue'
            ? { status: 'PENDING' as const, dueDate: { lt: today } }
            : {};

    const where = { employeeId, ...statusWhere };

    const [rows, total] = await Promise.all([
      this.prisma.employeePayment.findMany({ where, orderBy: { dueDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.employeePayment.count({ where }),
    ]);

    return { items: rows.map(toResponse), total, page, pageSize };
  }

  // Rota top-level (employee-payments/:id, sem employeeId na URL) — igual
  // EmployeeRecurringPaymentsService.assertExists, o filtro por companyId
  // aqui é a única barreira contra acessar o pagamento de outra empresa.
  private async assertExists(id: string): Promise<EmployeePayment> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const found = await this.prisma.employeePayment.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException(`Pagamento ${id} não encontrado`);
    return found;
  }

  async findOne(id: string) {
    return toResponse(await this.assertExists(id));
  }

  async update(id: string, dto: UpdateEmployeePaymentDto) {
    await this.assertExists(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.dueDate) data.dueDate = parseDateOnly(dto.dueDate);
    const updated = await this.prisma.employeePayment.update({ where: { id }, data });
    return toResponse(updated);
  }

  async pay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.employeePayment.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
    return toResponse(updated);
  }

  async unpay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.employeePayment.update({ where: { id }, data: { status: 'PENDING', paidAt: null } });
    return toResponse(updated);
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.employeePayment.delete({ where: { id } });
    return { id };
  }
}
