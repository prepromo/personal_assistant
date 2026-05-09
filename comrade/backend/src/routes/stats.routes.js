import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { isBillingStub } from "../lib/billing.js";

const r = Router();
r.use(authRequired);

r.get("/", async (req, res) => {
  const [user, msgCount, chCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId } }),
    prisma.message.count({ where: { userId: req.userId } }),
    prisma.channel.count({ where: { userId: req.userId } }),
  ]);
  res.json({
    messagesTotal: msgCount,
    channelsTotal: chCount,
    trialRequestsUsed: user?.trialRequestsUsed ?? 0,
    trialLimit: user?.trialLimit ?? 2,
    subscriptionActive: user?.subscriptionActive ?? false,
    billingStub: isBillingStub(),
  });
});

export default r;
