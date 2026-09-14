import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkSchedule } from '@prisma/client';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { QueryWorkSchedulesDto } from './dto/query-work-schedules.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';

@Injectable()
export class WorkSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // Mesmo padrão de EmployeesService.assertRoleUsable: WorkSchedule.employeeId
  // não é "meu próprio recurso" (é o admin configurando a jornada de outro
  // funcionário), então precisa confirmar que o Employee referenciado existe
  // NESTA empresa antes de gravar — sem isso um admin poderia (por engano ou
  // não) criar uma jornada apontando pro id de um funcionário de outra
  // empresa.
  private async assertEmployeeExists(employeeId: string, companyId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException(`Funcionário ${employeeId} não encontrado`);
  }

  private async assertExists(id: string): Promise<WorkSchedule> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const schedule = await this.prisma.workSchedule.findFirst({ where: { id, companyId } });
    if (!schedule) throw new NotFoundException(`Jornada ${id} não encontrada`);
    return schedule;
  }

  async create(dto: CreateWorkScheduleDto): Promise<WorkSchedule> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    await this.assertEmployeeExists(dto.employeeId, companyId);
    return this.prisma.workSchedule.create({
      data: {
        companyId,
        employeeId: dto.employeeId,
        name: dto.name,
        weekDays: dto.weekDays,
        expectedStartTime: dto.expectedStartTime,
        expectedEndTime: dto.expectedEndTime,
        breakMinutes: dto.breakMinutes,
        dailyMinutes: dto.dailyMinutes,
        weeklyMinutes: dto.weeklyMinutes,
        toleranceMinutes: dto.toleranceMinutes,
        allowOvertime: dto.allowOvertime,
        maxOvertimeMinutesPerDay: dto.maxOvertimeMinutesPerDay,
        nightShift: dto.nightShift,
        validFrom: parseDateOnly(dto.validFrom),
        validTo: dto.validTo ? parseDateOnly(dto.validTo) : undefined,
      },
    });
  }

  async findAll(query: QueryWorkSchedulesDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.workSchedule.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { validFrom: 'desc' },
      }),
      this.prisma.workSchedule.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateWorkScheduleDto): Promise<WorkSchedule> {
    const schedule = await this.assertExists(id);
    if (dto.employeeId && dto.employeeId !== schedule.employeeId) {
      await this.assertEmployeeExists(dto.employeeId, schedule.companyId);
    }
    return this.prisma.workSchedule.update({
      where: { id },
      data: {
        ...dto,
        validFrom: dto.validFrom ? parseDateOnly(dto.validFrom) : undefined,
        validTo: dto.validTo ? parseDateOnly(dto.validTo) : undefined,
      },
    });
  }

  // Hard delete de propósito (diferente de Role/Employee): WorkSchedule não
  // tem campo `active`/inativação lógica no schema (só `validFrom`/`validTo`
  // pra vigência) e nada referencia WorkSchedule por FK — é puramente
  // configuração de admin, sem histórico financeiro/trabalhista atrelado.
  async remove(id: string): Promise<void> {
    await this.assertExists(id);
    await this.prisma.workSchedule.delete({ where: { id } });
  }
}
