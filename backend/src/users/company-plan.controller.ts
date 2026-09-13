import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('companies/me')
export class CompanyPlanController {
  constructor(private readonly users: UsersService) {}

  @Roles('ADMIN')
  @Patch('plan')
  updatePlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePlanDto) {
    return this.users.updatePlan(user.companyId, dto);
  }
}
