import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [CompanyModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
