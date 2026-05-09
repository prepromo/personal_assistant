import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { COOKIE_NAME, verifyCabinetToken } from "../lib/cabinetJwt.js";

/** JWT из Cookie cabinet_token или Authorization: Bearer (тот же JWT) */
export const requireCabinetUser: RequestHandler = async (req, res, next) => {
  let token: string | null = null;
  const c = req.cookies?.[COOKIE_NAME];
  if (typeof c === "string" && c) token = c;
  if (!token) {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  }
  if (!token) {
    res.status(401).json({ error: "Требуется вход (cookie или Bearer)" });
    return;
  }
  const payload = await verifyCabinetToken(token);
  if (!payload) {
    res.status(401).json({ error: "Недействительный токен" });
    return;
  }
  const user = await prisma.cabinetUser.findUnique({ where: { id: payload.sub } });
  if (!user || user.appUserId !== payload.appUserId) {
    res.status(401).json({ error: "Пользователь не найден" });
    return;
  }
  req.cabinetUser = { id: user.id, email: user.email, appUserId: user.appUserId };
  next();
};
