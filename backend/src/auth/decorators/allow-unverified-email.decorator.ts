import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_EMAIL_KEY = 'allowUnverifiedEmail';

// Mesmo padrão de @AllowDuringForcedPasswordChange(): marca uma rota autenticada como alcançável
// mesmo enquanto o fundador ainda não confirmou o e-mail (ver EmailVerifiedGuard). Só as rotas que
// a área "Minha conta" do site precisa pra funcionar e pra sair desse estado: GET/PATCH /auth/me,
// PATCH /auth/me/company, PATCH /auth/me/password, POST /auth/resend-verification e GET /plans/me.
// Rotas @Public() (logout, refresh, verify-email) já passam sem este decorator.
export const AllowUnverifiedEmail = () => SetMetadata(ALLOW_UNVERIFIED_EMAIL_KEY, true);
