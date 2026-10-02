-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ApprovalActionKind" AS ENUM ('SUBMIT', 'APPROVE', 'RETURN', 'SCAN', 'REGISTER');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "registeredById" TEXT,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scanAt" TIMESTAMP(3),
ADD COLUMN     "scanKey" TEXT,
ADD COLUMN     "scanMime" TEXT,
ADD COLUMN     "scanName" TEXT,
ADD COLUMN     "scanSha256" TEXT,
ADD COLUMN     "scanSize" INTEGER;

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "ApprovalActionKind" NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalStep_approverId_status_idx" ON "ApprovalStep"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_documentId_approverId_key" ON "ApprovalStep"("documentId", "approverId");

-- CreateIndex
CREATE INDEX "ApprovalAction_documentId_at_idx" ON "ApprovalAction"("documentId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Document_kindId_registrationNumber_key" ON "Document"("kindId", "registrationNumber");

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

