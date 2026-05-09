import { prisma } from "../lib/prisma.js";
import { isBillingStub } from "../lib/billing.js";

/**
 * Blocks AI-heavy actions after trial exhausted unless subscriptionActive.
 * При BILLING_STUB (по умолчанию) — не блокируем и не списываем trial.
 */
export async function requireAiAccess(req, res, next) {
  if (isBillingStub()) {
    return next();
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.subscriptionActive) {
    return next();
  }

  if (user.trialRequestsUsed < user.trialLimit) {
    return next();
  }

  return res.status(402).json({
    error: "Trial ended",
    code: "PAYMENT_REQUIRED",
    message: "Subscribe via YooKassa to continue.",
  });
}

/** Consume one trial unit after successful AI operation */
export async function consumeTrialIfNeeded(userId) {
  if (isBillingStub()) return;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.subscriptionActive) return;
  if (user.trialRequestsUsed < user.trialLimit) {
    await prisma.user.update({
      where: { id: userId },
      data: { trialRequestsUsed: { increment: 1 } },
    });
  }
}
