import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import { renderStudentRoutes } from './pages/student/routes.jsx';
import { renderMentorRoutes, renderE4Routes } from './pages/lazyRoutes.jsx';
import RouteFallback from './components/RouteFallback.jsx';
import { useAuth, readRoleHint } from './lib/useAuth.js';
import { lazyWithRetry } from './lib/lazyWithRetry.js';
import { SurfaceTracker } from './lib/useAppUpdate.js';

// 新版本提示横幅：用到 framer-motion（约 130 KB），不阻塞首屏，首屏渲染后再加载
const UpdatePrompt = lazyWithRetry(() => import('./components/UpdatePrompt.jsx'));

// DebugTools 只在开发环境加载，避免生产 bundle 包含数据操作工具
const DebugTools = import.meta.env.DEV
  ? lazy(() => import('./pages/DebugTools.jsx'))
  : null;
// E4 打印预览开发页同样只在开发环境加载
const E4PrintPreview = import.meta.env.DEV
  ? lazy(() => import('./pages/e4/E4PrintPreview.jsx'))
  : null;

// 登录后的根路由：
//   导师/管理员 → 按 default_workspace 偏好（即上次打开的工作区，默认 E4）；学生一律落到「今天」
function RootRedirect() {
  const { user, profile, loading } = useAuth();
  // profile 未加载完成前不要分流，否则导师会被误判为学生落到 /syllabus。
  // 例外：上次确认过这个账号是学生（本机提示，不参与权限判断），直接进「今天」，不等 profile 往返。
  if (loading) {
    if (user && readRoleHint(user.id) === 1) return <Navigate to="/today" replace />;
    return null;
  }
  const role = Number(profile?.role) || 1;
  if (role >= 2) {
    // 导师只落两个工作区之一：一表人才（/mentor）或 E4，default_workspace 记录上次打开的页面
    return <Navigate to={profile?.default_workspace === 'tracker' ? '/mentor' : '/e4'} replace />;
  }
  return <Navigate to="/today" replace />;
}

function DebugToolsFallback() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>加载中…</div>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SurfaceTracker />
      <Suspense fallback={null}>
        <UpdatePrompt />
      </Suspense>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<RootRedirect />} />
            {/* 学生端路由见 src/pages/student/routes.jsx */}
            {renderStudentRoutes()}
            {import.meta.env.DEV && DebugTools && (
              <Route
                path="/debug-tools"
                element={
                  <Suspense fallback={<DebugToolsFallback />}>
                    <DebugTools />
                  </Suspense>
                }
              />
            )}
          </Route>
        </Route>
        {/* 导师专属路由与 E4 工作区：懒加载，学生端不下载（见 pages/lazyRoutes.jsx） */}
        {renderMentorRoutes()}
        {/* E4 开发预览：Leo mock 数据，无需登录（仅 dev） */}
        {import.meta.env.DEV && E4PrintPreview && (
          <Route
            path="/e4/print-preview"
            element={
              <Suspense fallback={<RouteFallback />}>
                <E4PrintPreview />
              </Suspense>
            }
          />
        )}
        {renderE4Routes()}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
