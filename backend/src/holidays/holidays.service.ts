import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyContextService } from '../company/company-context.service';
import { parseDateOnly } from '../common/date.util';
import { CreateHolidayDto } from './dto/create-holiday.dto';

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  // Consumido pela apuração (Task 7): um dia é feriado se bater com o nacional, com o estadual da
  // UF configurada na empresa (Company.state), ou com um customizado da própria empresa.
  async isHoliday(date: Date): Promise<boolean> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const found = await this.prisma.holiday.findFirst({
      where: {
        date,
        OR: [
          { scope: 'NATIONAL' },
          ...(company.state ? [{ scope: 'STATE' as const, state: company.state }] : []),
          { scope: 'COMPANY', companyId },
        ],
      },
    });
    return !!found;
  }

  async createCustom(dto: CreateHolidayDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.holiday.create({
      data: { scope: 'COMPANY', companyId, date: parseDateOnly(dto.date), name: dto.name },
    });
  }

  async listForCompany() {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return this.prisma.holiday.findMany({
      where: {
        OR: [
          { scope: 'NATIONAL' },
          ...(company.state ? [{ scope: 'STATE' as const, state: company.state }] : []),
          { scope: 'COMPANY', companyId },
        ],
      },
      orderBy: { date: 'asc' },
    });
  }

  async removeCustom(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const holiday = await this.prisma.holiday.findFirst({ where: { id, scope: 'COMPANY', companyId } });
    if (!holiday) throw new NotFoundException(`Feriado ${id} não encontrado`);
    await this.prisma.holiday.delete({ where: { id } });
  }
}
