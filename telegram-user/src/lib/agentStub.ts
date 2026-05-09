/**
 * Заглушка интеграции с агентом (OpenClaw / очередь). MVP: только лог.
 * TODO: вызвать gateway OPENCLAW_GATEWAY_URL с JOB kind=digest|task и appUserId.
 */
export function enqueueAgentJob(kind: string, appUserId: string, payload: unknown): void {
  const hasGateway = Boolean(process.env.OPENCLAW_GATEWAY_URL?.trim());
  console.log(
    `[agentStub] kind=${kind} appUserId=${appUserId} gateway=${hasGateway ? "configured" : "missing"}`,
    JSON.stringify(payload).slice(0, 500),
  );
}
