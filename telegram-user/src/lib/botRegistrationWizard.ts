import { prisma } from "./prisma.js";
import { addMonth } from "./cabinetSubscription.js";

const defaultTgPolicyJson = JSON.stringify({
  sendAllowed: false,
  markReadAllowed: true,
  replyMode: "manual",
  autoInGroups: false,
  agentScope: "allowlist",
});

/**
 * Создаёт/обновляет CabinetUser + TgAccount + активную подписку для текущего appUserId из привязки бота.
 * Оплата на сайте не требуется.
 */
export async function finalizeBotOnlyRegistration(telegramUserId: number): Promise<
  | { ok: true; appUserId: string; email: string; extendedExistingPeriod: boolean }
  | { ok: false; error: string }
> {
  const tid = String(telegramUserId);
  const binding = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!binding) {
    return { ok: false, error: "Нет привязки к аккаунту. Напишите /start." };
  }
  const { appUserId } = binding;
  const email = `tg_${tid}@telegram.cabinet`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.tgAccount.upsert({
        where: { appUserId },
        create: {
          appUserId,
          sessionEnc: Buffer.alloc(0),
          policyJson: defaultTgPolicyJson,
          status: "pending_auth",
        },
        update: {},
      });

      let cab = await tx.cabinetUser.findUnique({ where: { appUserId } });
      if (!cab) {
        const emailTaken = await tx.cabinetUser.findUnique({ where: { email } });
        const useEmail = emailTaken ? `tg_${tid}_${appUserId.replace(/[^a-zA-Z0-9]/g, "_")}@telegram.cabinet` : email;
        cab = await tx.cabinetUser.create({
          data: {
            email: useEmail,
            passwordHash: null,
            appUserId,
          },
        });
      }

      const periodEnd = addMonth(new Date());
      const existingSub = await tx.cabinetSubscription.findUnique({ where: { cabinetUserId: cab.id } });
      const extendedExistingPeriod = existingSub?.status === "active";
      await tx.cabinetSubscription.upsert({
        where: { cabinetUserId: cab.id },
        create: {
          cabinetUserId: cab.id,
          status: "active",
          planCode: "monthly_in_bot",
          currentPeriodEnd: periodEnd,
        },
        update: {
          status: "active",
          planCode: "monthly_in_bot",
          currentPeriodEnd: periodEnd,
        },
      });

      return { cab, extendedExistingPeriod };
    });

    return {
      ok: true,
      appUserId,
      email: result.cab.email,
      extendedExistingPeriod: result.extendedExistingPeriod,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Проверка: у пользователя уже есть активная подписка по привязке. */
export async function hasActiveInBotRegistration(telegramUserId: number): Promise<boolean> {
  const tid = String(telegramUserId);
  const binding = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!binding) return false;
  const cab = await prisma.cabinetUser.findUnique({ where: { appUserId: binding.appUserId } });
  if (!cab) return false;
  const sub = await prisma.cabinetSubscription.findUnique({ where: { cabinetUserId: cab.id } });
  return sub?.status === "active";
}
