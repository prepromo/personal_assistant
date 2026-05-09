/**
 * Удаляет TgAccount и связанные сущности по appUserId.
 * Запуск: npx tsx scripts/delete-account-by-app-user.ts <appUserId>
 * или APP_USER_ID в окружении.
 */
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const appUserId = (process.argv[2] || process.env.APP_USER_ID || "").trim();
  if (!appUserId) {
    console.error(
      "Укажите appUserId (без угловых скобок). Пример PowerShell:\n  npx tsx scripts/delete-account-by-app-user.ts user-8646293985",
    );
    process.exit(1);
  }

  const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!acc) {
    console.log(`TgAccount не найден: ${appUserId}`);
    await prisma.cabinetUser.deleteMany({ where: { appUserId } }).catch(() => {});
    await prisma.tgBotUserBinding.deleteMany({ where: { appUserId } });
    await prisma.task.deleteMany({ where: { appUserId } });
    await prisma.reminder.deleteMany({ where: { appUserId } });
    console.log("Очищены CabinetUser / TgBotUserBinding / Task / Reminder с этим appUserId (если были).");
    process.exit(0);
  }

  const accountId = acc.id;

  await prisma.$transaction(async (tx) => {
    const ping = await tx.workerPing.findUnique({ where: { id: "singleton" } });
    if (ping?.accountId === accountId) {
      await tx.workerPing.update({
        where: { id: "singleton" },
        data: { accountId: null },
      });
    }

    await tx.cabinetUser.deleteMany({ where: { appUserId } });
    await tx.tgBotUserBinding.deleteMany({ where: { appUserId } });
    await tx.task.deleteMany({ where: { appUserId } });
    await tx.reminder.deleteMany({ where: { appUserId } });

    await tx.tgAccount.delete({ where: { id: accountId } });
  });

  console.log(`Удалён TgAccount и данные для appUserId=${appUserId} (accountId=${accountId})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
