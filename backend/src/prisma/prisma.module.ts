import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { tenantRlsExtension } from './tenant-rls.extension';

// Internal-only token for the raw, connection-managing PrismaClient instance
// (Nest still calls its onModuleInit/onModuleDestroy — see below). Every
// other provider in the app injects the PUBLIC `PrismaService` token, which
// resolves to the tenant-RLS-extended client instead (same underlying
// connection/engine, just with the extension from tenant-rls.extension.ts
// applied) — this keeps every existing `constructor(private readonly prisma:
// PrismaService)` across the app unchanged; only this module knows an
// extension is involved at all.
const RAW_PRISMA_CLIENT = Symbol('RAW_PRISMA_CLIENT');

@Global()
@Module({
  providers: [
    { provide: RAW_PRISMA_CLIENT, useClass: PrismaService },
    {
      provide: PrismaService,
      // Nest calls lifecycle hooks (onModuleInit/onModuleDestroy) on any
      // instance IT constructs that implements them, regardless of which
      // token that instance is registered under — so $connect/$disconnect
      // on the raw instance above still happen normally. $extends() returns
      // a new client object sharing the SAME underlying engine/connection,
      // so it observes that connect/disconnect state transparently.
      useFactory: (raw: PrismaService) => raw.$extends(tenantRlsExtension(raw)) as unknown as PrismaService,
      inject: [RAW_PRISMA_CLIENT],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
