import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import E4Layout from './components/E4Layout.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Syllabus from './pages/Syllabus.jsx';
import Learning from './pages/Learning.jsx';
import Review from './pages/Review.jsx';
import Mentor from './pages/Mentor.jsx';
import Notifications from './pages/Notifications.jsx';
import { useAuth } from './lib/useAuth.js';
import E4StudentListPage from './pages/e4/E4StudentListPage.jsx';
import E4TodosPage from './pages/e4/E4TodosPage.jsx';
import E4IntakePage from './pages/e4/E4IntakePage.jsx';
import E4StudentDetailPage from './pages/e4/E4StudentDetailPage.jsx';
import E4ReportBuilderPage from './pages/e4/E4ReportBuilderPage.jsx';
import E4PrepPage from './pages/e4/E4PrepPage.jsx';
import E4ProgressPage from './pages/e4/E4ProgressPage.jsx';
import E4PrintPreview from './pages/e4/E4PrintPreview.jsx';
import UpdatePrompt from './components/UpdatePrompt.jsx';
import { SurfaceTracker } from './lib/useAppUpdate.js';

// DebugTools 只在开发环境加载，避免生产 bundle 包含数据操作工具
const DebugTools = import.meta.env.DEV
  ? lazy(() => import('./pages/DebugTools.jsx'))
  : null;

const MOBILE_BREAKPOINT = 767;

// 登录后的根路由：
//   导师/管理员 → 按 default_workspace 偏好（即上次打开的工作区，默认 E4）；学生维持原有设备分流
function RootRedirect() {
  const { profile, loading } = useAuth();
  // profile 未加载完成前不要分流，否则导师会被误判为学生落到 /syllabus
  if (loading) return null;
  const role = Number(profile?.role) || 1;
  if (role >= 2) {
    // 导师只落两个工作区之一：一表人才（/mentor）或 E4，default_workspace 记录上次打开的页面
    return <Navigate to={profile?.default_workspace === 'tracker' ? '/mentor' : '/e4'} replace />;
  }
  const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
  return <Navigate to={isMobile ? '/learning' : '/syllabus'} replace />;
}

function DebugToolsFallback() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>加载中…</div>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SurfaceTracker />
      <UpdatePrompt />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/syllabus" element={<Syllabus />} />
            <Route path="/learning" element={<Learning />} />
            <Route path="/review" element={<Review />} />
            <Route path="/notifications" element={<Notifications />} />
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
        {/* 导师专属路由：需要 role >= 2 —— 一表人才导师台 */}
        <Route element={<ProtectedRoute minRole={2} />}>
          <Route element={<Layout />}>
            <Route path="/mentor" element={<Mentor />} />
          </Route>
        </Route>
        {/* E4 开发预览：Leo mock 数据，无需登录（仅 dev） */}
        {import.meta.env.DEV && (
          <Route path="/e4/print-preview" element={<E4PrintPreview />} />
        )}
        {/* E4 学习力导师平台（导师桌面布局） */}
        <Route element={<ProtectedRoute minRole={2} />}>
          <Route element={<E4Layout />}>
            <Route path="/e4" element={<E4TodosPage />} />
            <Route path="/e4/students" element={<E4StudentListPage />} />
            <Route path="/e4/new" element={<E4IntakePage />} />
            <Route path="/e4/students/:studentId" element={<E4StudentDetailPage />} />
            <Route path="/e4/students/:studentId/new-first" element={<E4ReportBuilderPage />} />
            <Route path="/e4/students/:studentId/new-prep" element={<E4PrepPage />} />
            <Route path="/e4/students/:studentId/new-progress" element={<E4ProgressPage />} />
            <Route path="/e4/reports/:reportId/build" element={<E4ReportBuilderPage />} />
            <Route path="/e4/prep/:reportId" element={<E4PrepPage />} />
            <Route path="/e4/progress/:reportId" element={<E4ProgressPage />} />
          </Route>
          {/* 打印预览为页内浮层（PrintPreviewModal），不再有独立路由 */}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
