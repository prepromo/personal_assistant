import type { Prisma } from "../../node_modules/.prisma/client/index.js";
import type { ComradeTask, ComradeTaskStatus } from "./prismaComradeTypes.js";
import { dbComradeTask } from "./prisma.js";

const INBOUND_TRACK_STATUSES: ComradeTaskStatus[] = [
  "WAITING_RESPONSE",
  "FOLLOWUP_DUE",
  "RESPONSE_RECEIVED",
  "FIRST_MESSAGE_PENDING",
];

export function comradeStatusesForInboundReport(): ComradeTaskStatus[] {
  return INBOUND_TRACK_STATUSES;
}

export async function findComradeTaskForInbound(dialogId: string): Promise<ComradeTask | null> {
  return dbComradeTask.findFirst({
    where: {
      linkedChatId: dialogId,
      status: { in: INBOUND_TRACK_STATUSES },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export type TaskDashboardBucket =
  | "active"
  | "waiting_reply"
  | "needs_action"
  | "overdue"
  | "done";

const TERMINAL: ComradeTaskStatus[] = ["CLOSED", "GOAL_ACHIEVED", "PAUSED"];
const DONE: ComradeTaskStatus[] = ["CLOSED", "GOAL_ACHIEVED"];

export function whereForDashboardBucket(
  appUserId: string,
  bucket: TaskDashboardBucket,
): Prisma.ComradeTaskWhereInput {
  const now = new Date();
  switch (bucket) {
    case "done":
      return { appUserId, status: { in: DONE } };
    case "overdue":
      return {
        appUserId,
        status: { notIn: TERMINAL },
        nextActionAt: { lt: now },
      };
    case "waiting_reply":
      return {
        appUserId,
        status: { in: ["WAITING_RESPONSE", "RESPONSE_RECEIVED"] },
      };
    case "needs_action":
      return {
        appUserId,
        status: { in: ["WAITING_CONFIRMATION", "FIRST_MESSAGE_PENDING", "CREATED", "FOLLOWUP_DUE"] },
      };
    case "active":
    default:
      return { appUserId, status: { notIn: TERMINAL } };
  }
}

export async function listComradeTasksForBucket(
  appUserId: string,
  bucket: TaskDashboardBucket,
  take = 15,
): Promise<ComradeTask[]> {
  return dbComradeTask.findMany({
    where: whereForDashboardBucket(appUserId, bucket),
    orderBy: { updatedAt: "desc" },
    take,
  });
}

export function formatTaskLine(t: ComradeTask): string {
  const st = t.status;
  const title = (t.title || "без названия").slice(0, 60);
  return `· [${st}] ${title}`;
}
