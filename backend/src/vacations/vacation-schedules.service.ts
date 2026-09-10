import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleVacationDto } from './dto/schedule-vacation.dto';
import { VacationCalculationService } from './vacation-calculation.service';

@Injectable()
export class VacationSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly calculation: VacationCalculationService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private daysAlreadyTaken(employeeId: string) {
    return this.prisma.vacationSchedule
      .findMany({ where: { employeeId, status: { in: ['COMPLETED', 'IN_PROGRESS'] } } })
      .then((rows) => rows.reduce((sum, row) => sum + row.daysCount, 0));
  }

  async status(employeeId: string) {
    const employee = await this.employeesService.assertExists(employeeId);
    const daysAlreadyTaken = await this.daysAlreadyTaken(employeeId);
    return this.calculation.calculate({
      contractType: employee.contractType,
      admissionDate: employee.admissionDate,
      baseValue: Number(employee.baseValue),
      daysAlreadyTaken,
    });
  }

  // Simulação: roda o mesmo cálculo, nunca escreve no banco.
  async simulate(employeeId: string, dto: ScheduleVacationDto) {
    const vacationStatus = await this.status(employeeId);
    return {
      ...vacationStatus,
      requestedRange: { startDate: dto.startDate, endDate: dto.endDate, daysCount: dto.daysCount },
      sufficientBalance: dto.daysCount <= vacationStatus.balanceDays,
    };
  }

  private validateRange(startDate: string, endDate: string, daysCount: number) {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (end <= start) throw new BadRequestException('endDate deve ser posterior a startDate');
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (rangeDays !== daysCount) {
      throw new BadRequestException(`daysCount (${daysCount}) não corresponde ao intervalo informado (${rangeDays} dias)`);
    }
    return { start, end };
  }

  private async assertNoOverlap(employeeId: string, start: Date, end: Date) {
    const existing = await this.prisma.vacationSchedule.findMany({
      where: { employeeId, status: { not: 'CANCELLED' } },
    });
    const overlaps = existing.some((row) => start <= row.endDate && end >= row.startDate);
    if (overlaps) {
      throw new BadRequestException('Já existe um período de férias agendado que se sobrepõe a este intervalo');
    }
  }

  async schedule(employeeId: string, dto: ScheduleVacationDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    const vacationStatus = await this.status(employeeId);
    const { start, end } = this.validateRange(dto.startDate, dto.endDate, dto.daysCount);

    if (dto.daysCount > vacationStatus.balanceDays) {
      throw new BadRequestException(
        `Saldo insuficiente: disponível ${vacationStatus.balanceDays} dias, solicitado ${dto.daysCount}`,
      );
    }
    await this.assertNoOverlap(employeeId, start, end);

    return this.prisma.vacationSchedule.create({
      data: {
        companyId: employee.companyId,
        employeeId,
        acquisitivePeriodStart: vacationStatus.acquisitivePeriodStart,
        acquisitivePeriodEnd: vacationStatus.acquisitivePeriodEnd,
        startDate: start,
        endDate: end,
        daysCount: dto.daysCount,
        notes: dto.notes,
        status: 'SCHEDULED',
      },
    });
  }

  async findAllForEmployee(employeeId: string) {
    await this.employeesService.assertExists(employeeId);
    return this.prisma.vacationSchedule.findMany({ where: { employeeId }, orderBy: { startDate: 'desc' } });
  }

  // Rota top-level (vacation-schedules/:id/cancel, sem employeeId na URL) —
  // mesmo motivo do filtro por companyId em EmployeePaymentsService.assertExists.
  async cancel(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const schedule = await this.prisma.vacationSchedule.findFirst({ where: { id, companyId } });
    if (!schedule) throw new NotFoundException(`Agendamento de férias ${id} não encontrado`);
    return this.prisma.vacationSchedule.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
