-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'REVIEW', 'DONE', 'RETURNED', 'REMOVED');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('DOCUMENT', 'CHAT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'ACCEPTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "DueChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssignmentEventKind" AS ENUM ('CREATED', 'STARTED', 'REPORT', 'ACCEPTED', 'RETURNED', 'DUE_REQUESTED', 'DUE_APPROVED', 'DUE_REJECTED', 'REMOVED');

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "coResponsibleIds" TEXT[],
    "controllerId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "originalDue" DATE NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'NEW',
    "doneAt" TIMESTAMP(3),
    "removedReason" TEXT,
    "sourceKind" "AssignmentSource" NOT NULL,
    "sourceDocumentId" TEXT,
    "sourceResolutionId" TEXT,
    "sourceChatId" TEXT,
    "sourceMessageId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionReport" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportFile" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueChange" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "oldDue" DATE NOT NULL,
    "newDue" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DueChangeStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentEvent" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "AssignmentEventKind" NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "assignmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("assignmentId","kind","day")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "assignmentId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assignment_responsibleId_status_idx" ON "Assignment"("responsibleId", "status");

-- CreateIndex
CREATE INDEX "Assignment_controllerId_status_idx" ON "Assignment"("controllerId", "status");

-- CreateIndex
CREATE INDEX "Assignment_dueDate_idx" ON "Assignment"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_sourceDocumentId_sourceResolutionId_key" ON "Assignment"("sourceDocumentId", "sourceResolutionId");

-- CreateIndex
CREATE INDEX "ExecutionReport_assignmentId_createdAt_idx" ON "ExecutionReport"("assignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "DueChange_assignmentId_status_idx" ON "DueChange"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "AssignmentEvent_assignmentId_at_idx" ON "AssignmentEvent"("assignmentId", "at");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionReport" ADD CONSTRAINT "ExecutionReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionReport" ADD CONSTRAINT "ExecutionReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionReport" ADD CONSTRAINT "ExecutionReport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFile" ADD CONSTRAINT "ReportFile_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ExecutionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DueChange" ADD CONSTRAINT "DueChange_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DueChange" ADD CONSTRAINT "DueChange_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DueChange" ADD CONSTRAINT "DueChange_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentEvent" ADD CONSTRAINT "AssignmentEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentEvent" ADD CONSTRAINT "AssignmentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

