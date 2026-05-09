import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { createPayment } from "../services/yookassa.service.js";
import { logger } from "../lib/logger.js";
import { isBillingStub } from "../lib/billing.js";

const r = Router();

/** YooKassa webhook — при заглушке не используется */
r.post("/yookassa/webhook", async (req, res) => {
  if (isBillingStub()) {
    return res.status(200).send("OK");
  }
  const event = req.body;
  try {
    const obj = event?.object;
    if (obj?.status === "succeeded" && obj?.metadata?.userId) {
      await prisma.user.update({
        where: { id: obj.metadata.userId },
        data: { subscriptionActive: true },
      });
      await prisma.payment.updateMany({
        where: { yookassaPaymentId: obj.id },
        data: { status: "succeeded" },
      });
    }
    res.status(200).send("OK");
  } catch (e) {
    logger.error("yookassa webhook", e);
    res.status(500).send("ERR");
  }
});

r.post("/checkout", authRequired, async (req, res) => {
  if (isBillingStub()) {
    return res.json({
      stub: true,
      message: "Оплата отключена в MVP. Подписка не требуется.",
    });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "Not found" });

  const amount = process.env.YOOKASSA_AMOUNT || "299.00";
  const returnUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const payment = await createPayment({
    amount,
    currency: "RUB",
    description: "Comrade — подписка",
    returnUrl: `${returnUrl}/billing/return`,
    metadata: { userId: user.id, email: user.email },
  });

  await prisma.payment.create({
    data: {
      userId: user.id,
      amount,
      currency: "RUB",
      yookassaPaymentId: payment.id,
      status: "pending",
      description: "subscription",
    },
  });

  const confirmUrl = payment.confirmation?.confirmation_url;
  res.json({ paymentId: payment.id, confirmationUrl: confirmUrl });
});

export default r;
