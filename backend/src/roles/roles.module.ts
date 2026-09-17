import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [CompanyModule, CustomFieldsModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
