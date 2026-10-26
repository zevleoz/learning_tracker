import { Suspense } from 'react';
import { Route, Navigate } from 'react-router-dom';
// 懒加载的页面各自 import 的样式也在这里提前引入，保持与拆包前完全一致的 CSS 顺序
// （同一份全局样式表，不会因为页面代码晚到而出现样式层叠顺序变化或首次切页闪样式）。
import '../../styles/student-me.css';
import '../../styles/student-logging.css';
import Today from './Today.jsx';
import { lazyWithRetry } from '../../lib/lazyWithRetry.js';
import { loaders } from './loaders.js';

// 学生端路由（挂在 Layout 之下）。单独成文件是因为 App.jsx 顶层用了 import.meta，
// Jest 无法直接加载；这里只含普通 import，测试可以直接渲染这组路由。
//
// 首屏只有「今天」随主包加载；其余页面按需拆包，首屏渲染后在空闲时预取（见 prefetchStudentPages），
// 点到时基本已在缓存里，不会多等一次网络往返。
const Learning = lazyWithRetry(loaders.records);
const Insights = lazyWithRetry(loaders.insights);
const Me = lazyWithRetry(loaders.me);
const Reminders = lazyWithRetry(() => loaders.me().then((m) => ({ default: m.Reminders })));
const Syllabus = lazyWithRetry(loaders.courses);

// 与各页「加载中」骨架一致，页面代码到达前不出现跳变
function PageSkeleton() {
  return (
    <div className="sh-page" aria-busy="true" aria-label="正在加载">
      <div className="sh-skel" /><div className="sh-skel" />
    </div>
  );
}
const page = (node) => <Suspense fallback={<PageSkeleton />}>{node}</Suspense>;

export function renderStudentRoutes() {
  return (
    <>
      <Route path="/today" element={<Today />} />
      <Route path="/records" element={page(<Learning />)} />
      <Route path="/insights" element={page(<Insights />)} />
      <Route path="/learning" element={page(<Learning />)} />
      <Route path="/me" element={page(<Me />)} />
      <Route path="/me/courses" element={page(<Syllabus defaultEditing={false} />)} />
      <Route path="/me/reminders" element={page(<Reminders />)} />
      {/* 旧路径 */}
      <Route path="/syllabus" element={<Navigate to="/me/courses" replace />} />
      <Route path="/notifications" element={<Navigate to="/me" replace />} />
      <Route path="/review" element={<Navigate to="/insights" replace />} />
    </>
  );
}
