import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { VacationScheduleStatus } from '@prisma/client';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleVacationDto } from './dto/schedule-vacation.dto';

@Injectable()
export class VacationSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private validateRange(startDate: string, endDate: string, daysCount: number) {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    // `end === start` é válido: representa férias de 1 dia (daysCount: 1).
    if (end < start) throw new BadRequestException('endDate não pode ser anterior a startDate');
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (rangeDays !== daysCount) {
      throw new BadRequestException(`daysCount (${daysCount}) não corresponde ao intervalo informado (${rangeDays} dias)`);
    }
    return { start, end };
  }

  private async assertNoOverlap(employeeId: string, companyId: string, start: Date, end: Date) {
    const existing = await this.prisma.vacationSchedule.findMany({
      where: { employeeId, companyId, status: { not: 'CANCELLED' } },
    });
    const overlaps = existing.some((row) => start <= row.endDate && end >= row.startDate);
    if (overlaps) {
      throw new BadRequestException('Já existe um período de férias agendado que se sobrepõe a este intervalo');
    }
  }

  async schedule(employeeId: string, dto: ScheduleVacationDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    if (employee.status === 'INACTIVE') {
      throw new BadRequestException(`Não é possível agendar férias: funcionário ${employeeId} está inativo`);
    }
    if (employee.contractType !== 'CLT') {
      throw new UnprocessableEntityException(
        `Férias CLT não se aplica ao vínculo ${employee.contractType}.`,
      );
    }
    const { start, end } = this.validateRange(dto.startDate, dto.endDate, dto.daysCount);

    await this.assertNoOverlap(employeeId, employee.companyId, start, end);

    return this.prisma.vacationSchedule.create({
      data: {
        companyId: employee.companyId,
        employeeId,
        startDate: start,
        endDate: end,
        daysCount: dto.daysCount,
        notes: dto.notes,
        status: 'SCHEDULED',
      },
    });
  }

  async findAllForEmployee(employeeId: string) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.prisma.vacationSchedule.findMany({
      where: { employeeId, companyId: employee.companyId },
      orderBy: { startDate: 'desc' },
    });
  }

  // Rota top-level (vacation-schedules/:id/cancel, sem employeeId na URL) —
  // mesmo motivo do filtro por companyId em EmployeePaymentsService.assertExists.
  async cancel(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const schedule = await this.prisma.vacationSchedule.findFirst({ where: { id, companyId } });
    if (!schedule) throw new NotFoundException(`Agendamento de férias ${id} não encontrado`);

    if (schedule.status === VacationScheduleStatus.CANCELLED) {
      throw new ConflictException(`Agendamento de férias ${id} já está cancelado`);
    }
    if (schedule.status !== VacationScheduleStatus.SCHEDULED && schedule.status !== VacationScheduleStatus.APPROVED) {
      throw new ConflictException(
        `Não é possível cancelar o agendamento de férias ${id}: período já está ${schedule.status} ` +
          '(só é possível cancelar períodos SCHEDULED ou APPROVED)',
      );
    }

    return this.prisma.vacationSchedule.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
