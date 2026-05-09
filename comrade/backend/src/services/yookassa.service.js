/**
 * YooKassa REST API v3 — https://yookassa.ru/developers/api
 */
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";

function authHeader() {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secret) {
    throw new Error("YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY must be set");
  }
  const token = Buffer.from(`${shopId}:${secret}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * @param {{ amount: string, currency: string, description: string, returnUrl: string, metadata?: object }} p
 */
export async function createPayment(p) {
  const idempotenceKey = randomUUID();
  const body = {
    amount: { value: p.amount, currency: p.currency || "RUB" },
    confirmation: {
      type: "redirect",
      return_url: p.returnUrl,
    },
    capture: true,
    description: p.description,
    metadata: p.metadata || {},
  };

  const res = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
      "Idempotence-Key": idempotenceKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("yookassa createPayment failed", { status: res.status, data });
    throw new Error(data.description || `YooKassa HTTP ${res.status}`);
  }
  return data;
}

export async function getPayment(paymentId) {
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
  });
  return res.json();
}
