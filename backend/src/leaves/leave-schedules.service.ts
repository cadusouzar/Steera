import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveScheduleStatus } from '@prisma/client';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleLeaveDto } from './dto/schedule-leave.dto';

@Injectable()
export class LeaveSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private validateRange(startDate: string, endDate: string, daysCount: number) {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    // `end === start` é válido: representa afastamento de 1 dia (daysCount: 1).
    if (end < start) throw new BadRequestException('endDate não pode ser anterior a startDate');
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (rangeDays !== daysCount) {
      throw new BadRequestException(`daysCount (${daysCount}) não corresponde ao intervalo informado (${rangeDays} dias)`);
    }
    return { start, end };
  }

  // Diferença chave em relação a VacationSchedulesService.assertNoOverlap: um
  // funcionário não pode estar de férias e de afastamento ao mesmo tempo, então
  // a sobreposição é checada contra as duas tabelas (excluindo canceladas em cada uma).
  private async assertNoOverlap(employeeId: string, companyId: string, start: Date, end: Date) {
    const [existingLeaves, existingVacations] = await Promise.all([
      this.prisma.leaveSchedule.findMany({
        where: { employeeId, companyId, status: { not: 'CANCELLED' } },
      }),
      this.prisma.vacationSchedule.findMany({
        where: { employeeId, companyId, status: { not: 'CANCELLED' } },
      }),
    ]);
    const combined = [...existingLeaves, ...existingVacations];
    const overlaps = combined.some((row) => start <= row.endDate && end >= row.startDate);
    if (overlaps) {
      throw new BadRequestException('Já existe um período de férias ou afastamento agendado que se sobrepõe a este intervalo');
    }
  }

  async schedule(employeeId: string, dto: ScheduleLeaveDto) {
    const employee = await this.employeesService.assertExists(employeeId);
    if (employee.status === 'INACTIVE') {
      throw new BadRequestException(`Não é possível agendar afastamento: funcionário ${employeeId} está inativo`);
    }
    const { start, end } = this.validateRange(dto.startDate, dto.endDate, dto.daysCount);

    await this.assertNoOverlap(employeeId, employee.companyId, start, end);

    return this.prisma.leaveSchedule.create({
      data: {
        companyId: employee.companyId,
        employeeId,
        startDate: start,
        endDate: end,
        daysCount: dto.daysCount,
        reason: dto.reason,
        notes: dto.notes,
        status: 'SCHEDULED',
      },
    });
  }

  async findAllForEmployee(employeeId: string) {
    const employee = await this.employeesService.assertExists(employeeId);
    return this.prisma.leaveSchedule.findMany({
      where: { employeeId, companyId: employee.companyId },
      orderBy: { startDate: 'desc' },
    });
  }

  // Rota top-level (leave-schedules/:id/cancel, sem employeeId na URL) —
  // mesmo motivo do filtro por companyId em VacationSchedulesService.cancel.
  async cancel(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const schedule = await this.prisma.leaveSchedule.findFirst({ where: { id, companyId } });
    if (!schedule) throw new NotFoundException(`Agendamento de afastamento ${id} não encontrado`);

    if (schedule.status === LeaveScheduleStatus.CANCELLED) {
      throw new ConflictException(`Agendamento de afastamento ${id} já está cancelado`);
    }
    if (schedule.status !== LeaveScheduleStatus.SCHEDULED && schedule.status !== LeaveScheduleStatus.APPROVED) {
      throw new ConflictException(
        `Não é possível cancelar o agendamento de afastamento ${id}: período já está ${schedule.status} ` +
          '(só é possível cancelar períodos SCHEDULED ou APPROVED)',
      );
    }

    return this.prisma.leaveSchedule.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
