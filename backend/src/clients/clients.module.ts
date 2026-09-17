import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientTrashService } from './client-trash.service';

@Module({
  imports: [CompanyModule, CustomFieldsModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientTrashService],
  exports: [ClientsService],
})
export class ClientsModule {}
