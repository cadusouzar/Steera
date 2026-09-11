import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ResumeVacationDto } from './dto/resume-vacation.dto';
import { ScheduleVacationDto } from './dto/schedule-vacation.dto';
import { VacationSchedulesService } from './vacation-schedules.service';

@Controller()
export class VacationSchedulesController {
  constructor(private readonly service: VacationSchedulesService) {}

  @Post('employees/:employeeId/vacation/schedule')
  schedule(@Param('employeeId') employeeId: string, @Body() dto: ScheduleVacationDto) {
    return this.service.schedule(employeeId, dto);
  }

  @Get('employees/:employeeId/vacation/schedules')
  findAllForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findAllForEmployee(employeeId);
  }

  @Patch('vacation-schedules/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Patch('vacation-schedules/:id/resume')
  resume(@Param('id') id: string, @Body() dto: ResumeVacationDto) {
    return this.service.resume(id, dto);
  }
}
