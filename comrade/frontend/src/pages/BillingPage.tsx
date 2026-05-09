import { useAuth } from "../auth/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

type Stats = { billingStub?: boolean };

export default function BillingPage() {
  const { token, user, refreshUser } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["stats", token],
    queryFn: () => apiFetch("/api/stats", { token }) as Promise<Stats>,
    enabled: !!token,
  });

  const stub = stats?.billingStub !== false;

  return (
    <div className="glass-panel max-w-2xl p-8">
      <h2 className="font-display text-2xl font-semibold text-slate-100">
        Оплата
      </h2>

      {stub ? (
        <>
          <p className="mt-2 text-slate-400">
            В текущем MVP оплата и ЮKassa отключены (
            <code className="text-cyan-200">BILLING_STUB</code> по умолчанию).
            Можно проверять Telegram-бота и инбокс без подписки.
          </p>
          <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-6">
            <p className="text-sm font-medium text-cyan-200">Режим разработки</p>
            <p className="mt-2 text-sm text-slate-400">
              Когда подключите реальную оплату, установите{" "}
              <code className="text-slate-300">BILLING_STUB=false</code> и ключи
              ЮKassa в <code className="text-slate-300">backend/.env</code>.
            </p>
          </div>
        </>
      ) : (
        <p className="mt-2 text-slate-400">
          ЮKassa включена. После оплаты подписка активируется через webhook.
        </p>
      )}

      <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-sm text-slate-400">Учётная запись</p>
        <p className="mt-2 font-display text-lg text-slate-50">{user?.email}</p>
        {!stub && (
          <p className="mt-2 text-sm text-slate-500">
            Подписка:{" "}
            {user?.subscriptionActive ? "активна" : "не оформлена"}
          </p>
        )}
      </div>

      <button
        type="button"
        className="mt-6 text-sm text-slate-500 underline hover:text-slate-300"
        onClick={() => refreshUser()}
      >
        Обновить профиль
      </button>
    </div>
  );
}
