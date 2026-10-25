import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '../src/components/Layout.jsx';
import { renderStudentRoutes } from '../src/pages/student/routes.jsx';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

// Me.jsx 以 ../../lib/useAuth.js 引用，不在 moduleNameMapper 里；
// 统一指向 __mocks__ 版本，让所有引用者共享同一份登录态。
// App.jsx 顶层用了 import.meta，Jest 无法加载，所以这里直接渲染 renderStudentRoutes()。
jest.mock('../src/lib/useAuth.js', () => require('../src/__mocks__/useAuth.js'));
// push.js 里有 import.meta（Jest 不能加载），提醒页只需要这几个能力检测函数
jest.mock('../src/lib/push.js', () => ({
  __esModule: true,
  getPermission: () => 'default',
  isIOSNeedsInstall: () => false,
  isPushSupported: () => true,
  subscribe: jest.fn(async () => ({ ok: true })),
  unsubscribe: jest.fn(async () => ({ ok: true })),
  setAppBadge: jest.fn(async () => {}),
  hasDeviceSubscription: jest.fn(async () => false),
  sendTestNotification: jest.fn(async () => ({ ok: false, message: '' })),
  syncSubscription: jest.fn(async () => ({ ok: true })),
}));

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>{renderStudentRoutes()}</Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  supabase.__resetMocks();
  const user = { id: 'u1', email: 'yz@school.edu', user_metadata: { full_name: '陈一舟' } };
  supabase.__setAuthState({ user, session: { user } });
  setAuthUser(user);
  setAuthProfile({ id: 'u1', role: 1, full_name: '陈一舟' });
  supabase.__setTableData('profiles', [{ id: 'u1', role: 1, full_name: '陈一舟', school_name: '明德高中' }]);
  supabase.__setTableData('courses', []);
  supabase.__setTableData('teacher_student_connections', []);
  supabase.__setTableData('learning_sessions', []);
  supabase.__setTableData('user_learning_forms', []);
});

describe('学生端路由', () => {
  it('/me 渲染「我的」页', async () => {
    renderApp('/me');
    expect(await screen.findByRole('heading', { name: '陈一舟' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  });

  it('/notifications 重定向到 /me', async () => {
    renderApp('/notifications');
    expect(await screen.findByRole('heading', { name: '陈一舟' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '导师' })).toBeInTheDocument();
  });

  it('/records 和 /learning 都渲染记录页', async () => {
    const first = renderApp('/records');
    expect(await screen.findByRole('tab', { name: /待补填/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /全部/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /考试/ })).toBeInTheDocument();
    first.unmount();
    renderApp('/learning');
    expect(await screen.findByRole('tab', { name: /待补填/ })).toBeInTheDocument();
  });

  it('/me/courses 渲染课程树（阅读态，编辑在「编辑」之后）', async () => {
    supabase.__setTableData('courses', [
      { id: 'c1', name: '数学', course_type: 1, created_by: 'u1', deleted_at: null, created_at: '2026-01-01', chapters: [] },
    ]);
    renderApp('/me/courses');
    expect(await screen.findByRole('heading', { name: '我的课程' })).toBeInTheDocument();
    expect(await screen.findByText('数学')).toBeInTheDocument();
    expect(screen.queryByTitle('删除课程')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
  });

  it('/syllabus 重定向到 /me/courses', async () => {
    renderApp('/syllabus');
    expect(await screen.findByRole('heading', { name: '我的课程' })).toBeInTheDocument();
  });

  it('/today 渲染「今天」页', async () => {
    supabase.__setTableData('exam_scores', []);
    renderApp('/today');
    expect(await screen.findByRole('heading', { level: 1, name: /好，/ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /^待办/ })).toBeInTheDocument();
  });

  it('/insights 渲染「洞察」页，/review 重定向到 /insights', async () => {
    supabase.__setTableData('exam_scores', []);
    const first = renderApp('/insights');
    expect(await screen.findByRole('heading', { level: 1, name: '洞察' })).toBeInTheDocument();
    first.unmount();
    renderApp('/review');
    expect(await screen.findByRole('heading', { level: 1, name: '洞察' })).toBeInTheDocument();
  });

  it('/me/reminders 渲染提醒设置', async () => {
    renderApp('/me/reminders');
    expect(await screen.findByRole('heading', { name: '提醒' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('switch').length).toBe(4));
  });
});
