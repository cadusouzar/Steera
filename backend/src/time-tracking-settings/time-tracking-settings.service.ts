import { Injectable } from '@nestjs/common';
import { Prisma, TimeTrackingSettings } from '@prisma/client';
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

  // Os dois índices únicos desta tabela são PARCIAIS (criados por SQL bruto na migration:
  // companyId WHERE managerId IS NULL, e companyId+managerId WHERE managerId IS NOT NULL) — o
  // Prisma não os conhece declarativamente, então não existe alvo válido nem pra `findUnique` nem
  // pra `upsert`. Daí o padrão find-then-create aqui; a corrida de duas primeiras escritas
  // simultâneas na MESMA chave é resolvida capturando o P2002 do índice parcial e relendo a linha
  // que a outra requisição acabou de criar (achado na revisão final de 15/09/2026: antes disso a
  // perdedora da corrida vazava um 500 cru).
  private async findOrCreate(
    where: { companyId: string; managerId: string | null },
    data: Prisma.TimeTrackingSettingsUncheckedCreateInput,
  ): Promise<TimeTrackingSettings> {
    const existing = await this.prisma.timeTrackingSettings.findFirst({ where });
    if (existing) return existing;
    try {
      return await this.prisma.timeTrackingSettings.create({ data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.timeTrackingSettings.findFirst({ where });
        if (raced) return raced;
      }
      throw err;
    }
  }

  // findFirst, não findUnique: companyId sozinho deixou de ser @unique no schema (agora é um
  // índice único PARCIAL via SQL bruto na migration — companyId+managerId:NULL — que o Prisma não
  // reconhece como alvo válido de findUnique). Ver a spec, seção "TimeTrackingSettings".
  async getOrCreateDefault(companyId: string): Promise<TimeTrackingSettings> {
    return this.findOrCreate({ companyId, managerId: null }, { companyId, managerId: undefined });
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

  // Só chamado no caminho de ESCRITA (update) — nunca numa leitura (ver getScoped). Quando o
  // superior ainda não tem sobrescrita, a linha nova nasce como uma CÓPIA do padrão atual da
  // empresa, nunca dos defaults do schema: sem isso (achado na revisão final de 15/09/2026),
  // mexer num único toggle de time silenciosamente ressetava os outros quatro campos pro default
  // do Prisma, divergindo do que a empresa de fato configurou.
  private async createManagerOverrideFromCompanyDefault(
    companyId: string,
    managerId: string,
  ): Promise<TimeTrackingSettings> {
    const companyDefault = await this.getOrCreateDefault(companyId);
    return this.findOrCreate(
      { companyId, managerId },
      {
        companyId,
        managerId,
        requirePhoto: companyDefault.requirePhoto,
        requireLocation: companyDefault.requireLocation,
        allowLocationException: companyDefault.allowLocationException,
        allowExtraPeriods: companyDefault.allowExtraPeriods,
        maxAttachmentSizeBytes: companyDefault.maxAttachmentSizeBytes,
      },
    );
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
      row = await this.createManagerOverrideFromCompanyDefault(companyId, dto.managerId);
    }
    // row.id já identifica a linha certa (padrão da empresa ou a sobrescrita do superior) — não há
    // por que regravar managerId, ele não muda depois de resolvido.
    const patch = { ...dto };
    delete patch.managerId;
    return this.prisma.timeTrackingSettings.update({ where: { id: row.id }, data: patch });
  }

  // Leitura escopada: sem managerId, devolve o padrão da empresa; com managerId, devolve a
  // sobrescrita daquele superior SE ela existir — autoatendimento se for o próprio, senão exige
  // hasFullPontoAccess (mesma regra de update, nunca mais permissivo pra leitura que pra escrita).
  //
  // Leitura NUNCA cria a sobrescrita do superior (achado na revisão final de 15/09/2026): a versão
  // anterior chamava getOrCreateForManager aqui, e como o frontend chama este GET só por ABRIR a
  // aba de Configuração, o simples ato de olhar fixava o time inteiro daquele superior nos
  // defaults do schema, divergindo do padrão da empresa sem nenhuma intenção do usuário. O
  // fallback pro padrão da empresa é exatamente o mesmo que getEffectiveSettingsForEmployee já faz
  // na hora de bater ponto — leitura e apuração passam a concordar. `inherited: true` diz ao
  // frontend que os valores mostrados vêm do padrão da empresa, não de uma linha própria do time.
  async getScoped(
    managerId: string | undefined,
    currentUser: AuthenticatedUser,
  ): Promise<TimeTrackingSettings & { inherited: boolean }> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    if (!managerId) return { ...(await this.getOrCreateDefault(companyId)), inherited: false };
    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (currentUserRecord?.employeeId !== managerId) {
      this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
    }
    const override = await this.prisma.timeTrackingSettings.findFirst({ where: { companyId, managerId } });
    if (override) return { ...override, inherited: false };
    return { ...(await this.getOrCreateDefault(companyId)), inherited: true };
  }
}
