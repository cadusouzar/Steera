import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateWorkLocationDto } from './dto/create-work-location.dto';
import { QueryWorkLocationsDto } from './dto/query-work-locations.dto';
import { UpdateWorkLocationDto } from './dto/update-work-location.dto';
import { WorkLocationsService } from './work-locations.service';

// Local de trabalho é infraestrutura física da empresa toda — mutação exige hasFullPontoAccess
// (nunca "meu time", ver a spec de 15/09/2026). RolesGuard/@Roles('ADMIN') removidos desta classe.
@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller('work-locations')
export class WorkLocationsController {
  constructor(
    private readonly workLocations: WorkLocationsService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkLocationDto) {
    this.timeManagementAuth.assertHasFullPontoAccess(user);
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

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateWorkLocationDto) {
    this.timeManagementAuth.assertHasFullPontoAccess(user);
    return this.workLocations.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.timeManagementAuth.assertHasFullPontoAccess(user);
    return this.workLocations.remove(id);
  }
}
