import { Injectable } from '@nestjs/common';
import { TimeTrackingSettings } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTimeTrackingSettingsDto } from './dto/update-time-tracking-settings.dto';

@Injectable()
export class TimeTrackingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // Upsert de linha única por empresa (companyId é @unique no schema).
  // Assinatura fixa — consumida pela Task 6 (TimeClockService) com o
  // `companyId` já resolvido dali, então este método não lê o contexto de
  // requisição sozinho (ao contrário de getCurrent()).
  async getOrCreateDefault(companyId: string): Promise<TimeTrackingSettings> {
    const existing = await this.prisma.timeTrackingSettings.findUnique({ where: { companyId } });
    if (existing) return existing;
    // Nenhum campo além de companyId — todos os outros nascem do default do
    // schema (requirePhoto/requireLocation true, etc.).
    return this.prisma.timeTrackingSettings.create({ data: { companyId } });
  }

  async getCurrent(): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.getOrCreateDefault(companyId);
  }

  async update(dto: UpdateTimeTrackingSettingsDto): Promise<TimeTrackingSettings> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    // Garante que a linha exista antes do update (empresa que nunca configurou
    // nada ainda não tem `TimeTrackingSettings` — sem isso, `update` falharia
    // com "record not found" no primeiro PATCH de uma empresa nova).
    await this.getOrCreateDefault(companyId);
    return this.prisma.timeTrackingSettings.update({ where: { companyId }, data: dto });
  }
}
