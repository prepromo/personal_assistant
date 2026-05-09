import type { RequestHandler } from "express";

export const requireConnectorSecret: RequestHandler = (req, res, next) => {
  const secret = process.env.CONNECTOR_SECRET;
  if (!secret) {
    res.status(500).json({ error: "CONNECTOR_SECRET не задан" });
    return;
  }
  const h = req.headers["x-connector-secret"];
  if (h !== secret) {
    res.status(401).json({ error: "Неверный X-Connector-Secret" });
    return;
  }
  next();
};
