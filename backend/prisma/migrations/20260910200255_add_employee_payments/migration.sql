-- CreateEnum
CREATE TYPE "EmployeeRecurringPaymentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmployeePaymentStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "EmployeeRecurringPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "status" "EmployeeRecurringPaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeRecurringPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "recurringPaymentId" TEXT,
    "referenceYear" INTEGER,
    "referenceMonth" INTEGER,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "EmployeePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeRecurringPayment_companyId_idx" ON "EmployeeRecurringPayment"("companyId");

-- CreateIndex
CREATE INDEX "EmployeeRecurringPayment_employeeId_idx" ON "EmployeeRecurringPayment"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayment_companyId_idx" ON "EmployeePayment"("companyId");

-- CreateIndex
CREATE INDEX "EmployeePayment_employeeId_idx" ON "EmployeePayment"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayment_dueDate_idx" ON "EmployeePayment"("dueDate");

-- CreateIndex
CREATE INDEX "EmployeePayment_status_idx" ON "EmployeePayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayment_recurringPaymentId_referenceYear_referenceM_key" ON "EmployeePayment"("recurringPaymentId", "referenceYear", "referenceMonth");

-- AddForeignKey
ALTER TABLE "EmployeeRecurringPayment" ADD CONSTRAINT "EmployeeRecurringPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_recurringPaymentId_fkey" FOREIGN KEY ("recurringPaymentId") REFERENCES "EmployeeRecurringPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

