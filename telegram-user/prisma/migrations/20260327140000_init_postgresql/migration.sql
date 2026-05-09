-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TgAccountStatus" AS ENUM ('pending_auth', 'active', 'sync_paused', 'error', 'revoked');

-- CreateEnum
CREATE TYPE "TgDialogType" AS ENUM ('user', 'group', 'supergroup', 'channel');

-- CreateEnum
CREATE TYPE "TgAuditActor" AS ENUM ('agent', 'user_ui', 'system', 'connector');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'done');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'awaiting_confirm', 'sent', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "CabinetUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "oidcSub" TEXT,
    "appUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabinetUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgAutomationJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "triggerTgMessageId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'auto',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "productAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgAutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAgent" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "planJson" TEXT NOT NULL DEFAULT '{}',
    "promptExtras" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAgentDialog" (
    "id" TEXT NOT NULL,
    "productAgentId" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAgentDialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNote" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotChannelPost" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotChannelPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsSubscription" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastDigestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerPing" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "accountId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "metaJson" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "WorkerPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgBotUserBinding" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgBotUserBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotConnectedChat" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "title" TEXT,
    "chatKind" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotConnectedChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgAccount" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "phoneIdHash" TEXT,
    "sessionEnc" BYTEA NOT NULL,
    "sessionVer" INTEGER NOT NULL DEFAULT 1,
    "status" "TgAccountStatus" NOT NULL DEFAULT 'pending_auth',
    "lastError" TEXT,
    "policyJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "accountId" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "notifyTelegram" BOOLEAN NOT NULL DEFAULT true,
    "notifyWeb" BOOLEAN NOT NULL DEFAULT true,
    "status" "ReminderStatus" NOT NULL DEFAULT 'pending',
    "requiresBotAck" BOOLEAN NOT NULL DEFAULT false,
    "telegramSentAt" TIMESTAMP(3),
    "webSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgDialog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "peerKey" TEXT NOT NULL,
    "title" TEXT,
    "dialogType" "TgDialogType" NOT NULL,
    "lastMsgId" INTEGER,
    "unreadLocal" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgDialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgAgentAllowedDialog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgAgentAllowedDialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "tgMessageId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "text" TEXT,
    "out" BOOLEAN NOT NULL DEFAULT false,
    "rawEnc" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgSyncState" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cursorPts" INTEGER,
    "cursorQts" INTEGER,
    "cursorDate" INTEGER,
    "extraJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgPendingSend" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "peerKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgPendingSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgAgentAuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actor" "TgAuditActor" NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgAgentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CabinetUser_email_key" ON "CabinetUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CabinetUser_oidcSub_key" ON "CabinetUser"("oidcSub");

-- CreateIndex
CREATE UNIQUE INDEX "CabinetUser_appUserId_key" ON "CabinetUser"("appUserId");

-- CreateIndex
CREATE INDEX "AssistantChatMessage_userId_createdAt_idx" ON "AssistantChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TgAutomationJob_accountId_status_idx" ON "TgAutomationJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "TgAutomationJob_productAgentId_idx" ON "TgAutomationJob"("productAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "TgAutomationJob_accountId_dialogId_triggerTgMessageId_key" ON "TgAutomationJob"("accountId", "dialogId", "triggerTgMessageId");

-- CreateIndex
CREATE INDEX "ProductAgent_appUserId_idx" ON "ProductAgent"("appUserId");

-- CreateIndex
CREATE INDEX "ProductAgent_appUserId_sortOrder_idx" ON "ProductAgent"("appUserId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductAgentDialog_productAgentId_idx" ON "ProductAgentDialog"("productAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAgentDialog_dialogId_key" ON "ProductAgentDialog"("dialogId");

-- CreateIndex
CREATE INDEX "UserNote_appUserId_createdAt_idx" ON "UserNote"("appUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BotChannelPost_appUserId_date_idx" ON "BotChannelPost"("appUserId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BotChannelPost_appUserId_telegramChatId_messageId_key" ON "BotChannelPost"("appUserId", "telegramChatId", "messageId");

-- CreateIndex
CREATE INDEX "NewsSubscription_appUserId_enabled_idx" ON "NewsSubscription"("appUserId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "NewsSubscription_appUserId_sourceKind_sourceId_key" ON "NewsSubscription"("appUserId", "sourceKind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TgBotUserBinding_telegramUserId_key" ON "TgBotUserBinding"("telegramUserId");

-- CreateIndex
CREATE INDEX "TgBotUserBinding_appUserId_idx" ON "TgBotUserBinding"("appUserId");

-- CreateIndex
CREATE INDEX "BotConnectedChat_appUserId_idx" ON "BotConnectedChat"("appUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BotConnectedChat_appUserId_telegramChatId_key" ON "BotConnectedChat"("appUserId", "telegramChatId");

-- CreateIndex
CREATE INDEX "TgAccount_status_idx" ON "TgAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TgAccount_appUserId_key" ON "TgAccount"("appUserId");

-- CreateIndex
CREATE INDEX "Task_appUserId_status_idx" ON "Task"("appUserId", "status");

-- CreateIndex
CREATE INDEX "Reminder_appUserId_status_idx" ON "Reminder"("appUserId", "status");

-- CreateIndex
CREATE INDEX "Reminder_fireAt_status_idx" ON "Reminder"("fireAt", "status");

-- CreateIndex
CREATE INDEX "TgDialog_accountId_idx" ON "TgDialog"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TgDialog_accountId_peerKey_key" ON "TgDialog"("accountId", "peerKey");

-- CreateIndex
CREATE INDEX "TgAgentAllowedDialog_accountId_idx" ON "TgAgentAllowedDialog"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TgAgentAllowedDialog_accountId_dialogId_key" ON "TgAgentAllowedDialog"("accountId", "dialogId");

-- CreateIndex
CREATE INDEX "TgMessage_dialogId_date_idx" ON "TgMessage"("dialogId", "date");

-- CreateIndex
CREATE INDEX "TgMessage_accountId_idx" ON "TgMessage"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TgMessage_dialogId_tgMessageId_key" ON "TgMessage"("dialogId", "tgMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "TgSyncState_accountId_key" ON "TgSyncState"("accountId");

-- CreateIndex
CREATE INDEX "TgPendingSend_accountId_status_idx" ON "TgPendingSend"("accountId", "status");

-- CreateIndex
CREATE INDEX "TgAgentAuditLog_accountId_createdAt_idx" ON "TgAgentAuditLog"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssistantChatMessage" ADD CONSTRAINT "AssistantChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CabinetUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgAutomationJob" ADD CONSTRAINT "TgAutomationJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgAutomationJob" ADD CONSTRAINT "TgAutomationJob_productAgentId_fkey" FOREIGN KEY ("productAgentId") REFERENCES "ProductAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAgentDialog" ADD CONSTRAINT "ProductAgentDialog_productAgentId_fkey" FOREIGN KEY ("productAgentId") REFERENCES "ProductAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAgentDialog" ADD CONSTRAINT "ProductAgentDialog_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "TgDialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgDialog" ADD CONSTRAINT "TgDialog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgAgentAllowedDialog" ADD CONSTRAINT "TgAgentAllowedDialog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgAgentAllowedDialog" ADD CONSTRAINT "TgAgentAllowedDialog_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "TgDialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgMessage" ADD CONSTRAINT "TgMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgMessage" ADD CONSTRAINT "TgMessage_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "TgDialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgSyncState" ADD CONSTRAINT "TgSyncState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgPendingSend" ADD CONSTRAINT "TgPendingSend_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgAgentAuditLog" ADD CONSTRAINT "TgAgentAuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
