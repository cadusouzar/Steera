import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UserTokensService } from './user-tokens.service';

// Não @Global(): módulos que precisam emitir/consumir tokens (AuthModule,
// UsersModule) importam este módulo explicitamente.
@Module({
  imports: [PrismaModule],
  providers: [UserTokensService],
  exports: [UserTokensService],
})
export class UserTokensModule {}
