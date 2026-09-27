import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LinkEmployeeDto } from './dto/link-employee.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenDto } from './dto/token.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
import { AllowDuringForcedPasswordChange } from './decorators/allow-during-forced-password-change.decorator';
import { AllowUnverifiedEmail } from './decorators/allow-unverified-email.decorator';
import { Public } from './decorators/public.decorator';
import { AntiCsrfHeaderGuard } from './guards/anti-csrf-header.guard';
import { FriendlyThrottlerGuard } from './guards/friendly-throttler.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { loginEmailTracker } from './login-throttle.util';
import { refreshIpTracker, refreshSessionTracker } from './refresh-throttle.util';

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
  @UseGuards(AntiCsrfHeaderGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'login-email': true, 'refresh-ip': true })
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, res);
  }

  // Só o throttler "default", por IP: 100/15min ("Acesso e sessões", 26/09/2026 — era 5/5min). Um
  // escritório inteiro atrás do mesmo IP errando senha de manhã estourava o limite de todo mundo; a
  // proteção de verdade contra chute de senha é por CONTA, dentro de AuthService.login (trava de 15min
  // na 5ª senha errada, com um espelho em memória idêntico pra e-mail sem conta — anti-enumeração),
  // então o limite por IP fica só como teto contra abuso grosseiro (password spraying em massa).
  // @SkipThrottle({'login-email': true}) (fix round 1): o throttler por e-mail rodava ANTES do
  // handler e por isso contava login CERTO também — 6 logins legítimos em 15min (várias abas/
  // aparelhos) davam 403 sem nenhuma senha errada. A contagem por e-mail agora vive no AuthService,
  // que só enxerga (e só conta) falhas.
  // AntiCsrfHeaderGuard (ver register acima e anti-csrf-header.guard.ts) roda antes do throttler
  // pelo mesmo motivo.
  @Public()
  @UseGuards(AntiCsrfHeaderGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'login-email': true, 'refresh-ip': true })
  @Throttle({ default: { limit: 100, ttl: 900_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
  }

  // 60/15min POR SESSÃO (sha256 do cookie rt, ver refresh-throttle.util.ts — "Acesso e sessões",
  // 26/09/2026), não mais por IP: POST /auth/refresh é chamado em TODO carregamento de
  // página/restauração de sessão (RequireAuth -> restoreSession() -> refreshOnce(), ver
  // src/lib/auth.ts), e com a chave por IP um escritório inteiro atrás do mesmo IP dividia um único
  // bucket — os reloads de um derrubavam a sessão dos outros. 60/15min por sessão ainda é um teto
  // real contra abuso grosseiro. Sem cookie, cai no IP. @SkipThrottle({'login-email': true}):
  // refresh não tem e-mail no corpo, então esse throttler não se aplica aqui — sem o skip, todo
  // refresh cairia no mesmo bucket "sem e-mail" (ver fallback em loginEmailTracker).
  @Public()
  @UseGuards(FriendlyThrottlerGuard)
  //
  // "refresh-ip" (fix final): teto secundário de 600/15min por IP. Só por sessão, quem manda um cookie
  // aleatório a cada requisição ganhava um bucket novo toda vez — nunca batia em limite nenhum. Esta
  // é a ÚNICA rota que não pula "refresh-ip" (ver app-throttlers.ts).
  @SkipThrottle({ 'login-email': true })
  @Throttle({
    default: { limit: 60, ttl: 900_000, getTracker: refreshSessionTracker },
    'refresh-ip': { limit: 600, ttl: 900_000, getTracker: refreshIpTracker },
  })
  @Post('refresh')
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.rt, res);
  }

  // Esqueci minha senha / redefinir senha ("Acesso e sessões", 26/09/2026) — as duas @Public(), sem
  // sessão nenhuma ainda. AntiCsrfHeaderGuard nos dois pelo mesmo motivo de register()/login()
  // acima (um <form> cross-site não consegue setar o cabeçalho custom).
  //
  // forgot-password: dois throttlers em paralelo — "default" por IP
  // (5/15min, mais apertado que o de login porque aqui cada chamada bem-sucedida DISPARA um e-mail
  // de verdade, então o teto contra abuso grosseiro precisa ser mais baixo) e "login-email" por
  // e-mail (3/15min — mais apertado que os 5/15min do próprio login, pra não deixar alguém inundar
  // a caixa de entrada de UMA conta com pedidos de redefinição repetidos).
  @Public()
  @UseGuards(AntiCsrfHeaderGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'refresh-ip': true })
  @Throttle({
    default: { limit: 5, ttl: 900_000 },
    'login-email': { limit: 3, ttl: 900_000, getTracker: loginEmailTracker },
  })
  @HttpCode(202)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  // reset-password: sem e-mail no corpo (só token + senha nova), então o throttler "login-email"
  // não faz sentido aqui — @SkipThrottle nele pelo mesmo motivo de refresh() acima (sem isso, toda
  // chamada cairia no bucket "sem e-mail" do fallback de loginEmailTracker). Limite só por IP,
  // mesmo teto genérico já usado por accept-invite/verify-email (10/15min).
  @Public()
  @UseGuards(AntiCsrfHeaderGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'login-email': true, 'refresh-ip': true })
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(204)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  // Aceite de convite ("Acesso e sessões", 26/09/2026): login criado por um admin nasce INVITED e a
  // pessoa define a própria senha por aqui. Mesmas proteções de reset-password: @Public() (o link
  // chega por e-mail, sem sessão), AntiCsrfHeaderGuard, sem e-mail no corpo (daí o @SkipThrottle do
  // "login-email") e teto por IP de 10/15min. Não loga automaticamente.
  @Public()
  @UseGuards(AntiCsrfHeaderGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'login-email': true, 'refresh-ip': true })
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(204)
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.auth.acceptInvite(dto.token, dto.password);
  }

  // Confirmação de e-mail ("Acesso e sessões", 26/09/2026). verify-email é @Public(): o link pode
  // ser aberto em outro dispositivo, sem sessão nenhuma — mesmo teto por IP de reset-password
  // (10/15min), AntiCsrfHeaderGuard pelo mesmo motivo de register()/login().
  @Public()
  @UseGuards(AntiCsrfHeaderGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'login-email': true, 'refresh-ip': true })
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(204)
  @Post('verify-email')
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  // resend-verification: logado (o fundador ainda não confirmado está exatamente nesse estado, daí
  // @AllowUnverifiedEmail), 3/h POR USUÁRIO. req.user já existe quando o getTracker roda: guards
  // globais (APP_GUARD — JwtAuthGuard, que popula req.user via JwtStrategy) sempre executam antes
  // dos guards de método, e dentro do @UseGuards abaixo o JwtAuthGuard ainda vem antes do
  // FriendlyThrottlerGuard. O `?? req.ip` é só uma rede de segurança que nunca deveria disparar.
  @AllowUnverifiedEmail()
  @UseGuards(JwtAuthGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'login-email': true, 'refresh-ip': true })
  @Throttle({ default: { limit: 3, ttl: 3_600_000, getTracker: (req) => `user:${req.user?.userId ?? req.ip}` } })
  @HttpCode(202)
  @Post('resend-verification')
  resendVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.resendVerification(user.userId);
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
  // @AllowUnverifiedEmail(): o frontend precisa ler o perfil (emailVerified/
  // emailVerificationRequired) pra mostrar o aviso de confirmação — ver EmailVerifiedGuard.
  @AllowDuringForcedPasswordChange()
  @AllowUnverifiedEmail()
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
  @AllowUnverifiedEmail()
  @UseGuards(JwtAuthGuard, FriendlyThrottlerGuard)
  @SkipThrottle({ 'login-email': true, 'refresh-ip': true })
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Patch('me/password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.userId, dto);
  }

  // Área "Minha conta" do site: o próprio login edita o nome. Identidade só de req.user (nunca do
  // body); e-mail não é editável.
  @AllowUnverifiedEmail()
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(user.userId, dto);
  }

  // Dados cadastrais da empresa (razão social, fantasia, telefone, endereço) — só ADMIN; documento
  // e tipo de pessoa nunca mudam por aqui. companyId vem do JWT, nunca do body.
  @AllowUnverifiedEmail()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('me/company')
  updateCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCompanyDto) {
    return this.auth.updateCompany(user.userId, user.companyId, dto);
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
  // Achado 1 da revisão final (27/09/2026): só vale pra quem gerencia usuários ou tem todo alcance
  // EMPRESA (403 PERMISSION_REQUIRED caso contrário, ver employee-link.util.ts); os demais pedem a
  // quem administra os acessos (PATCH /companies/me/users/:id/employee).
  @UseGuards(JwtAuthGuard)
  @Patch('me/employee-link')
  linkEmployee(@CurrentUser() user: AuthenticatedUser, @Body() dto: LinkEmployeeDto) {
    return this.auth.linkCurrentUserToEmployee(user.userId, user.companyId, dto.employeeId);
  }
}
