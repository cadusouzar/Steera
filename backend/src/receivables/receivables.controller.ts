import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { QueryReceivablesDto } from './dto/query-receivables.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { ReceivablesService } from './receivables.service';

@UseGuards(ModulesGuard)
@RequireModule('CLIENTES')
@Controller()
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Post('clients/:clientId/receivables')
  create(@Param('clientId') clientId: string, @Body() dto: CreateReceivableDto) {
    return this.receivablesService.create(clientId, dto);
  }

  @Get('clients/:clientId/receivables')
  findAllForClient(@Param('clientId') clientId: string, @Query() query: QueryReceivablesDto) {
    return this.receivablesService.findAllForClient(clientId, query);
  }

  @Get('receivables/:id')
  findOne(@Param('id') id: string) {
    return this.receivablesService.findOne(id);
  }

  @Patch('receivables/:id')
  update(@Param('id') id: string, @Body() dto: UpdateReceivableDto) {
    return this.receivablesService.update(id, dto);
  }

  @Patch('receivables/:id/pay')
  pay(@Param('id') id: string) {
    return this.receivablesService.pay(id);
  }

  @Patch('receivables/:id/unpay')
  unpay(@Param('id') id: string) {
    return this.receivablesService.unpay(id);
  }

  @Delete('receivables/:id')
  remove(@Param('id') id: string) {
    return this.receivablesService.remove(id);
  }
}
