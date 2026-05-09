import type { RequestHandler } from "express";

/** MVP: статический токен AGENT_API_TOKEN в Authorization: Bearer */
export const requireAgentToken: RequestHandler = (req, res, next) => {
  const expected = process.env.AGENT_API_TOKEN;
  if (!expected) {
    res.status(500).json({ error: "AGENT_API_TOKEN не задан" });
    return;
  }
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token !== expected) {
    res.status(401).json({ error: "Неверный токен агента" });
    return;
  }
  next();
};
