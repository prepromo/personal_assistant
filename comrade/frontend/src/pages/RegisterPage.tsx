import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function RegisterPage() {
  const { register, token } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setPending(true);
    try {
      await register(email, password, name || undefined);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка регистрации");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-panel w-full max-w-md p-8">
        <h1 className="font-display text-2xl font-semibold text-slate-100">
          Регистрация
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Сразу после регистрации вы войдёте в аккаунт.
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {err && (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {err}
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Имя (необязательно)
            </label>
            <input
              className="input-glass"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Email
            </label>
            <input
              className="input-glass"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Пароль
            </label>
            <input
              className="input-glass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="glass-btn w-full disabled:opacity-50"
          >
            {pending ? "Создание…" : "Создать аккаунт"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          Уже есть аккаунт?{" "}
          <Link to="/login" className="text-cyan-300 hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
