import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, readRoleHint } from '../lib/useAuth.js';
import { lastWorkspacePath, rootWorkspace } from '../lib/workspaceNav.js';
import RoleLoadError from './RoleLoadError.jsx';

function Spinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12 }}>
      <div style={{ width: 28, height: 28, border: '3px solid #e2e8f0', borderTopColor: '#4338ca', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <span style={{ fontSize: 13, color: '#94a3b8' }}>加载中…</span>
    </div>
  );
}

/**
 * 路由保护：
 *   - 默认：检查是否登录
 *   - 传入 minRole：额外检查角色是否达标，不达标重定向到首页
 *   - 传入 studentOnly：导师/管理员不许进学生界面，送回上次所在的平台
 *
 * 用法：
 *   <ProtectedRoute />                    // 只需登录
 *   <ProtectedRoute minRole={2} />         // 需要导师及以上
 *   <ProtectedRoute studentOnly />         // 只给学生
 */
export default function ProtectedRoute({ minRole = 0, studentOnly = false }) {
  const { user, profile, loading } = useAuth();
  const loc = useLocation();

  // 只要求登录的路由（minRole = 0）：session 一确认就放行，不必等 profiles 查完——
  // 角色只影响导师专属页（minRole > 0 仍然等权威 profile），省掉冷启动里一次往返。
  if (loading && (minRole > 0 || !user)) {
    return <Spinner />;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  // 角色检查：profile.role 由数据库权威决定（不信任 user_metadata）
  if (minRole > 0) {
    // 角色未知时不跳走：只有确认角色不够才回首页
    if (!profile) return <RoleLoadError />;
    if ((Number(profile.role) || 1) < minRole) {
      return <Navigate to="/" replace />;
    }
  }
  if (studentOnly) {
    if (profile) {
      if (Number(profile.role) >= 2) {
        return <Navigate to={lastWorkspacePath(rootWorkspace(profile))} replace />;
      }
    } else {
      // 学生冷启动不等 profile（本机记录是学生就放行）；其余情况不显示学生外壳
      const hint = readRoleHint(user.id);
      if (hint !== 1) {
        // 角色未知（新设备 / 清过本机数据，没有提示）时也只等，不先渲染学生外壳：
        // 否则导师直接打开 /today 会先看到学生界面，还会跑学生端的推送同步、预取
        return loading ? <Spinner /> : <RoleLoadError />;
      }
    }
  }

  return <Outlet />;
}
