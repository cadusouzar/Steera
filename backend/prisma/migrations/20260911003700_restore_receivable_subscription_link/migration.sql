-- Second part of the same remediation as 20260911003303_restore_client_trash_columns:
-- restores Receivable.subscriptionId/referenceYear/referenceMonth (and their
-- unique constraint + FK), also silently dropped by the same accidental
-- `prisma db push --accept-data-loss` on 2026-09-10. Confirmed via
-- `prisma migrate diff --from-schema-datasource --to-schema-datamodel`
-- (introspection-only, no shadow database) that this is the ONLY remaining
-- drift between the live database and schema.prisma. No data loss: the only
-- Subscription row was never used to generate a charge (its one Receivable
-- was created manually, unlinked), so subscriptionId/referenceYear/
-- referenceMonth were never populated with real values to begin with.

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "referenceMonth" INTEGER,
ADD COLUMN     "referenceYear" INTEGER,
ADD COLUMN     "subscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_subscriptionId_referenceYear_referenceMonth_key" ON "Receivable"("subscriptionId", "referenceYear", "referenceMonth");

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
