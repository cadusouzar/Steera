import { Controller, Get, UseGuards } from '@nestjs/common';
import { AllowUnverifiedEmail } from '../auth/decorators/allow-unverified-email.decorator';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlansService } from './plans.service';

// Sem @RequireModule()/ModulesGuard de propósito: o próprio plano/uso da empresa é informação, não
// uma ação dentro de um módulo específico — qualquer login autenticado (ADMIN ou EMPLOYEE, tenha
// ele o módulo que for) precisa conseguir ver isso (ex.: a aba Assinatura de Minha conta).
// @UseGuards(JwtAuthGuard) aqui é redundante com o APP_GUARD global (ver app.module.ts) — mesmo
// padrão redundante-de-propósito já usado em AuthController (me/me/password).
@UseGuards(JwtAuthGuard)
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  // @AllowUnverifiedEmail(): a aba Assinatura de "Minha conta" (site) precisa funcionar mesmo antes
  // do fundador confirmar o e-mail — ver EmailVerifiedGuard.
  @AllowUnverifiedEmail()
  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.plans.getMyPlan(user.companyId, user.userId);
  }

  // Quem gerencia a assinatura (27/09/2026) — nota pra quando existir a rota de checkout/troca de
  // plano (NÃO existe hoje, e não deve existir sem cobrança de verdade — ver o histórico de
  // `PATCH /companies/me/plan`, removido por deixar o admin subir o próprio plano de graça):
  // ela precisa exigir a permissão no BACKEND, nunca confiar só no frontend esconder o botão:
  //
  //   @UseGuards(PermissionsGuard)
  //   @RequirePermission(SUBSCRIPTION_MANAGE_PERMISSION)   // 'assinatura.gerenciar'
  //   @Post('me/checkout')
  //
  // (`PermissionsGuard`/`RequirePermission` em backend/src/auth/, `SUBSCRIPTION_MANAGE_PERMISSION`
  // em backend/src/permissions/protected-permissions.ts.) O claim `permissions` do JWT pode ficar
  // até 15min defasado depois de uma troca de perfil — pra uma ação que cobra dinheiro, vale
  // reconferir no banco dentro do handler também, como `getMyPlan` já faz.
}
