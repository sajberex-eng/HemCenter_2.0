-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RETURNED', 'APPROVED', 'SIGNED', 'REGISTERED');

-- CreateTable
CREATE TABLE "DocumentKind" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentKind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryCounter" (
    "kindId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RegistryCounter_pkey" PRIMARY KEY ("kindId","year")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "kindId" TEXT NOT NULL,
    "lang" "Locale" NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kindId" TEXT NOT NULL,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "lang" "Locale" NOT NULL,
    "data" JSONB NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "docDate" DATE NOT NULL,
    "authorId" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "registeredAt" TIMESTAMP(3),
    "docxKey" TEXT,
    "pdfKey" TEXT,
    "pdfSha256" TEXT,
    "renderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentKind_code_key" ON "DocumentKind"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_kindId_lang_version_key" ON "DocumentTemplate"("kindId", "lang", "version");

-- CreateIndex
CREATE INDEX "Document_authorId_idx" ON "Document"("authorId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- AddForeignKey
ALTER TABLE "RegistryCounter" ADD CONSTRAINT "RegistryCounter_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "DocumentKind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "DocumentKind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "DocumentKind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

