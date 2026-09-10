-- CreateTable
CREATE TABLE "EmployeeWarning" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "occurredAt" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeWarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeWarning_companyId_idx" ON "EmployeeWarning"("companyId");

-- CreateIndex
CREATE INDEX "EmployeeWarning_employeeId_idx" ON "EmployeeWarning"("employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeWarning" ADD CONSTRAINT "EmployeeWarning_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
