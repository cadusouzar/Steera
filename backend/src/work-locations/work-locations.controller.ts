import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateWorkLocationDto } from './dto/create-work-location.dto';
import { QueryWorkLocationsDto } from './dto/query-work-locations.dto';
import { UpdateWorkLocationDto } from './dto/update-work-location.dto';
import { WorkLocationsService } from './work-locations.service';

// Local de trabalho é configuração da empresa toda (sem vínculo a
// funcionário) — leitura liberada pra qualquer login com módulo RH, mutação
// restrita a ADMIN.
@UseGuards(ModulesGuard, RolesGuard)
@RequireModule('RH')
@Controller('work-locations')
export class WorkLocationsController {
  constructor(private readonly workLocations: WorkLocationsService) {}

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateWorkLocationDto) {
    return this.workLocations.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryWorkLocationsDto) {
    return this.workLocations.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workLocations.findOne(id);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkLocationDto) {
    return this.workLocations.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.workLocations.remove(id);
  }
}
