import { Module } from '@nestjs/common';
import { TenantMigrationManagerService } from './tenant-migration-manager.service';

@Module({
  providers: [TenantMigrationManagerService],
})
export class TenantMigrationModule {}
