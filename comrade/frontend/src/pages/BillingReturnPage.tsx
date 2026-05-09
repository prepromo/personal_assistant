import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function BillingReturnPage() {
  const { refreshUser } = useAuth();

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-panel max-w-md p-8 text-center">
        <h1 className="font-display text-xl font-semibold text-slate-100">
          Возврат
        </h1>
        <p className="mt-4 text-slate-400">
          В режиме MVP оплата через ЮKassa отключена. Эта страница не используется,
          пока не включите реальную оплату.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link to="/billing" className="glass-btn inline-block text-center">
            К разделу «Оплата»
          </Link>
          <Link to="/" className="glass-btn-muted inline-block text-center">
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
