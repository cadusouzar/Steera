import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { CustomFieldDefinitionsService } from './custom-field-definitions.service';
import { CustomFieldValuesService } from './custom-field-values.service';
import { CustomFieldsController } from './custom-fields.controller';

@Module({
  imports: [CompanyModule],
  controllers: [CustomFieldsController],
  providers: [CustomFieldDefinitionsService, CustomFieldValuesService],
  exports: [CustomFieldValuesService],
})
export class CustomFieldsModule {}
