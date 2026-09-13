import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_FORCED_PASSWORD_CHANGE_KEY = 'allowDuringForcedPasswordChange';

// Mesmo padrão de @Public() (public.decorator.ts): marca uma rota como
// alcançável mesmo quando `user.mustChangePassword` é true. Aplicado só em
// GET /auth/me (pro frontend descobrir a flag) e PATCH /auth/me/password
// (pro usuário conseguir de fato trocar a senha) — ver JwtAuthGuard.
export const AllowDuringForcedPasswordChange = () => SetMetadata(ALLOW_DURING_FORCED_PASSWORD_CHANGE_KEY, true);
