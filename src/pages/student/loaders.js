// 学生端各页的懒加载入口 + 空闲预取。routes.jsx 与 Layout.jsx 共用，避免两边各写一份路径。
export const loaders = {
  records: () => import('../Learning.jsx'),
  insights: () => import('./Insights.jsx'),
  me: () => import('./Me.jsx'),
  courses: () => import('../Syllabus.jsx'),
};

let prefetched = false;
/** 首屏渲染后在空闲时把其余学生页的代码拉进缓存（失败静默：真正点到时 React.lazy 会再试一次）。 */
export function prefetchStudentPages() {
  if (prefetched) return;
  prefetched = true;
  const run = () => Object.values(loaders).forEach((load) => { load().catch(() => {}); });
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 1500);
  }
}
