import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { DeactivateClientDto } from './dto/deactivate-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('CLIENTES')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @RequirePermission('clientes.gerenciar')
  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @RequirePermission('clientes.ver')
  @Get()
  findAll(@Query() query: QueryClientsDto) {
    return this.clientsService.findAll(query);
  }

  @RequirePermission('clientes.ver')
  @Get('trash')
  findTrash() {
    return this.clientsService.findTrash();
  }

  @RequirePermission('clientes.ver')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @RequirePermission('clientes.gerenciar')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @RequirePermission('clientes.gerenciar')
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @Body() dto: DeactivateClientDto) {
    return this.clientsService.deactivate(id, dto);
  }

  @RequirePermission('clientes.gerenciar')
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.clientsService.restore(id);
  }
}
