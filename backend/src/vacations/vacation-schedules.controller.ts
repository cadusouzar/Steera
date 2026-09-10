import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ScheduleVacationDto } from './dto/schedule-vacation.dto';
import { VacationSchedulesService } from './vacation-schedules.service';

@Controller()
export class VacationSchedulesController {
  constructor(private readonly service: VacationSchedulesService) {}

  @Get('employees/:employeeId/vacation/status')
  status(@Param('employeeId') employeeId: string) {
    return this.service.status(employeeId);
  }

  @Post('employees/:employeeId/vacation/simulate')
  simulate(@Param('employeeId') employeeId: string, @Body() dto: ScheduleVacationDto) {
    return this.service.simulate(employeeId, dto);
  }

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
}
