ALTER TABLE "Receivable" ADD COLUMN "companyId" TEXT;

UPDATE "Receivable" r SET "companyId" = c."companyId" FROM "Client" c WHERE c.id = r."clientId";

ALTER TABLE "Receivable" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Receivable_companyId_idx" ON "Receivable"("companyId");

ALTER TABLE "Subscription" ADD COLUMN "companyId" TEXT;

UPDATE "Subscription" s SET "companyId" = c."companyId" FROM "Client" c WHERE c.id = s."clientId";

ALTER TABLE "Subscription" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Subscription_companyId_idx" ON "Subscription"("companyId");
