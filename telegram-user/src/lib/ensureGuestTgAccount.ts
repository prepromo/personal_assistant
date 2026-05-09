import { prisma } from "./prisma.js";

const defaultPolicyJson = JSON.stringify({
  sendAllowed: false,
  markReadAllowed: true,
  replyMode: "manual",
  autoInGroups: false,
  agentScope: "allowlist",
});

/** Гостевой аккаунт для Bot API (без MTProto), чтобы веб-кабинет и бот согласовывали appUserId. */
export async function ensureGuestTgAccount(appUserId: string): Promise<void> {
  if (!/^bot-\d+$/.test(appUserId)) return;
  await prisma.tgAccount.upsert({
    where: { appUserId },
    create: {
      appUserId,
      sessionEnc: Buffer.alloc(0),
      policyJson: defaultPolicyJson,
      status: "pending_auth",
    },
    update: {},
  });
}
