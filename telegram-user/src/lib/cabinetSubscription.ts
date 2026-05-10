import type { CabinetSubscription } from "@prisma/client";
import { prisma } from "./prisma.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function addMonth(d: Date): Date {
  return new Date(d.getTime() + MONTH_MS);
}

/** Доступ к MTProto / платным функциям кабинета (активная оплата или действующий триал). */
export function subscriptionGrantsPaidFeatures(sub: CabinetSubscription): boolean {
  const now = new Date();
  if (sub.status === "trialing") {
    return !!(sub.trialEndsAt && sub.trialEndsAt > now);
  }
  if (sub.status === "active") {
    if (sub.currentPeriodEnd && sub.currentPeriodEnd <= now) return false;
    return true;
  }
  return false;
}

export function subscriptionBlocksPaidFeatures(sub: CabinetSubscription): boolean {
  return !subscriptionGrantsPaidFeatures(sub);
}

/**
 * После истечения триала или оплаченного периода — сброс в pending_payment (ленивая миграция при запросах).
 */
async function expireSubscriptionIfStale(sub: CabinetSubscription): Promise<CabinetSubscription> {
  const now = new Date();
  if (sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt <= now) {
    return prisma.cabinetSubscription.update({
      where: { id: sub.id },
      data: { status: "pending_payment", trialEndsAt: null },
    });
  }
  if (sub.status === "active" && sub.currentPeriodEnd && sub.currentPeriodEnd <= now) {
    return prisma.cabinetSubscription.update({
      where: { id: sub.id },
      data: { status: "pending_payment", currentPeriodEnd: null },
    });
  }
  return sub;
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
  if (existing) return expireSubscriptionIfStale(existing);
  const tg = await prisma.tgAccount.findUnique({ where: { appUserId } });
  const legacyPaid = tg?.status === "active";
  if (legacyPaid) {
    const created = await prisma.cabinetSubscription.create({
      data: {
        cabinetUserId,
        status: "active",
        planCode: "monthly",
        currentPeriodEnd: addMonth(new Date()),
      },
    });
    return created;
  }
  const created = await prisma.cabinetSubscription.create({
    data: {
      cabinetUserId,
      status: "pending_payment",
      planCode: "monthly",
    },
  });
  return created;
}

export async function getCabinetSubscription(
  cabinetUserId: string,
  appUserId: string,
): Promise<CabinetSubscription> {
  const sub = await ensureCabinetSubscription(cabinetUserId, appUserId);
  return expireSubscriptionIfStale(sub);
}
