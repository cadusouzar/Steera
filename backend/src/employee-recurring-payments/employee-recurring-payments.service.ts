import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmployeeRecurringPayment, Prisma } from '@prisma/client';
import { startOfToday } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeRecurringPaymentDto } from './dto/create-employee-recurring-payment.dto';
import { UpdateEmployeeRecurringPaymentDto } from './dto/update-employee-recurring-payment.dto';

@Injectable()
export class EmployeeRecurringPaymentsService {
  private readonly logger = new Logger(EmployeeRecurringPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async create(employeeId: string, dto: CreateEmployeeRecurringPaymentDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    // Mesma razão do bloqueio em generateCharge: não faz sentido criar uma nova
    // obrigação recorrente para quem já foi desligado.
    if (employee.status === 'INACTIVE') {
      throw new BadRequestException(`Não é possível criar recorrência: funcionário ${employeeId} está inativo`);
    }
    return this.prisma.employeeRecurringPayment.create({
      data: { ...dto, companyId: employee.companyId, employeeId },
    });
  }

  async findAllForEmployee(employeeId: string) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.prisma.employeeRecurringPayment.findMany({
      where: { employeeId, companyId: employee.companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Rota top-level (employee-recurring-payments/:id, sem employeeId na URL) —
  // o único jeito de barrar acesso entre empresas aqui é filtrar por
  // companyId diretamente nesta query (não dá pra confiar em nenhuma checagem
  // downstream: findOne/update/remove nunca chegam a olhar o employeeId).
  async assertExists(id: string): Promise<EmployeeRecurringPayment> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const found = await this.prisma.employeeRecurringPayment.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException(`Recorrência ${id} não encontrada`);
    return found;
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateEmployeeRecurringPaymentDto) {
    await this.assertExists(id);
    return this.prisma.employeeRecurringPayment.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.employeeRecurringPayment.delete({ where: { id } });
    return { id };
  }

  async generateCharge(id: string) {
    const recurring = await this.assertExists(id);
    const employee = await this.employeesService.assertExists(recurring.employeeId);
    if (employee.status === 'INACTIVE') {
      throw new BadRequestException(`Não é possível gerar pagamento: funcionário ${recurring.employeeId} está inativo`);
    }

    const now = new Date();
    const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), recurring.dueDay));
    const monthLabel = now.toLocaleString('pt-BR', { month: 'long' });
    const referenceYear = now.getFullYear();
    const referenceMonth = now.getMonth() + 1;

    try {
      return await this.prisma.employeePayment.create({
        data: {
          companyId: recurring.companyId,
          employeeId: recurring.employeeId,
          recurringPaymentId: recurring.id,
          referenceYear,
          referenceMonth,
          description: `${recurring.description} (${monthLabel})`,
          amount: recurring.amount,
          dueDate,
          status: 'PENDING',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe um pagamento gerado para esta recorrência neste mês.');
      }
      throw err;
    }
  }

  async generateDueCharges(): Promise<{ checked: number; generated: number }> {
    const today = startOfToday();
    const currentDay = today.getUTCDate();
    const referenceYear = today.getUTCFullYear();
    const referenceMonth = today.getUTCMonth() + 1;

    const dueRecurringPayments = await this.prisma.employeeRecurringPayment.findMany({
      where: {
        status: 'ACTIVE',
        dueDay: { lte: currentDay },
        employee: { status: { not: 'INACTIVE' } },
        payments: { none: { referenceYear, referenceMonth } },
      },
    });

    let generated = 0;
    for (const recurring of dueRecurringPayments) {
      try {
        await this.generateCharge(recurring.id);
        generated++;
      } catch (err) {
        if (!(err instanceof ConflictException)) {
          this.logger.error(
            `Falha ao gerar pagamento da recorrência ${recurring.id}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
    return { checked: dueRecurringPayments.length, generated };
  }
}
