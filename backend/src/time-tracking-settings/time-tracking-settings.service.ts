import { Injectable } from '@nestjs/common';
import { TimeTrackingSettings } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { UpdateTimeTrackingSettingsDto } from './dto/update-time-tracking-settings.dto';

@Injectable()
export class TimeTrackingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  // findFirst, não findUnique: companyId sozinho deixou de ser @unique no schema (agora é um
  // índice único PARCIAL via SQL bruto na migration — companyId+managerId:NULL — que o Prisma não
  // reconhece como alvo válido de findUnique). Ver a spec, seção "TimeTrackingSettings".
  async getOrCreateDefault(companyId: string): Promise<TimeTrackingSettings> {
    const existing = await this.prisma.timeTrackingSettings.findFirst({ where: { companyId, managerId: null } });
    if (existing) return existing;
    return this.prisma.timeTrackingSettings.create({ data: { companyId, managerId: undefined } });
  }

  async getCurrent(): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.getOrCreateDefault(companyId);
  }

  // Achado + implementado na revisão de escopo de 15/09/2026: antes deste método, todo
  // funcionário de uma empresa compartilhava literalmente a mesma configuração — agora resolve a
  // sobrescrita do superior DIRETO (nunca propagação em cadeia) antes de cair no padrão da
  // empresa. Usado por TimeClockService.getStatus()/createPunch() no lugar de getOrCreateDefault.
  async getEffectiveSettingsForEmployee(employeeId: string, companyId: string): Promise<TimeTrackingSettings> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
    if (employee?.managerId) {
      const managerOverride = await this.prisma.timeTrackingSettings.findFirst({
        where: { companyId, managerId: employee.managerId },
      });
      if (managerOverride) return managerOverride;
    }
    return this.getOrCreateDefault(companyId);
  }

  private async getOrCreateForManager(companyId: string, managerId: string): Promise<TimeTrackingSettings> {
    const existing = await this.prisma.timeTrackingSettings.findFirst({ where: { companyId, managerId } });
    if (existing) return existing;
    return this.prisma.timeTrackingSettings.create({ data: { companyId, managerId } });
  }

  // Sem managerId no dto: edita o padrão da empresa (exige hasFullPontoAccess). Com managerId:
  // edita a sobrescrita daquele superior (autoatendimento se for o próprio; senão exige
  // hasFullPontoAccess) — mesma regra de WorkSchedulesService.assertValidTierAndAuthorized.
  async update(dto: UpdateTimeTrackingSettingsDto, currentUser: AuthenticatedUser): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    let row: TimeTrackingSettings;
    if (!dto.managerId) {
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      row = await this.getOrCreateDefault(companyId);
    } else {
      const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
      if (currentUserRecord?.employeeId !== dto.managerId) {
        this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
      }
      row = await this.getOrCreateForManager(companyId, dto.managerId);
    }
    // row.id já identifica a linha certa (padrão da empresa ou a sobrescrita do superior) — não há
    // por que regravar managerId, ele não muda depois de resolvido.
    const patch = { ...dto };
    delete patch.managerId;
    return this.prisma.timeTrackingSettings.update({ where: { id: row.id }, data: patch });
  }

  // Leitura escopada: sem managerId, devolve o padrão da empresa; com managerId, devolve (criando
  // se preciso) a sobrescrita daquele superior — autoatendimento se for o próprio, senão exige
  // hasFullPontoAccess (mesma regra de update, nunca mais permissivo pra leitura que pra escrita).
  async getScoped(managerId: string | undefined, currentUser: AuthenticatedUser): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    if (!managerId) return this.getOrCreateDefault(companyId);
    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (currentUserRecord?.employeeId !== managerId) {
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
    }
    return this.getOrCreateForManager(companyId, managerId);
  }
}
