import type { CabinetSubscription } from "@prisma/client";
import { prisma } from "./prisma.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function addMonth(d: Date): Date {
  return new Date(d.getTime() + MONTH_MS);
}

/** Подписка нужна для работы с диалогами MTProto и LLM-чатом в кабинете. */
export function subscriptionBlocksPaidFeatures(sub: Pick<CabinetSubscription, "status">): boolean {
  return sub.status !== "active";
}

/**
 * Создаёт строку подписки при первом обращении.
 * Уже подключённый MTProto (active) до введения биллинга — получает active, чтобы не ломать прод.
 */
export async function ensureCabinetSubscription(
  cabinetUserId: string,
  appUserId: string,
): Promise<CabinetSubscription> {
  const existing = await prisma.cabinetSubscription.findUnique({ where: { cabinetUserId } });
  if (existing) return existing;
  const tg = await prisma.tgAccount.findUnique({ where: { appUserId } });
  const legacyPaid = tg?.status === "active";
  if (legacyPaid) {
    return prisma.cabinetSubscription.create({
      data: {
        cabinetUserId,
        status: "active",
        planCode: "monthly",
        currentPeriodEnd: addMonth(new Date()),
      },
    });
  }
  return prisma.cabinetSubscription.create({
    data: {
      cabinetUserId,
      status: "pending_payment",
      planCode: "monthly",
    },
  });
}

export async function getCabinetSubscription(
  cabinetUserId: string,
  appUserId: string,
): Promise<CabinetSubscription> {
  return ensureCabinetSubscription(cabinetUserId, appUserId);
}
