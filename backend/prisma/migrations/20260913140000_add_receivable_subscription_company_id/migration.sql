-- Security-audit remediation (RLS backstop, step 1/2): Receivable and
-- Subscription were previously scoped to a tenant only indirectly, via
-- their `clientId` -> `Client.companyId` relation. Adding a direct,
-- indexed companyId column here (same nullable-add -> backfill -> NOT NULL
-- -> FK -> index pattern used for Client.companyId itself, see
-- 20260912211333_add_client_company_id/migration.sql) is what lets the RLS
-- policies added in the next migration be a simple, fast
-- `"companyId" = current_setting(...)` check on each table directly,
-- instead of a slower/more fragile subquery through Client.
--
-- Backfill is a straight JOIN against the existing (already correct, already
-- NOT NULL) Client.companyId — every Receivable/Subscription row already has
-- a valid clientId, so this cannot leave any row with a NULL companyId.

-- Receivable
ALTER TABLE "Receivable" ADD COLUMN "companyId" TEXT;
UPDATE "Receivable" r SET "companyId" = c."companyId" FROM "Client" c WHERE c.id = r."clientId";
ALTER TABLE "Receivable" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Receivable_companyId_idx" ON "Receivable"("companyId");

-- Subscription
ALTER TABLE "Subscription" ADD COLUMN "companyId" TEXT;
UPDATE "Subscription" s SET "companyId" = c."companyId" FROM "Client" c WHERE c.id = s."clientId";
ALTER TABLE "Subscription" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Subscription_companyId_idx" ON "Subscription"("companyId");
