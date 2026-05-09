import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api";

type Stats = {
  messagesTotal: number;
  channelsTotal: number;
  trialRequestsUsed: number;
  trialLimit: number;
  subscriptionActive: boolean;
  billingStub?: boolean;
};

export default function HomePage() {
  const { token, user, refreshUser } = useAuth();
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["stats", token],
    queryFn: () => apiFetch("/api/stats", { token }) as Promise<Stats>,
    enabled: !!token,
  });

  const probe = useMutation({
    mutationFn: () =>
      apiFetch("/api/agents", {
        method: "POST",
        token,
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      refreshUser();
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const trialLeft =
    stats && !stats.subscriptionActive && stats.billingStub === false
      ? Math.max(0, stats.trialLimit - stats.trialRequestsUsed)
      : null;

  return (
    <div className="space-y-8">
      <div className="glass-panel p-8">
        <p className="text-sm font-medium uppercase tracking-wider text-cyan-300/80">
          Добро пожаловать
        </p>
        <h2 className="font-display mt-2 text-3xl font-semibold text-slate-50">
          {user?.name || user?.email}
        </h2>
        <p className="mt-2 max-w-xl text-slate-400">
          Подключите бота на «Каналы» и напишите ему в Telegram — сообщения
          попадут во «Входящие», бот ответит эхом. WhatsApp / Email / MAX —
          позже.
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs text-slate-500">Сообщения</p>
            <p className="font-display text-2xl text-slate-100">
              {stats?.messagesTotal ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs text-slate-500">Каналы</p>
            <p className="font-display text-2xl text-slate-100">
              {stats?.channelsTotal ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-4 py-3">
            <p className="text-xs text-violet-200/80">Оплата</p>
            <p className="font-display text-lg text-slate-100">
              {stats?.billingStub !== false
                ? "MVP (без оплаты)"
                : stats?.subscriptionActive
                  ? "Подписка"
                  : trialLeft !== null
                    ? `Пробный: ${trialLeft} запр.`
                    : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="glass-panel p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-display flex items-center gap-2 text-xl font-semibold text-slate-100">
              <Sparkles className="h-5 w-5 text-cyan-300" />
              AI (OpenClaw)
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              При отключённой оплате (MVP) лимиты не действуют. Для прод —
              включите ЮKassa и <code className="text-cyan-200">OPENCLAW_GATEWAY_URL</code>.
            </p>
          </div>
          <button
            type="button"
            className="glass-btn shrink-0"
            disabled={probe.isPending}
            onClick={() => probe.mutate()}
          >
            {probe.isPending ? "Запрос…" : "Проверить шлюз"}
          </button>
        </div>
        {probe.isError && (
          <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {(probe.error as Error).message}
          </p>
        )}
        {probe.isSuccess && probe.data != null && (
          <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-slate-300">
            {JSON.stringify(probe.data as object, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
