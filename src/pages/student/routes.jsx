import { Route, Navigate } from 'react-router-dom';
import Syllabus from '../Syllabus.jsx';
import Learning from '../Learning.jsx';
import Review from '../Review.jsx';
import Me, { Reminders } from './Me.jsx';

// 学生端路由（挂在 Layout 之下）。单独成文件是因为 App.jsx 顶层用了 import.meta，
// Jest 无法直接加载；这里只含普通 import，测试可以直接渲染这组路由。
//
// TODO(WS6)：Today.jsx / Insights.jsx 合并后在这里接入：
//   <Route path="/today" element={<Today />} />
//   <Route path="/insights" element={<Insights />} />
// 同时：
//   1) 把下面的 /review 改为 <Navigate to="/insights" replace />
//   2) 修改 App.jsx 的 RootRedirect，让学生落到 /today（所有设备）
// Layout 的「今天 / 洞察」两个 tab 已经指向 /today 和 /insights。
export function renderStudentRoutes() {
  return (
    <>
      <Route path="/records" element={<Learning />} />
      <Route path="/learning" element={<Learning />} />
      <Route path="/review" element={<Review />} />
      <Route path="/me" element={<Me />} />
      <Route path="/me/courses" element={<Syllabus defaultEditing={false} />} />
      <Route path="/me/reminders" element={<Reminders />} />
      {/* 旧路径 */}
      <Route path="/syllabus" element={<Navigate to="/me/courses" replace />} />
      <Route path="/notifications" element={<Navigate to="/me" replace />} />
    </>
  );
}
