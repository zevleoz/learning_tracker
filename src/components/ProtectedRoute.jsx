import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/useAuth.js';

/**
 * 路由保护：
 *   - 默认：检查是否登录
 *   - 传入 minRole：额外检查角色是否达标，不达标重定向到首页
 *
 * 用法：
 *   <ProtectedRoute />              // 只需登录
 *   <ProtectedRoute minRole={2} />   // 需要导师及以上
 */
export default function ProtectedRoute({ minRole = 0 }) {
  const { user, profile, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12 }}>
        <div style={{ width: 28, height: 28, border: '3px solid #e2e8f0', borderTopColor: '#4338ca', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <span style={{ fontSize: 13, color: '#94a3b8' }}>加载中…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  // 角色检查：profile.role 由数据库权威决定（不信任 user_metadata）
  if (minRole > 0) {
    const role = Number(profile?.role) || 1;
    if (role < minRole) {
      return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
}
