import { Route, Navigate } from 'react-router-dom';
import Syllabus from '../Syllabus.jsx';
import Learning from '../Learning.jsx';
import Today from './Today.jsx';
import Insights from './Insights.jsx';
import Me, { Reminders } from './Me.jsx';

// 学生端路由（挂在 Layout 之下）。单独成文件是因为 App.jsx 顶层用了 import.meta，
// Jest 无法直接加载；这里只含普通 import，测试可以直接渲染这组路由。
//
export function renderStudentRoutes() {
  return (
    <>
      <Route path="/today" element={<Today />} />
      <Route path="/records" element={<Learning />} />
      <Route path="/insights" element={<Insights />} />
      <Route path="/learning" element={<Learning />} />
      <Route path="/me" element={<Me />} />
      <Route path="/me/courses" element={<Syllabus defaultEditing={false} />} />
      <Route path="/me/reminders" element={<Reminders />} />
      {/* 旧路径 */}
      <Route path="/syllabus" element={<Navigate to="/me/courses" replace />} />
      <Route path="/notifications" element={<Navigate to="/me" replace />} />
      <Route path="/review" element={<Navigate to="/insights" replace />} />
    </>
  );
}
