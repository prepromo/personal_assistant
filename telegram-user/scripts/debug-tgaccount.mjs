// Run:
//   node --import tsx scripts/debug-tgaccount.mjs user-...
import { prisma } from "../src/lib/prisma.ts";

const appUserId = process.argv[2] || "user-5814732025";
const u = await prisma.tgAccount.findUnique({
  where: { appUserId },
  select: { id: true, status: true, lastError: true, sessionEnc: true, updatedAt: true },
});

console.log({
  appUserId,
  id: u?.id,
  status: u?.status,
  lastError: u?.lastError,
  sessionBytes: u?.sessionEnc?.length,
  updatedAt: u?.updatedAt,
});

await prisma.$disconnect();

