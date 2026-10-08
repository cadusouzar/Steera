-- Estoque v1: valor e custos guardados com 6 casas (antes 2/4). Com 2 casas no valor, uma entrada de
-- 4 x 7,1234 virava custo médio 7,1225 — a entrada após saldo zero não fixava o custo informado.
-- Só amplia a precisão (sem perda de dado).

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "stockValue" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "averageCost" SET DATA TYPE DECIMAL(18,6);

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "unitCost" SET DATA TYPE DECIMAL(18,6),
ALTER COLUMN "valueDelta" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "valueBefore" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "valueAfter" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "averageCostBefore" SET DATA TYPE DECIMAL(18,6),
ALTER COLUMN "averageCostAfter" SET DATA TYPE DECIMAL(18,6);

