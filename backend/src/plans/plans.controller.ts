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
    return this.plans.getMyPlan(user.companyId);
  }
}
