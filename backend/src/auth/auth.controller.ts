import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LinkEmployeeDto } from './dto/link-employee.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
import { AllowDuringForcedPasswordChange } from './decorators/allow-during-forced-password-change.decorator';
import { Public } from './decorators/public.decorator';
import { AntiCsrfHeaderGuard } from './guards/anti-csrf-header.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { loginEmailTracker } from './login-throttle.util';

// `me`/`me/password` levam @UseGuards(JwtAuthGuard) explícito aqui, mesmo
// sabendo que a Task 4 vai registrar esse mesmo guard globalmente — sem
// isso, ficariam sem nenhuma proteção no intervalo entre esta task e a
// próxima (o guard global só existe depois que app.module.ts for
// atualizado). Redundante depois da Task 4, nunca incorreto.
//
// ThrottlerGuard é aplicado só nos métodos abaixo que precisam dele
// (register/login/refresh/me/password), não na classe inteira — aplicar na
// classe também limitaria /auth/me e /auth/logout, e /auth/me em especial é
// chamado a cada carregamento de página/restauração de sessão pelo
// frontend; num cenário de IP compartilhado (NAT), isso poderia bloquear
// usuários legítimos sem necessidade — nada no brief/spec pediu throttling
// pra essas 2 rotas.
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // As 4 rotas abaixo são @Public() de propósito — ninguém tem token antes
  // de logar/registrar, e logout precisa funcionar mesmo com um access
  // token já expirado (só o cookie de refresh importa pra ele).
  //
  // @SkipThrottle({'login-email': true}): register cria uma Company/User
  // novos a cada chamada bem-sucedida (rastrear por e-mail não faz o mesmo
  // sentido de "várias tentativas contra a MESMA conta" que faz em login) —
  // só o throttler "default" (por IP) se aplica aqui.
  //
  // AntiCsrfHeaderGuard roda ANTES do ThrottlerGuard de propósito: uma
  // requisição sem o cabeçalho é rejeitada com 400 sem consumir uma unidade
  // do bucket de throttle (ver anti-csrf-header.guard.ts).
  @Public()
  @UseGuards(AntiCsrfHeaderGuard, ThrottlerGuard)
  @SkipThrottle({ 'login-email': true })
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, res);
  }

  // Dois throttlers em paralelo aqui (ver login-throttle.util.ts e
  // app.module.ts): "default" por IP (5/15min, já existia) e "login-email"
  // (novo) por e-mail, sem IP na chave — fecha a lacuna de um atacante que
  // faz brute-force de UM e-mail conhecido rotacionando IPs, que o "default"
  // sozinho não pega (cada IP novo começa com bucket zerado).
  // AntiCsrfHeaderGuard (ver register acima e anti-csrf-header.guard.ts) roda
  // antes dos throttlers pelo mesmo motivo.
  @Public()
  @UseGuards(AntiCsrfHeaderGuard, ThrottlerGuard)
  @Throttle({
    default: { limit: 5, ttl: 900_000 },
    'login-email': { limit: 5, ttl: 900_000, getTracker: loginEmailTracker },
  })
  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
  }

  // Limite bem mais generoso que login/register (60/15min vs 5/15min):
  // POST /auth/refresh é chamado em TODO carregamento de página/restauração
  // de sessão (RequireAuth -> restoreSession() -> refreshOnce(), ver
  // src/lib/auth.ts) — 5/15min bastava pra 6 reloads derrubarem a sessão de
  // um usuário legítimo. 60/15min ainda é um teto real (protege contra abuso
  // grosseiro) mas dá folga confortável até pra um escritório pequeno atrás
  // do mesmo IP compartilhado. @SkipThrottle({'login-email': true}): refresh
  // não tem e-mail no corpo (só o cookie httpOnly), então esse throttler não
  // se aplica aqui — sem o skip, todo refresh sem e-mail cairia no mesmo
  // bucket "sem e-mail" (ver fallback em loginEmailTracker), o que juntaria
  // usuários diferentes na mesma chave.
  @Public()
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ 'login-email': true })
  @Throttle({ default: { limit: 60, ttl: 900_000 } })
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
  // @AllowDuringForcedPasswordChange(): sem isso, um login com
  // mustChangePassword: true nunca conseguiria nem descobrir essa flag via
  // GET /auth/me (JwtAuthGuard bloquearia a própria rota que existe pra
  // informar isso ao frontend).
  @AllowDuringForcedPasswordChange()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.userId);
  }

  // Sem throttle até esta rodada de fixes era uma escolha deliberada (igual
  // /auth/me) — mas diferente de /auth/me, esta rota aceita um
  // `currentPassword` adivinhável: um access token de 15min roubado
  // permitiria brute-force ilimitado contra a senha atual de verdade sem
  // isso. Limite generoso o bastante pra nunca travar um usuário legítimo
  // reeditando um typo algumas vezes.
  // @AllowDuringForcedPasswordChange(): esta é exatamente a rota que um
  // login com mustChangePassword: true precisa conseguir chamar pra sair
  // desse estado — bloqueá-la junto do resto das rotas de negócio deixaria o
  // usuário travado sem saída (ver JwtAuthGuard).
  @AllowDuringForcedPasswordChange()
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @SkipThrottle({ 'login-email': true })
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Patch('me/password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.userId, dto);
  }

  // Auto-vínculo admin<->funcionário (Task 4 do plano de Controle de Ponto):
  // a identidade do CALLER (userId/companyId) vem só de req.user via
  // @CurrentUser() — nunca do body. O único id legítimo no body é o
  // `employeeId` ALVO (o funcionário existente que este login está
  // escolhendo vincular a si mesmo); AuthService.linkCurrentUserToEmployee
  // valida que ele pertence à mesma empresa e não tem outro User já
  // vinculado. @UseGuards(JwtAuthGuard) explícito aqui é redundante com o
  // APP_GUARD global (ver app.module.ts) — mesmo padrão redundante-de-propósito
  // já usado em `me`/`me/password` acima.
  @UseGuards(JwtAuthGuard)
  @Patch('me/employee-link')
  linkEmployee(@CurrentUser() user: AuthenticatedUser, @Body() dto: LinkEmployeeDto) {
    return this.auth.linkCurrentUserToEmployee(user.userId, user.companyId, dto.employeeId);
  }
}
