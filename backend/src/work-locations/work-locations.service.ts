import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkLocation } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkLocationDto } from './dto/create-work-location.dto';
import { QueryWorkLocationsDto } from './dto/query-work-locations.dto';
import { UpdateWorkLocationDto } from './dto/update-work-location.dto';

@Injectable()
export class WorkLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  private async assertExists(id: string): Promise<WorkLocation> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const location = await this.prisma.workLocation.findFirst({ where: { id, companyId } });
    if (!location) throw new NotFoundException(`Local de trabalho ${id} não encontrado`);
    return location;
  }

  async create(dto: CreateWorkLocationDto): Promise<WorkLocation> {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.workLocation.create({
      data: {
        companyId,
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters,
        active: dto.active ?? true,
      },
    });
  }

  async findAll(query: QueryWorkLocationsDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.workLocation.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { name: 'asc' } }),
      this.prisma.workLocation.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  findOne(id: string) {
    return this.assertExists(id);
  }

  async update(id: string, dto: UpdateWorkLocationDto): Promise<WorkLocation> {
    await this.assertExists(id);
    return this.prisma.workLocation.update({ where: { id }, data: dto });
  }

  // Hard delete de propósito, mesmo raciocínio de WorkSchedulesService.remove:
  // sem histórico atrelado por FK (TimeEvent.workLocationId é
  // onDelete: SetNull — apagar um local usado em batidas antigas só limpa a
  // referência, nunca perde a batida em si). Pra só desativar sem apagar, use
  // PATCH com { active: false }.
  async remove(id: string): Promise<void> {
    await this.assertExists(id);
    await this.prisma.workLocation.delete({ where: { id } });
  }

  // Consumido pela Task 6 (TimeClockService, batida) — assinatura e retorno
  // não podem mudar sem coordenar com aquela task. Companhia sempre a do
  // contexto atual: nunca vaza locais de outra empresa.
  findAllActive(): Promise<WorkLocation[]> {
    return this.companyContext
      .getCurrentCompanyId()
      .then((companyId) => this.prisma.workLocation.findMany({ where: { companyId, active: true } }));
  }
}
