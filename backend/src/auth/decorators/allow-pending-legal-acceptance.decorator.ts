import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_LEGAL_ACCEPTANCE_KEY = 'allowPendingLegalAcceptance';

// Mesmo padrão de @AllowUnverifiedEmail(): marca uma rota autenticada como alcançável enquanto o
// login ainda não aceitou a versão vigente dos Termos/Política (ver LegalAcceptanceGuard). Usado nas
// mesmas rotas de @AllowUnverifiedEmail() (as telas que aparecem antes do aceite precisam delas),
// em PATCH /auth/me/password e em POST /auth/me/legal-acceptance (a saída desse estado). Rotas
// @Public() já passam sem este decorator.
export const AllowPendingLegalAcceptance = () => SetMetadata(ALLOW_PENDING_LEGAL_ACCEPTANCE_KEY, true);
