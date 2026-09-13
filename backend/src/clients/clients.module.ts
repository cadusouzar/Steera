import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientTrashService } from './client-trash.service';

@Module({
  imports: [CompanyModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientTrashService],
  exports: [ClientsService],
})
export class ClientsModule {}
