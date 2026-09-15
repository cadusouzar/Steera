CREATE TYPE "ContractType" AS ENUM ('CLT', 'PJ', 'ESTAGIO');

CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contractType" "ContractType" NOT NULL,
    "admissionDate" DATE NOT NULL,
    "terminationDate" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "department" TEXT NOT NULL,
    "baseValue" DECIMAL(10,2) NOT NULL,
    "paymentDueDay" INTEGER NOT NULL,
    "payOnLastBusinessDay" BOOLEAN NOT NULL DEFAULT false,
    "bankDetails" TEXT,
    "salaryRecurrenceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Employee_companyId_idx" ON "Employee"("companyId");

CREATE INDEX "Employee_roleId_idx" ON "Employee"("roleId");

CREATE INDEX "Employee_status_idx" ON "Employee"("status");

CREATE UNIQUE INDEX "Employee_companyId_cpf_key" ON "Employee"("companyId", "cpf");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
