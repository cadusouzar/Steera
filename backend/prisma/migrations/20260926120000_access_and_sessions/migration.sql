-- Acesso e sessões (Task 1): bloqueio temporário de login, confirmação de e-mail, convite de
-- login e tokens de uso único (confirmação/convite/redefinição de senha). Valor novo de enum não
-- pode ser usado na mesma transação em que é criado, por isso os dados (LOCKED -> ACTIVE,
-- backfill de emailVerifiedAt) vão na migration seguinte
-- (20260926120100_access_and_sessions_data).
--
-- "UserToken" é central (mesmo tratamento de "RefreshToken"): sem RLS, sem GRANT explícito — o
-- papel de aplicação (quickflow_app) já é o dono do banco/schema (ver AMBIENTE-LOCAL no vault),
-- então já tem privilégio completo em qualquer tabela nova que ele mesmo cria via migration, o
-- mesmo motivo pelo qual nenhuma migration anterior deste projeto (incluindo a que criou
-- "TenantMigration", outra tabela central) precisou de um GRANT explícito.

ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'INVITED';

CREATE TYPE "UserTokenType" AS ENUM ('EMAIL_VERIFICATION', 'INVITE', 'PASSWORD_RESET');

ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UserTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");
CREATE INDEX "UserToken_userId_type_idx" ON "UserToken"("userId", "type");
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
