import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { HolidaysService } from './holidays.service';

@UseGuards(ModulesGuard, RolesGuard, PermissionsGuard)
@RequireModule('PONTO_ADMINISTRACAO')
@Roles('ADMIN')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @RequirePermission('ponto.feriados.gerenciar')
  @Post()
  create(@Body() dto: CreateHolidayDto) {
    return this.holidaysService.createCustom(dto);
  }

  @Get()
  findAll() {
    return this.holidaysService.listForCompany();
  }

  @RequirePermission('ponto.feriados.gerenciar')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.holidaysService.removeCustom(id);
  }
}
