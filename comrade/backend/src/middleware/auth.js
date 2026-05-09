import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const secret = () => process.env.JWT_SECRET || "dev-jwt-change-in-production";

export function signToken(userId) {
  return jwt.sign({ sub: userId }, secret(), { expiresIn: "7d" });
}

export async function authRequired(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(h.slice(7), secret());
    req.userId = payload.sub;
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  } catch (e) {
    if (e?.name === "JsonWebTokenError" || e?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    logger.error("authRequired", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}
