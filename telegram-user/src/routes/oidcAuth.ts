import { Router } from "express";
import { Issuer, generators } from "openid-client";
import { prisma } from "../lib/prisma.js";
import { signCabinetToken, COOKIE_NAME } from "../lib/cabinetJwt.js";
import { ensureCabinetSubscription } from "../lib/cabinetSubscription.js";

const r = Router();

const stateStore = new Map<string, { appUserId: string; nonce: string }>();

r.get("/oidc/start", async (req, res) => {
  const appUserId = String(req.query.appUserId || "").trim();
  if (!appUserId) {
    res.status(400).send("Нужен query appUserId (как в connector/.env)");
    return;
  }
  const issuerUrl = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (!issuerUrl || !clientId || !clientSecret || !redirectUri) {
    res.status(503).json({
      error: "OIDC не настроен: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI",
    });
    return;
  }
  const tg = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!tg) {
    res.status(400).json({
      error: "TgAccount не найден для appUserId. Сначала ensure-account и login.py.",
    });
    return;
  }
  try {
    const issuer = await Issuer.discover(issuerUrl);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ["code"],
    });
    const nonce = generators.nonce();
    const state = generators.state();
    stateStore.set(state, { appUserId, nonce });
    setTimeout(() => stateStore.delete(state), 600_000);
    const url = client.authorizationUrl({
      scope: "openid email profile",
      state,
      nonce,
    });
    res.redirect(url);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "OIDC discover failed" });
  }
});

r.get("/oidc/callback", async (req, res) => {
  const issuerUrl = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (!issuerUrl || !clientId || !clientSecret || !redirectUri) {
    res.status(503).send("OIDC не настроен");
    return;
  }
  const state = String(req.query.state || "");
  const entry = stateStore.get(state);
  if (!entry) {
    res.status(400).send("Неверный или просроченный state");
    return;
  }
  stateStore.delete(state);
  const appUserId = entry.appUserId;
  try {
    const issuer = await Issuer.discover(issuerUrl);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ["code"],
    });
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(redirectUri, params, { state, nonce: entry.nonce });
    const claims = tokenSet.claims();
    const sub = String(claims.sub || "");
    const email = String(claims.email || claims.preferred_username || "").toLowerCase();
    if (!sub || !email) {
      res.status(400).send("Нет sub/email в claims");
      return;
    }

    let user = await prisma.cabinetUser.findUnique({ where: { oidcSub: sub } });
    if (user) {
      user = await prisma.cabinetUser.update({
        where: { id: user.id },
        data: { email },
      });
    } else {
      const byEmail = await prisma.cabinetUser.findUnique({ where: { email } });
      if (byEmail) {
        if (byEmail.appUserId !== appUserId) {
          res.status(409).send("Этот email уже привязан к другому appUserId");
          return;
        }
        user = await prisma.cabinetUser.update({
          where: { id: byEmail.id },
          data: { oidcSub: sub },
        });
      } else {
        const byApp = await prisma.cabinetUser.findUnique({ where: { appUserId } });
        if (byApp) {
          res.status(409).send("Кабинет для этого appUserId уже есть — войдите паролем");
          return;
        }
        user = await prisma.cabinetUser.create({
          data: { email, appUserId, oidcSub: sub },
        });
      }
    }

    await ensureCabinetSubscription(user.id, user.appUserId);

    const token = await signCabinetToken({
      sub: user.id,
      email: user.email,
      appUserId: user.appUserId,
    });
    const secure = process.env.NODE_ENV === "production";
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    const loc = process.env.OIDC_SUCCESS_REDIRECT || "/cabinet.html";
    res.redirect(302, loc);
  } catch (e) {
    res.status(500).send(e instanceof Error ? e.message : "OIDC callback error");
  }
});

export default r;
