import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api";

type Channel = {
  id: string;
  type: string;
  name: string;
  status: string;
};

export default function ChannelsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [name, setName] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["channels", token],
    queryFn: () =>
      apiFetch("/api/channels", { token }) as Promise<{ channels: Channel[] }>,
    enabled: !!token,
  });

  const addTg = useMutation({
    mutationFn: () =>
      apiFetch("/api/channels/telegram", {
        method: "POST",
        token,
        body: JSON.stringify({ botToken, name: name || undefined }),
      }),
    onSuccess: () => {
      setBotToken("");
      setName("");
      setFormErr(null);
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  return (
    <div className="space-y-8">
      <div className="glass-panel p-6">
        <h2 className="font-display text-xl font-semibold text-slate-100">
          Telegram
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Токен от @BotFather (хранится зашифрованно). После подключения бэкенд
          запускает long-polling: входящие из Telegram сохраняются и бот отвечает
          эхом (для проверки). Один процесс API — не запускайте второй с тем же
          токеном параллельно.
        </p>
        <form
          className="mt-6 max-w-lg space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            addTg.mutate();
          }}
        >
          {formErr && (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {formErr}
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Bot token
            </label>
            <input
              className="input-glass font-mono text-sm"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:ABC..."
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Название (необязательно)
            </label>
            <input
              className="input-glass"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="glass-btn"
            disabled={addTg.isPending || !botToken.trim()}
          >
            {addTg.isPending ? "Подключение…" : "Подключить Telegram"}
          </button>
        </form>
      </div>

      <div className="glass-panel p-6">
        <h3 className="font-display text-lg font-semibold text-slate-200">
          Другие каналы
        </h3>
        <ul className="mt-4 space-y-3">
          {["WhatsApp", "Email", "MAX"].map((label) => (
            <li
              key={label}
              className="flex items-center justify-between rounded-xl border border-white/5 bg-white/2 px-4 py-3 text-slate-400"
            >
              <span>{label}</span>
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5" /> скоро
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="glass-panel p-6">
        <h3 className="font-display text-lg font-semibold text-slate-200">
          Подключённые
        </h3>
        <ul className="mt-4 space-y-2">
          {data?.channels?.length === 0 && (
            <li className="text-slate-500">Пока нет каналов.</li>
          )}
          {data?.channels?.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3"
            >
              <span className="font-medium text-slate-200">{c.name}</span>
              <span className="text-xs uppercase text-cyan-300/90">{c.type}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
