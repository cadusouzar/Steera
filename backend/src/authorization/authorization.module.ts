import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { EmployeeScopeService } from './employee-scope.service';

@Module({
  providers: [AuthorizationService, EmployeeScopeService],
  exports: [AuthorizationService, EmployeeScopeService],
})
export class AuthorizationModule {}
