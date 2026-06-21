import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/useAuth.js';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-8 text-slate-400 text-sm">加载中…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}
