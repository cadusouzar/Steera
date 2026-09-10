-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "referenceMonth" INTEGER,
ADD COLUMN     "referenceYear" INTEGER,
ADD COLUMN     "subscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_subscriptionId_referenceYear_referenceMonth_key" ON "Receivable"("subscriptionId", "referenceYear", "referenceMonth");

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
