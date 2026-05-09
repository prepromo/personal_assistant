import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { requireAiAccess, consumeTrialIfNeeded } from "../middleware/trial.js";
import { isOpenClawConfigured, probeGateway } from "../services/openclaw.service.js";

const r = Router();
r.use(authRequired);

r.get("/", async (_req, res) => {
  res.json({
    agents: [
      {
        id: "default",
        name: "OpenClaw (default)",
        model: process.env.OPENCLAW_MODEL || "configured in OpenClaw",
      },
    ],
  });
});

r.post("/", requireAiAccess, async (req, res) => {
  await consumeTrialIfNeeded(req.userId);
  const probe = await probeGateway();
  res.status(201).json({
    ok: true,
    openclaw: probe,
    openClawTokenSet: isOpenClawConfigured(),
    note:
      "Ответы в Telegram идут через OpenClaw POST /v1/chat/completions при OPENCLAW_GATEWAY_TOKEN.",
  });
});

export default r;
