import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { InviteMailer } from './invite-mailer';
import { UserTokensService } from './user-tokens.service';

// Não @Global(): módulos que precisam emitir/consumir tokens (AuthModule,
// UsersModule) importam este módulo explicitamente. InviteMailer mora aqui (e
// não em AuthService) pra UsersModule poder enviar convites sem importar
// AuthModule inteiro — ver o comentário em invite-mailer.ts. EmailService vem
// do EmailModule (@Global).
@Module({
  imports: [PrismaModule],
  providers: [UserTokensService, InviteMailer],
  exports: [UserTokensService, InviteMailer],
})
export class UserTokensModule {}
