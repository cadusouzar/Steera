import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UnknownLoginFailureTracker } from './unknown-login-failures';
import { UserTokensModule } from './user-tokens/user-tokens.module';

@Module({
  imports: [PrismaModule, PassportModule, JwtModule.register({}), AuthorizationModule, UserTokensModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Singleton por processo: a trava em memória de e-mail sem conta precisa ser a MESMA entre requisições.
    { provide: UnknownLoginFailureTracker, useFactory: () => new UnknownLoginFailureTracker() },
  ],
  exports: [JwtStrategy],
})
export class AuthModule {}
