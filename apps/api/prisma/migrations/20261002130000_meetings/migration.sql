-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PLANNED', 'HELD', 'CANCELED');

-- CreateEnum
CREATE TYPE "ResolutionKind" AS ENUM ('DECISION', 'INSTRUCTION');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "place" TEXT,
    "projectId" TEXT,
    "chatId" TEXT NOT NULL,
    "chairId" TEXT NOT NULL,
    "secretaryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'PLANNED',
    "protocolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "heard" TEXT,

    CONSTRAINT "MeetingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingResolution" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "ResolutionKind" NOT NULL,
    "text" TEXT NOT NULL,
    "responsibleId" TEXT,
    "due" DATE,
    "decisionId" TEXT,

    CONSTRAINT "MeetingResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_chatId_key" ON "Meeting"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_protocolId_key" ON "Meeting"("protocolId");

-- CreateIndex
CREATE INDEX "Meeting_startsAt_idx" ON "Meeting"("startsAt");

-- CreateIndex
CREATE INDEX "MeetingItem_meetingId_position_idx" ON "MeetingItem"("meetingId", "position");

-- CreateIndex
CREATE INDEX "MeetingResolution_itemId_position_idx" ON "MeetingResolution"("itemId", "position");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_chairId_fkey" FOREIGN KEY ("chairId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_secretaryId_fkey" FOREIGN KEY ("secretaryId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingItem" ADD CONSTRAINT "MeetingItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingResolution" ADD CONSTRAINT "MeetingResolution_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MeetingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingResolution" ADD CONSTRAINT "MeetingResolution_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingResolution" ADD CONSTRAINT "MeetingResolution_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

