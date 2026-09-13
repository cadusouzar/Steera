import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { ScheduleLeaveDto } from './dto/schedule-leave.dto';
import { LeaveSchedulesService } from './leave-schedules.service';

@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller()
export class LeaveSchedulesController {
  constructor(private readonly service: LeaveSchedulesService) {}

  @Post('employees/:employeeId/leave/schedule')
  schedule(@Param('employeeId') employeeId: string, @Body() dto: ScheduleLeaveDto) {
    return this.service.schedule(employeeId, dto);
  }

  @Get('employees/:employeeId/leave/schedules')
  findAllForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findAllForEmployee(employeeId);
  }

  @Patch('leave-schedules/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Patch('leave-schedules/:id/resume')
  resume(@Param('id') id: string) {
    return this.service.resume(id);
  }
}
