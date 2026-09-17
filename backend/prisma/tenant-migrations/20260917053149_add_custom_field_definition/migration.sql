CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'DATETIME', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'EMAIL', 'PHONE');

CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "columnName" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "description" TEXT,
    "configuration" JSONB,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldDefinition_companyId_entity_columnName_key" ON "CustomFieldDefinition"("companyId", "entity", "columnName");

ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomFieldDefinition" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "CustomFieldDefinition" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "CustomFieldDefinition"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');
