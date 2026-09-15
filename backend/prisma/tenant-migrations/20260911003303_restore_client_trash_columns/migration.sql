ALTER TABLE "Client" ADD COLUMN "includeInRevenueReport" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Client" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

CREATE INDEX "Client_deactivatedAt_idx" ON "Client"("deactivatedAt");
