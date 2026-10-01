-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpRecoveryHashes" TEXT[],
ADD COLUMN     "totpSecretEnc" TEXT;
