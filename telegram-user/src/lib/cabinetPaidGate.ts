import type { Response } from "express";
import { getCabinetSubscription, subscriptionBlocksPaidFeatures } from "./cabinetSubscription.js";

/** true = ответ уже отправлен (402), дальше не обрабатывать. */
export async function respondSubscriptionRequired(
  res: Response,
  cabinetUserId: string,
  appUserId: string,
): Promise<boolean> {
  const sub = await getCabinetSubscription(cabinetUserId, appUserId);
  if (!subscriptionBlocksPaidFeatures(sub)) return false;
  res.status(402).json({
    error: "Нужна активная подписка: оплатите тариф на сайте (шаг 2), затем подключите личный Telegram в кабинете или в боте (шаг 3).",
    code: "subscription_required",
    subscription: {
      status: sub.status,
      planCode: sub.planCode,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    },
  });
  return true;
}
