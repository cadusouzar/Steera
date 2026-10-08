CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "StockMovementType" AS ENUM ('INITIAL', 'ENTRY', 'EXIT', 'ADJUSTMENT', 'REVERSAL');

CREATE TYPE "StockMovementReason" AS ENUM ('INITIAL_BALANCE', 'MANUAL_ENTRY', 'PURCHASE_RECEIVED', 'CUSTOMER_RETURN', 'OTHER_ENTRY', 'MANUAL_EXIT', 'INTERNAL_CONSUMPTION', 'LOSS', 'DAMAGE', 'SUPPLIER_RETURN', 'OTHER_EXIT', 'COUNT_ADJUSTMENT', 'REVERSAL');

CREATE TYPE "StockMovementOrigin" AS ENUM ('MANUAL');

ALTER TYPE "FileAssetPurpose" ADD VALUE 'PRODUCT_PHOTO';

CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductBrand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBrand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "description" TEXT,
    "photoAssetId" TEXT,
    "categoryId" TEXT,
    "brandId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "referenceCost" DECIMAL(18,4),
    "salePrice" DECIMAL(18,2),
    "minStock" DECIMAL(18,3),
    "targetStock" DECIMAL(18,3),
    "balance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "stockValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "averageCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "trashedAt" TIMESTAMP(3),
    "trashedByUserId" TEXT,
    "trashedByName" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "quantityDelta" DECIMAL(18,3) NOT NULL,
    "balanceBefore" DECIMAL(18,3) NOT NULL,
    "balanceAfter" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "valueDelta" DECIMAL(18,2) NOT NULL,
    "valueBefore" DECIMAL(18,2) NOT NULL,
    "valueAfter" DECIMAL(18,2) NOT NULL,
    "averageCostBefore" DECIMAL(18,4) NOT NULL,
    "averageCostAfter" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "documentRef" TEXT,
    "performedByUserId" TEXT NOT NULL,
    "performedByName" TEXT NOT NULL,
    "productNameAtTime" TEXT NOT NULL,
    "productSkuAtTime" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "requestId" TEXT,
    "origin" "StockMovementOrigin" NOT NULL DEFAULT 'MANUAL',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductCategory_companyId_idx" ON "ProductCategory"("companyId");

CREATE UNIQUE INDEX "ProductCategory_companyId_name_key" ON "ProductCategory"("companyId", "name");

CREATE INDEX "ProductBrand_companyId_idx" ON "ProductBrand"("companyId");

CREATE UNIQUE INDEX "ProductBrand_companyId_name_key" ON "ProductBrand"("companyId", "name");

CREATE INDEX "Product_companyId_idx" ON "Product"("companyId");

CREATE INDEX "Product_companyId_barcode_idx" ON "Product"("companyId", "barcode");

CREATE INDEX "Product_trashedAt_idx" ON "Product"("trashedAt");

CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "Product"("companyId", "sku");

CREATE UNIQUE INDEX "StockMovement_reversalOfId_key" ON "StockMovement"("reversalOfId");

CREATE INDEX "StockMovement_companyId_createdAt_idx" ON "StockMovement"("companyId", "createdAt");

CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

CREATE UNIQUE INDEX "StockMovement_productId_sequence_key" ON "StockMovement"("productId", "sequence");

CREATE UNIQUE INDEX "StockMovement_companyId_requestId_key" ON "StockMovement"("companyId", "requestId");

ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductBrand" ADD CONSTRAINT "ProductBrand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ProductBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_balance_non_negative" CHECK ("balance" >= 0 AND "stockValue" >= 0);

ALTER TABLE "ProductCategory" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ProductCategory" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ProductCategory"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "ProductBrand" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ProductBrand" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ProductBrand"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Product"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "StockMovement"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');
