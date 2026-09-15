ALTER TABLE "Client" ADD COLUMN "companyId" TEXT;

UPDATE "Client" SET "companyId" = (SELECT "id" FROM "Company" ORDER BY "createdAt" ASC LIMIT 1);

ALTER TABLE "Client" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Client_companyId_idx" ON "Client"("companyId");
