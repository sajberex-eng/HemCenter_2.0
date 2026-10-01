-- AlterEnum
ALTER TYPE "ChatType" ADD VALUE 'ARCHIVE';

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "importHash" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "importedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isExternal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ImportSession" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportSession_createdById_idx" ON "ImportSession"("createdById");

-- CreateIndex
CREATE INDEX "ImportSession_expiresAt_idx" ON "ImportSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_importHash_key" ON "Chat"("importHash");

