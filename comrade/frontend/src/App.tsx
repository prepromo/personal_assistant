import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import BillingPage from "./pages/BillingPage";
import BillingReturnPage from "./pages/BillingReturnPage";
import ChannelsPage from "./pages/ChannelsPage";
import HomePage from "./pages/HomePage";
import InboxPage from "./pages/InboxPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ShellLayout from "./pages/ShellLayout";

function Protected({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Загрузка…
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <ShellLayout />
          </Protected>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="channels" element={<ChannelsPage />} />
        <Route path="billing" element={<BillingPage />} />
      </Route>
      <Route path="/billing/return" element={<BillingReturnPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
