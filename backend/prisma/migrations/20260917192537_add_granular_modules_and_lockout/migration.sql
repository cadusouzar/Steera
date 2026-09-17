-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AppModule" ADD VALUE 'RH_CARGOS';
ALTER TYPE "AppModule" ADD VALUE 'RH_FUNCIONARIOS';
ALTER TYPE "AppModule" ADD VALUE 'PONTO_REGISTRO';
ALTER TYPE "AppModule" ADD VALUE 'PONTO_ADMINISTRACAO';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'LOCKED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;

