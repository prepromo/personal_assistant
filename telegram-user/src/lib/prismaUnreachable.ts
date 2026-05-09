/** Ошибки Prisma при недоступном сервере (P1001 / init) — не спамить полным стеком каждые 4 с. */

export function isPrismaDbUnreachable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";
  return (
    name === "PrismaClientInitializationError" ||
    msg.includes("Can't reach database server") ||
    msg.includes("P1001")
  );
}

const lastLogByComponent = new Map<string, number>();
const THROTTLE_MS = 60_000;

export function logThrottledDbUnreachable(component: string): void {
  const now = Date.now();
  const prev = lastLogByComponent.get(component) ?? 0;
  if (now - prev < THROTTLE_MS) return;
  lastLogByComponent.set(component, now);
  console.warn(
    `${component}: PostgreSQL недоступен (см. DATABASE_URL, обычно 127.0.0.1:5433). Запустите Docker Desktop и в каталоге telegram-user: docker compose up -d postgres`,
  );
}
