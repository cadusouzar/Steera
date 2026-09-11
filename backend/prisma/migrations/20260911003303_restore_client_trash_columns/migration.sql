-- Remediation migration: restores two Client columns (and their index) that
-- were silently dropped by an accidental `prisma db push --accept-data-loss`
-- run against this shared local database during unrelated HR-module work on
-- 2026-09-10. The `_prisma_migrations` tracking table still listed
-- `20260910052941_add_client_revenue_report_flag` and
-- `20260910052945_add_client_deactivated_at` as applied (so `prisma migrate
-- status` reported "up to date"), but the live table was actually missing
-- both columns and the deactivatedAt index. Verified the only real Client
-- row's `status` is ACTIVE, so the restored defaults below are the correct,
-- lossless values (no client was ever deactivated before or after the
-- incident) — this is not a guess. See DECISOES-TECNICAS.md for the full
-- incident writeup.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "includeInRevenueReport" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Client" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Client_deactivatedAt_idx" ON "Client"("deactivatedAt");
