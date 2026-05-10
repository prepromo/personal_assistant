import { randomUUID } from "node:crypto";

const API = "https://api.yookassa.ru/v3";

function authHeader(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secret = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (!shopId || !secret) throw new Error("YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY должны быть заданы");
  const raw = Buffer.from(`${shopId}:${secret}`, "utf8").toString("base64");
  return `Basic ${raw}`;
}

export type YooCreatePaymentResult = {
  id: string;
  status: string;
  confirmationUrl: string | null;
};

export async function yookassaCreateRedirectPayment(opts: {
  amountRub: string;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
  idempotenceKey?: string;
}): Promise<YooCreatePaymentResult> {
  const idempotenceKey = opts.idempotenceKey ?? randomUUID();
  const res = await fetch(`${API}/payments`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      "Idempotence-Key": idempotenceKey,
    },
    body: JSON.stringify({
      amount: { value: opts.amountRub, currency: "RUB" },
      confirmation: { type: "redirect", return_url: opts.returnUrl },
      capture: true,
      description: opts.description,
      metadata: opts.metadata,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`YooKassa create payment ${res.status}: ${raw.slice(0, 500)}`);
  }
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("YooKassa: некорректный JSON ответ");
  }
  const id = String(j.id ?? "");
  const status = String(j.status ?? "");
  const conf = j.confirmation as Record<string, unknown> | undefined;
  const confirmationUrl = conf?.confirmation_url != null ? String(conf.confirmation_url) : null;
  return { id, status, confirmationUrl };
}

export async function yookassaGetPayment(paymentId: string): Promise<{
  id: string;
  status: string;
  paid: boolean;
  metadata: Record<string, string>;
}> {
  const res = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: authHeader() },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`YooKassa get payment ${res.status}: ${raw.slice(0, 500)}`);
  }
  const j = JSON.parse(raw) as Record<string, unknown>;
  const metaRaw = j.metadata;
  const metadata: Record<string, string> = {};
  if (metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw)) {
    for (const [k, v] of Object.entries(metaRaw as Record<string, unknown>)) {
      if (v != null) metadata[k] = String(v);
    }
  }
  const status = String(j.status ?? "");
  return {
    id: String(j.id ?? ""),
    status,
    paid: status === "succeeded",
    metadata,
  };
}

export function yookassaConfigured(): boolean {
  return Boolean(process.env.YOOKASSA_SHOP_ID?.trim() && process.env.YOOKASSA_SECRET_KEY?.trim());
}
