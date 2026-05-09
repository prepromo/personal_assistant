import { Router } from "express";
import type { AssistantChatMessage } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireCabinetUser } from "../middleware/cabinetAuth.js";
import { runChatCompletion, type ChatMsg } from "../lib/llm/chatCompletion.js";
import { respondSubscriptionRequired } from "../lib/cabinetPaidGate.js";

const r = Router();
r.use(requireCabinetUser);

const SYSTEM: ChatMsg = {
  role: "system",
  content:
    "Ты помощник в личном кабинете Telegram-интеграции. Отвечай кратко и по делу. Не придумывай факты о переписке пользователя, если их не передали.",
};

r.get("/chat/messages", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const take = Math.min(Number(req.query.limit) || 50, 100);
  const uid = u.id;
  const rows = await prisma.assistantChatMessage.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "desc" },
    take,
  });
  rows.reverse();
  res.json({
    items: rows.map((m: AssistantChatMessage) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

r.post("/chat/messages", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const text = String(req.body?.text || "").trim();
  if (!text || text.length > 16000) {
    res.status(400).json({ error: "text 1..16000" });
    return;
  }
  const uid = u.id;

  await prisma.assistantChatMessage.create({
    data: { userId: uid, role: "user", content: text },
  });

  const history = await prisma.assistantChatMessage.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  history.reverse();

  const msgs: ChatMsg[] = [
    SYSTEM,
    ...history.map((m: AssistantChatMessage) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  try {
    const { content, provider } = await runChatCompletion(msgs);
    const asst = await prisma.assistantChatMessage.create({
      data: { userId: uid, role: "assistant", content },
    });
    const tg = await prisma.tgAccount.findUnique({ where: { appUserId: u.appUserId } });
    if (tg) {
      await prisma.tgAgentAuditLog.create({
        data: {
          accountId: tg.id,
          actor: "user_ui",
          action: "cabinet_chat_assistant",
          resource: asst.id,
          metaJson: JSON.stringify({ provider, len: content.length }),
        },
      });
    }
    res.json({
      assistant: {
        id: asst.id,
        role: "assistant",
        content: asst.content,
        createdAt: asst.createdAt.toISOString(),
      },
      provider,
    });
  } catch (e) {
    res.status(503).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default r;
