-- LGPD — Etapa A (07/10/2026): registro do aceite dos Termos de uso e da Política de Privacidade.
-- Uma linha por documento por versão aceita (histórico, só INSERT pela aplicação). As versões
-- atuais vivem em código (src/legal/legal-versions.ts).
--
-- "LegalAcceptance" é central (mesmo tratamento de "UserToken"/"RefreshToken"): sem RLS, sem GRANT
-- explícito — o papel de aplicação já é o dono do banco/schema (ver migration de UserToken,
-- 20260926120000_access_and_sessions). Não entra em TENANT_TABLE_NAMES.

CREATE TYPE "LegalDocument" AS ENUM ('TERMS', 'PRIVACY');

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" "LegalDocument" NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" VARCHAR(300),
    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LegalAcceptance_userId_document_version_idx" ON "LegalAcceptance"("userId", "document", "version");
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
