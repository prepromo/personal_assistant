import { PrismaClient } from "../../node_modules/.prisma/client/index.js";

const _prisma = new PrismaClient();

/** Единый клиент БД (после `prisma generate`). */
export const prisma = _prisma;

/** Делегат ComradeTask — отдельный экспорт, чтобы IDE не теряла поле на `prisma`. */
export const dbComradeTask = _prisma.comradeTask;
