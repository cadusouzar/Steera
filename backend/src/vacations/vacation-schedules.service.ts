import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { VacationScheduleStatus } from '@prisma/client';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResumeVacationDto } from './dto/resume-vacation.dto';
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

  // Busca única, reaproveitada tanto pela checagem de sobreposição quanto pelo
  // teto de 30 dias abaixo — evita duas idas ao banco pelo mesmo conjunto de linhas.
  // Só férias — o teto de 30 dias é especificamente um teto de dias de férias,
  // dias de afastamento não entram nessa soma (ver assertWithinCap).
  private async getActiveSchedules(employeeId: string, companyId: string) {
    return this.prisma.vacationSchedule.findMany({
      where: { employeeId, companyId, status: { not: 'CANCELLED' } },
    });
  }

  private async getActiveLeaveSchedules(employeeId: string, companyId: string) {
    return this.prisma.leaveSchedule.findMany({
      where: { employeeId, companyId, status: { not: 'CANCELLED' } },
    });
  }

  // Simétrico a LeaveSchedulesService.assertNoOverlap: um funcionário não pode
  // estar de férias e de afastamento ao mesmo tempo, então a sobreposição é
  // checada contra as duas tabelas (excluindo canceladas em cada uma) — mesmo
  // que o teto de 30 dias acima considere só VacationSchedule.
  private assertNoOverlap(existing: { startDate: Date; endDate: Date }[], start: Date, end: Date) {
    const overlaps = existing.some((row) => start <= row.endDate && end >= row.startDate);
    if (overlaps) {
      throw new BadRequestException('Já existe um período de férias ou afastamento agendado que se sobrepõe a este intervalo');
    }
  }

  // Teto fixo de 30 dias somados (existentes + novo pedido), não uma proporção
  // acumulada — a antiga calculadora de saldo/bônus foi removida de propósito.
  // `exceptionAuthorized: true` no DTO ignora esse teto por completo.
  private assertWithinCap(existing: { daysCount: number }[], newDaysCount: number, exceptionAuthorized?: boolean) {
    if (exceptionAuthorized === true) return;
    const CAP = 30;
    const existingSum = existing.reduce((sum, row) => sum + row.daysCount, 0);
    const total = existingSum + newDaysCount;
    if (total > CAP) {
      throw new BadRequestException(
        `Limite de 30 dias de férias excedido: já agendados ${existingSum} dias, mais ${newDaysCount} solicitados = ${total} dias. Marque a exceção para agendar mesmo assim.`,
      );
    }
  }

  // Compartilhado por schedule() e resume(): mesma checagem de sobreposição
  // (férias + afastamento) e mesmo teto de 30 dias (só férias), parametrizado
  // pelas datas/dias já resolvidos — quem chama decide se vêm de um DTO com
  // strings (parseDateOnly) ou de uma linha já existente no banco (Date).
  private async assertScheduleIsValid(
    employeeId: string,
    companyId: string,
    start: Date,
    end: Date,
    daysCount: number,
    exceptionAuthorized?: boolean,
  ) {
    const [existingVacations, existingLeaves] = await Promise.all([
      this.getActiveSchedules(employeeId, companyId),
      this.getActiveLeaveSchedules(employeeId, companyId),
    ]);
    this.assertNoOverlap([...existingVacations, ...existingLeaves], start, end);
    // Só férias entram na soma do teto — afastamento não conta (ver getActiveSchedules acima).
    this.assertWithinCap(existingVacations, daysCount, exceptionAuthorized);
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

    await this.assertScheduleIsValid(employeeId, employee.companyId, start, end, dto.daysCount, dto.exceptionAuthorized);

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

  // Rota top-level (vacation-schedules/:id/resume), mesmo padrão de escopo por
  // companyId de cancel() acima. Reagenda um período CANCELLED re-rodando as
  // MESMAS checagens de schedule() (sobreposição + teto de 30 dias) contra as
  // datas/dias já gravados na linha — como o próprio registro está CANCELLED,
  // ele já fica naturalmente fora das duas buscas de "ativos" (que filtram
  // status !== CANCELLED), então não precisa de exclusão especial por id.
  async resume(id: string, dto: ResumeVacationDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const schedule = await this.prisma.vacationSchedule.findFirst({ where: { id, companyId } });
    if (!schedule) throw new NotFoundException(`Agendamento de férias ${id} não encontrado`);

    if (schedule.status !== VacationScheduleStatus.CANCELLED) {
      throw new ConflictException(`Agendamento de férias ${id} não está cancelado`);
    }

    const employee = await this.employeesService.assertExists(schedule.employeeId);
    if (employee.status === 'INACTIVE') {
      throw new BadRequestException(`Não é possível agendar férias: funcionário ${schedule.employeeId} está inativo`);
    }

    await this.assertScheduleIsValid(
      schedule.employeeId,
      employee.companyId,
      schedule.startDate,
      schedule.endDate,
      schedule.daysCount,
      dto.exceptionAuthorized,
    );

    return this.prisma.vacationSchedule.update({ where: { id }, data: { status: 'SCHEDULED' } });
  }
}
