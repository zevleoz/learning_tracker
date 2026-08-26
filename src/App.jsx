import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Syllabus from './pages/Syllabus.jsx';
import Learning from './pages/Learning.jsx';
import Review from './pages/Review.jsx';
import Mentor from './pages/Mentor.jsx';
import Notifications from './pages/Notifications.jsx';

// DebugTools 只在开发环境加载，避免生产 bundle 包含数据操作工具
const DebugTools = import.meta.env.DEV
  ? lazy(() => import('./pages/DebugTools.jsx'))
  : null;

const MOBILE_BREAKPOINT = 767;

function ResponsiveRedirect() {
  const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
  return <Navigate to={isMobile ? '/learning' : '/syllabus'} replace />;
}

function DebugToolsFallback() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>加载中…</div>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<ResponsiveRedirect />} />
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
        {/* 导师专属路由：需要 role >= 2 */}
        <Route element={<ProtectedRoute minRole={2} />}>
          <Route element={<Layout />}>
            <Route path="/mentor" element={<Mentor />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
