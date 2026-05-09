import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api";

type Msg = {
  id: string;
  body: string;
  direction: string;
  createdAt: string;
  channel: { id: string; type: string; name: string };
};

export default function InboxPage() {
  const { token } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["inbox", token],
    queryFn: () =>
      apiFetch("/api/inbox", { token }) as Promise<{ messages: Msg[] }>,
    enabled: !!token,
  });

  return (
    <div className="glass-panel p-6">
      <h2 className="font-display text-xl font-semibold text-slate-100">
        Входящие
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Сообщения появятся после подключения Telegram и webhook (следующий
        этап).
      </p>
      {isLoading && (
        <p className="mt-6 text-slate-500">Загрузка…</p>
      )}
      {!isLoading && data?.messages?.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-white/15 bg-white/2 px-4 py-8 text-center text-slate-500">
          Пока пусто. Добавьте канал Telegram и настройте получение сообщений.
        </p>
      )}
      <ul className="mt-6 space-y-3">
        {data?.messages?.map((m) => (
          <li
            key={m.id}
            className="rounded-xl border border-white/10 bg-white/3 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-slate-300">
                {m.channel.name}
              </span>
              <span>{m.direction}</span>
              <span>{new Date(m.createdAt).toLocaleString("ru-RU")}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-slate-200">{m.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
