CREATE TYPE "EmployeeRecurringPaymentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "EmployeePaymentStatus" AS ENUM ('PENDING', 'PAID');

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

CREATE INDEX "EmployeeRecurringPayment_companyId_idx" ON "EmployeeRecurringPayment"("companyId");

CREATE INDEX "EmployeeRecurringPayment_employeeId_idx" ON "EmployeeRecurringPayment"("employeeId");

CREATE INDEX "EmployeePayment_companyId_idx" ON "EmployeePayment"("companyId");

CREATE INDEX "EmployeePayment_employeeId_idx" ON "EmployeePayment"("employeeId");

CREATE INDEX "EmployeePayment_dueDate_idx" ON "EmployeePayment"("dueDate");

CREATE INDEX "EmployeePayment_status_idx" ON "EmployeePayment"("status");

CREATE UNIQUE INDEX "EmployeePayment_recurringPaymentId_referenceYear_referenceM_key" ON "EmployeePayment"("recurringPaymentId", "referenceYear", "referenceMonth");

ALTER TABLE "EmployeeRecurringPayment" ADD CONSTRAINT "EmployeeRecurringPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_recurringPaymentId_fkey" FOREIGN KEY ("recurringPaymentId") REFERENCES "EmployeeRecurringPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
