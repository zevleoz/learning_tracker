import { Routes, Route } from 'react-router-dom';
import E4Layout from '../../components/E4Layout.jsx';
import E4StudentListPage from './E4StudentListPage.jsx';
import E4TodosPage from './E4TodosPage.jsx';
import E4IntakePage from './E4IntakePage.jsx';
import E4StudentDetailPage from './E4StudentDetailPage.jsx';
import E4ReportBuilderPage from './E4ReportBuilderPage.jsx';
import E4PrepPage from './E4PrepPage.jsx';
import E4ProgressPage from './E4ProgressPage.jsx';

// E4 工作区整体作为一个懒加载入口（App.jsx 以 /e4/* 挂载）：
// 学生端永远不会下载这些代码；导师第一次进 E4 只需要一个 chunk，没有「布局再等页面」的串行加载。
export default function E4App() {
  return (
    <Routes>
      <Route element={<E4Layout />}>
        <Route index element={<E4TodosPage />} />
        <Route path="students" element={<E4StudentListPage />} />
        <Route path="new" element={<E4IntakePage />} />
        <Route path="students/:studentId" element={<E4StudentDetailPage />} />
        <Route path="students/:studentId/new-first" element={<E4ReportBuilderPage />} />
        <Route path="students/:studentId/new-prep" element={<E4PrepPage />} />
        <Route path="students/:studentId/new-progress" element={<E4ProgressPage />} />
        <Route path="reports/:reportId/build" element={<E4ReportBuilderPage />} />
        <Route path="prep/:reportId" element={<E4PrepPage />} />
        <Route path="progress/:reportId" element={<E4ProgressPage />} />
      </Route>
    </Routes>
  );
}
