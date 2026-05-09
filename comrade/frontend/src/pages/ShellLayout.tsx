import {
  Inbox,
  LayoutDashboard,
  MessageSquare,
  CreditCard,
  LogOut,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const nav = [
  { to: "/", label: "Обзор", icon: LayoutDashboard, end: true },
  { to: "/inbox", label: "Входящие", icon: Inbox },
  { to: "/channels", label: "Каналы", icon: MessageSquare },
  { to: "/billing", label: "Оплата", icon: CreditCard },
];

export default function ShellLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen pb-12">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-linear-to-br from-cyan-400/20 to-violet-500/20 font-display text-lg font-bold text-cyan-200">
              C
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight text-slate-100">
                Comrade
              </h1>
              <p className="text-xs text-slate-500">единый инбокс</p>
            </div>
          </div>
          <div className="hidden items-center gap-1 md:flex">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-sm text-slate-400 sm:inline">
              {user?.email}
            </span>
            <button
              type="button"
              onClick={() => logout()}
              className="glass-btn-muted flex items-center gap-2 text-sm"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Выход</span>
            </button>
          </div>
        </div>
      </header>

      <nav className="mx-auto mt-4 flex max-w-6xl flex-wrap justify-center gap-2 px-4 md:hidden">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                isActive
                  ? "border border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                  : "border border-white/5 bg-white/5 text-slate-400"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto max-w-6xl px-4 pt-8">
        <Outlet />
      </main>
    </div>
  );
}
