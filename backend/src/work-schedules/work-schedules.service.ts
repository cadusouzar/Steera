import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkSchedule } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly } from '../common/date.util';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { QueryWorkSchedulesDto } from './dto/query-work-schedules.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';

@Injectable()
export class WorkSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly timeManagementAuth: TimeManagementAuthService,
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

  // Ao menos um dos dois nunca preenchido ao mesmo tempo — as três combinações válidas: só
  // employeeId (individual), só managerId (padrão de time), nenhum dos dois (padrão da empresa).
  private async assertValidTierAndAuthorized(
    currentUser: AuthenticatedUser,
    companyId: string,
    employeeId: string | undefined,
    managerId: string | undefined,
  ) {
    if (employeeId && managerId) {
      throw new BadRequestException('Uma jornada não pode ter employeeId e managerId ao mesmo tempo');
    }
    if (!employeeId && !managerId) {
      // Padrão da empresa inteira.
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      return;
    }
    if (managerId) {
      const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
      if (currentUserRecord?.employeeId === managerId) return; // autoatendimento: configurando o próprio time
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      await this.assertEmployeeExists(managerId, companyId);
      return;
    }
    // employeeId (individual)
    await this.assertEmployeeExists(employeeId!, companyId);
    await this.timeManagementAuth.assertCanManage(currentUser, employeeId!);
  }

  async create(dto: CreateWorkScheduleDto, currentUser: AuthenticatedUser): Promise<WorkSchedule> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    await this.assertValidTierAndAuthorized(currentUser, companyId, dto.employeeId, dto.managerId);
    return this.prisma.workSchedule.create({
      data: {
        companyId,
        employeeId: dto.employeeId,
        managerId: dto.managerId,
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
      ...(query.managerId ? { managerId: query.managerId } : {}),
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

  async update(id: string, dto: UpdateWorkScheduleDto, currentUser: AuthenticatedUser): Promise<WorkSchedule> {
    const schedule = await this.assertExists(id);
    const nextEmployeeId = dto.employeeId !== undefined ? dto.employeeId : (schedule.employeeId ?? undefined);
    const nextManagerId = dto.managerId !== undefined ? dto.managerId : (schedule.managerId ?? undefined);
    await this.assertValidTierAndAuthorized(currentUser, schedule.companyId, nextEmployeeId, nextManagerId);
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
  async remove(id: string, currentUser: AuthenticatedUser): Promise<void> {
    const schedule = await this.assertExists(id);
    await this.assertValidTierAndAuthorized(currentUser, schedule.companyId, schedule.employeeId ?? undefined, schedule.managerId ?? undefined);
    await this.prisma.workSchedule.delete({ where: { id } });
  }
}
