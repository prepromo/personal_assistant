import { prisma } from "./prisma.js";

export const MAX_PRODUCT_AGENTS = 5;

const LOG = "[productAgent]";

export async function countAgents(appUserId: string): Promise<number> {
  return prisma.productAgent.count({ where: { appUserId } });
}

export async function resolveProductAgentIdForDialog(
  accountId: string,
  dialogId: string,
): Promise<string | null> {
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) {
    console.info(`${LOG} resolve: no account`);
    return null;
  }
  const link = await prisma.productAgentDialog.findUnique({
    where: { dialogId },
    include: { productAgent: true },
  });
  if (link?.productAgent.enabled) {
    console.info(`${LOG} resolve: explicit agent=${link.productAgentId} dialog=${dialogId}`);
    return link.productAgentId;
  }
  const def = await prisma.productAgent.findFirst({
    where: { appUserId: acc.appUserId, isDefault: true, enabled: true },
    orderBy: { sortOrder: "asc" },
  });
  if (def) {
    console.info(`${LOG} resolve: default agent=${def.id}`);
    return def.id;
  }
  console.info(`${LOG} resolve: no ProductAgent, using base prompt`);
  return null;
}

export async function createProductAgent(
  appUserId: string,
  data: { name: string; promptExtras?: string; planJson?: string; isDefault?: boolean },
) {
  const n = await countAgents(appUserId);
  if (n >= MAX_PRODUCT_AGENTS) {
    throw new Error(`Максимум ${MAX_PRODUCT_AGENTS} агентов`);
  }
  const name = data.name.trim().slice(0, 120);
  if (!name) throw new Error("Имя агента обязательно");
  if (data.isDefault) {
    await prisma.productAgent.updateMany({
      where: { appUserId },
      data: { isDefault: false },
    });
  }
  return prisma.productAgent.create({
    data: {
      appUserId,
      name,
      sortOrder: n,
      promptExtras: (data.promptExtras ?? "").slice(0, 8000),
      planJson: data.planJson ?? "{}",
      isDefault: Boolean(data.isDefault),
    },
  });
}

export async function updateProductAgent(
  appUserId: string,
  id: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    promptExtras: string;
    planJson: string;
    isDefault: boolean;
    sortOrder: number;
  }>,
) {
  const cur = await prisma.productAgent.findFirst({ where: { id, appUserId } });
  if (!cur) throw new Error("Агент не найден");
  if (patch.isDefault) {
    await prisma.productAgent.updateMany({
      where: { appUserId },
      data: { isDefault: false },
    });
  }
  return prisma.productAgent.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 120) } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.promptExtras !== undefined ? { promptExtras: patch.promptExtras.slice(0, 8000) } : {}),
      ...(patch.planJson !== undefined ? { planJson: patch.planJson } : {}),
      ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    },
  });
}

export async function deleteProductAgent(appUserId: string, id: string) {
  const cur = await prisma.productAgent.findFirst({ where: { id, appUserId } });
  if (!cur) throw new Error("Агент не найден");
  await prisma.productAgent.delete({ where: { id } });
}

export async function setDialogAgent(
  appUserId: string,
  productAgentId: string,
  dialogId: string,
): Promise<void> {
  const agent = await prisma.productAgent.findFirst({ where: { id: productAgentId, appUserId } });
  if (!agent) throw new Error("Агент не найден");
  const dialog = await prisma.tgDialog.findUnique({
    where: { id: dialogId },
    include: { account: true },
  });
  if (!dialog || dialog.account.appUserId !== appUserId) {
    throw new Error("Диалог не принадлежит вашему аккаунту");
  }
  await prisma.$transaction(async (tx) => {
    await tx.productAgentDialog.deleteMany({ where: { dialogId } });
    await tx.productAgentDialog.create({
      data: { productAgentId, dialogId },
    });
  });
}

export async function clearDialogAgent(appUserId: string, dialogId: string): Promise<void> {
  const dialog = await prisma.tgDialog.findUnique({
    where: { id: dialogId },
    include: { account: true },
  });
  if (!dialog || dialog.account.appUserId !== appUserId) {
    throw new Error("Диалог не найден");
  }
  await prisma.productAgentDialog.deleteMany({ where: { dialogId } });
}
