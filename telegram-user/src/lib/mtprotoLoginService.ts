import { prisma } from "./prisma.js";
import {
  disposeLoginWizardWorker,
  runLoginWizardAsync,
} from "./mtprotoLoginRunner.js";
import { getCabinetSubscription, subscriptionGrantsPaidFeatures } from "./cabinetSubscription.js";

const defaultTgPolicyJson = JSON.stringify({
  sendAllowed: false,
  markReadAllowed: true,
  replyMode: "manual",
  autoInGroups: false,
  agentScope: "allowlist",
});

function internalBaseUrl(): string {
  const u = process.env.API_INTERNAL_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  const port = Number(process.env.PORT) || 4050;
  return `http://127.0.0.1:${port}`;
}

async function internalPost(path: string, body: object): Promise<Response> {
  const secret = process.env.CONNECTOR_SECRET?.trim();
  if (!secret) throw new Error("CONNECTOR_SECRET не задан в окружении API");
  const base = internalBaseUrl();
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Connector-Secret": secret,
    },
    body: JSON.stringify(body),
  });
}

/** Один поток wizard на appUserId: не даём двум send_code/sign_in «перебить» phone_code_hash. */
const wizardQueues = new Map<string, Promise<unknown>>();

function chainWizard<T>(appUserId: string, fn: () => Promise<T>): Promise<T> {
  const prev = wizardQueues.get(appUserId) ?? Promise.resolve();
  const p = prev.catch(() => {}).then(fn);
  const tail = p.then(() => {}).catch(() => {});
  wizardQueues.set(appUserId, tail);
  void tail.finally(() => {
    if (wizardQueues.get(appUserId) === tail) wizardQueues.delete(appUserId);
  });
  return p;
}

export async function ensureTgAccountRow(appUserId: string): Promise<void> {
  await prisma.tgAccount.upsert({
    where: { appUserId },
    create: {
      appUserId,
      sessionEnc: Buffer.alloc(0),
      policyJson: defaultTgPolicyJson,
      status: "pending_auth",
    },
    update: {},
  });
}

export async function persistSessionAndLink(
  appUserId: string,
  sessionString: string,
  telegramUserId: number,
  opts?: { bindingTelegramUserId?: string },
): Promise<void> {
  const s1 = await internalPost("/internal/session", { appUserId, sessionString });
  if (!s1.ok) {
    const t = await s1.text();
    throw new Error(`session: ${s1.status} ${t}`);
  }
  const bind = opts?.bindingTelegramUserId?.trim();
  const s2 = await internalPost("/internal/link-telegram-user-to-account", {
    appUserId,
    telegramUserId: String(telegramUserId),
    ...(bind ? { bindingTelegramUserId: bind } : {}),
  });
  if (!s2.ok) {
    const t = await s2.text();
    throw new Error(`link: ${s2.status} ${t}`);
  }
}

export async function mtprotoSendCode(
  appUserId: string,
  phone: string,
  forceResend = false,
): Promise<void> {
  return chainWizard(appUserId, async () => {
    await ensureTgAccountRow(appUserId);
    const r = await internalPost("/internal/ensure-account", { appUserId });
    if (!r.ok) {
      const t = await r.text();
      await disposeLoginWizardWorker(appUserId);
      throw new Error(`ensure-account: ${r.status} ${t}`);
    }
    const out = await runLoginWizardAsync({
      cmd: "send_code",
      app_user_id: appUserId,
      phone,
      force_resend: forceResend,
    });
    if (out.ok !== true) {
      await disposeLoginWizardWorker(appUserId);
      throw new Error(String(out.error || "send_code_failed"));
    }
  });
}

export async function mtprotoSignIn(
  appUserId: string,
  code: string,
  opts?: { bindingTelegramUserId?: string },
): Promise<{ needPassword: boolean }> {
  return chainWizard(appUserId, async () => {
    const out = await runLoginWizardAsync({ cmd: "sign_in", app_user_id: appUserId, code });
    if (out.ok !== true) {
      await disposeLoginWizardWorker(appUserId);
      throw new Error(String(out.error || "sign_in_failed"));
    }
    if (out.need_password === true) {
      return { needPassword: true };
    }
    const sessionString = String(out.session_string || "");
    const tid = Number(out.telegram_user_id);
    if (!sessionString || !Number.isFinite(tid)) {
      await disposeLoginWizardWorker(appUserId);
      throw new Error("wizard_missing_session_or_id");
    }
    try {
      await persistSessionAndLink(appUserId, sessionString, tid, {
        bindingTelegramUserId: opts?.bindingTelegramUserId,
      });
    } finally {
      await disposeLoginWizardWorker(appUserId);
    }
    return { needPassword: false };
  });
}

export async function mtprotoPassword(
  appUserId: string,
  password: string,
  opts?: { bindingTelegramUserId?: string },
): Promise<void> {
  return chainWizard(appUserId, async () => {
    try {
      const out = await runLoginWizardAsync({ cmd: "password", app_user_id: appUserId, password });
      if (out.ok !== true) {
        throw new Error(String(out.error || "password_failed"));
      }
      const sessionString = String(out.session_string || "");
      const tid = Number(out.telegram_user_id);
      if (!sessionString || !Number.isFinite(tid)) {
        throw new Error("wizard_missing_session_or_id");
      }
      await persistSessionAndLink(appUserId, sessionString, tid, {
        bindingTelegramUserId: opts?.bindingTelegramUserId,
      });
    } finally {
      await disposeLoginWizardWorker(appUserId);
    }
  });
}

export async function subscriptionActiveForAppUserId(appUserId: string): Promise<boolean> {
  const cab = await prisma.cabinetUser.findUnique({ where: { appUserId } });
  if (!cab) return false;
  const sub = await getCabinetSubscription(cab.id, appUserId);
  return subscriptionGrantsPaidFeatures(sub);
}

export async function needsTelegramMtprotoLogin(appUserId: string): Promise<boolean> {
  const tg = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!tg) return true;
  if (tg.sessionEnc.length === 0) return true;
  return tg.status === "pending_auth";
}
