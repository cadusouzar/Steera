import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

// `me`/`me/password` levam @UseGuards(JwtAuthGuard) explícito aqui, mesmo
// sabendo que a Task 4 vai registrar esse mesmo guard globalmente — sem
// isso, ficariam sem nenhuma proteção no intervalo entre esta task e a
// próxima (o guard global só existe depois que app.module.ts for
// atualizado). Redundante depois da Task 4, nunca incorreto.
//
// ThrottlerGuard é aplicado só nos 3 métodos abaixo (register/login/refresh),
// não na classe inteira — aplicar na classe também limitaria /auth/me,
// /auth/me/password e /auth/logout ao mesmo bucket de 5/15min, e /auth/me em
// especial é chamado a cada carregamento de página/restauração de sessão
// pelo frontend; num cenário de IP compartilhado (NAT), isso poderia
// bloquear usuários legítimos sem necessidade — nada no brief/spec pediu
// throttling pra essas 3 rotas.
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // As 4 rotas abaixo são @Public() de propósito — ninguém tem token antes
  // de logar/registrar, e logout precisa funcionar mesmo com um access
  // token já expirado (só o cookie de refresh importa pra ele).
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('refresh')
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.rt, res);
  }

  @Public()
  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req.cookies?.rt, res);
  }

  // Busca o perfil completo (com email, que o JWT não carrega) — o frontend
  // usa isso pra saber quem está logado depois de uma renovação silenciosa
  // (F5), já que POST /auth/refresh só devolve o accessToken, não o perfil.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.userId, dto);
  }
}
