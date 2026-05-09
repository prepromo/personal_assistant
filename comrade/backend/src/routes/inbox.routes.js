import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const r = Router();
r.use(authRequired);

r.get("/", async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      channel: { select: { id: true, type: true, name: true } },
    },
  });
  res.json({ messages });
});

r.post("/:id/reply", async (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: "body required" });

  const msg = await prisma.message.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!msg) return res.status(404).json({ error: "Message not found" });

  const reply = await prisma.message.create({
    data: {
      userId: req.userId,
      channelId: msg.channelId,
      direction: "outbound",
      body: String(body),
      meta: "{}",
    },
  });

  res.status(201).json({ message: reply });
});

export default r;
