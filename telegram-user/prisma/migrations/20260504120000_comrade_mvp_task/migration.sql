-- CreateEnum
CREATE TYPE "ComradeTaskStatus" AS ENUM (
  'CREATED',
  'WAITING_CONFIRMATION',
  'FIRST_MESSAGE_PENDING',
  'WAITING_RESPONSE',
  'FOLLOWUP_DUE',
  'RESPONSE_RECEIVED',
  'GOAL_ACHIEVED',
  'PAUSED',
  'CLOSED'
);

-- CreateEnum
CREATE TYPE "ComradeTemplateType" AS ENUM (
  'GET_DOCUMENT',
  'FOLLOWUP_REPLY',
  'SCHEDULE_MEETING',
  'COLLECT_INFO',
  'REMIND_AGREEMENT'
);

-- CreateTable
CREATE TABLE "ComradeTask" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT '',
    "templateType" "ComradeTemplateType" NOT NULL,
    "status" "ComradeTaskStatus" NOT NULL DEFAULT 'CREATED',
    "linkedChatId" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "lastReportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComradeTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComradeTask_appUserId_status_idx" ON "ComradeTask"("appUserId", "status");

-- CreateIndex
CREATE INDEX "ComradeTask_linkedChatId_idx" ON "ComradeTask"("linkedChatId");

-- AddForeignKey
ALTER TABLE "ComradeTask" ADD CONSTRAINT "ComradeTask_linkedChatId_fkey" FOREIGN KEY ("linkedChatId") REFERENCES "TgDialog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
