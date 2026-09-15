import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [AuditLogModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
