import { Suspense } from 'react';
import { Route } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import ProtectedRoute from '../components/ProtectedRoute.jsx';
import RouteFallback from '../components/RouteFallback.jsx';
import { lazyWithRetry } from '../lib/lazyWithRetry.js';

// 导师台与 E4 只有导师会用到：学生端首屏不下载这些代码。
// 单独成文件是因为 App.jsx 顶层用了 import.meta，Jest 无法直接加载；测试直接渲染这里的路由。
export const LazyMentor = lazyWithRetry(() => import('./Mentor.jsx'));
export const LazyE4App = lazyWithRetry(() => import('./e4/E4App.jsx'));

const quiet = (node) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>;

/** 导师专属：需要 role >= 2 —— 一表人才导师台（挂在学生外壳 Layout 之下，Layout 对 /mentor 只渲染 Outlet）。 */
export function renderMentorRoutes() {
  return (
    <Route element={<ProtectedRoute minRole={2} />}>
      <Route element={<Layout />}>
        <Route path="/mentor" element={quiet(<LazyMentor />)} />
      </Route>
    </Route>
  );
}

/** E4 学习力导师平台（导师桌面布局）：/e4/* 整体作为一个懒加载入口，内部子路由见 e4/E4App.jsx。 */
export function renderE4Routes() {
  return (
    <Route element={<ProtectedRoute minRole={2} />}>
      <Route path="/e4/*" element={quiet(<LazyE4App />)} />
    </Route>
  );
}
