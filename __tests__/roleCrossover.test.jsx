import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../src/components/ProtectedRoute.jsx';
import { supabase } from '../src/__mocks__/supabase';
import { rememberWorkspacePath } from '../src/lib/workspaceNav.js';

// 用真实 store + 真实 ProtectedRoute 验证「角色未知 ≠ 学生」。
// _mocks_/useAuth.js 是 moduleNameMapper 给 '../lib/useAuth.js' 的目标，这里把它换回真实实现。
jest.mock('../src/__mocks__/useAuth.js', () => jest.requireActual('../src/lib/useAuth.js'));

let authCb = null;
jest.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb) => {
  authCb = cb;
  return { data: { subscription: { unsubscribe() {} } } };
});

const ROLE_HINT_KEY = 'yb:role-hint';

function renderGuard({ minRole = 0, studentOnly = false, path = '/x' }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute minRole={minRole} studentOnly={studentOnly} />}>
          <Route path={path} element={<div>受保护内容</div>} />
        </Route>
        <Route path="/" element={<div>首页</div>} />
        <Route path="/login" element={<div>登录页</div>} />
        <Route path="/today" element={<div>学生今天</div>} />
        <Route path="/e4/students/9" element={<div>E4 学生页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const hangingQuery = () => ({
  select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }),
});
const failingQuery = () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }) }) }),
});

async function signOut() {
  supabase.__setAuthState({ user: null, session: null });
  await act(async () => { authCb('SIGNED_OUT', null); });
}

async function signIn(user) {
  supabase.__setAuthState({ user, session: { user } });
  await act(async () => { authCb('SIGNED_IN', { user }); });
}

beforeEach(() => {
  supabase.__resetMocks();
  localStorage.clear();
  sessionStorage.clear();
});

test('导师在 minRole=2 路由上后台刷新失败：页面保持挂载，不跳转', async () => {
  const mentor = { id: 'm1', email: 'm@x.com', user_metadata: {} };
  supabase.__setTableData('profiles', [{ id: 'm1', role: 2, full_name: '导师', default_workspace: 'e4' }]);
  supabase.__setAuthState({ user: mentor, session: { user: mentor } });

  renderGuard({ minRole: 2 });
  expect(await screen.findByText('受保护内容')).toBeInTheDocument();

  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
  const fromSpy = jest.spyOn(supabase, 'from').mockImplementationOnce(failingQuery);
  await act(async () => { authCb('TOKEN_REFRESHED', { user: mentor }); });
  nowSpy.mockRestore();
  fromSpy.mockRestore();

  expect(screen.getByText('受保护内容')).toBeInTheDocument();
  expect(screen.queryByText('首页')).toBeNull();
  expect(screen.queryByText('登录页')).toBeNull();
});

test('学生进导师路由：仍然回首页（学生照样被挡住）', async () => {
  const student = { id: 's1', email: 's@x.com', user_metadata: { role: 1 } };
  await signOut();
  supabase.__setTableData('profiles', [{ id: 's1', role: 1, full_name: '学生' }]);
  await signIn(student);

  renderGuard({ minRole: 2 });
  expect(await screen.findByText('首页')).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).toBeNull();
});

test('导师进学生路由：送回上次所在的工作区页面', async () => {
  const mentor = { id: 'm2', email: 'm2@x.com', user_metadata: {} };
  await signOut();
  supabase.__setTableData('profiles', [{ id: 'm2', role: 2, full_name: '导师', default_workspace: 'e4' }]);
  rememberWorkspacePath('e4', '/e4/students/9');
  await signIn(mentor);

  renderGuard({ studentOnly: true, path: '/today' });
  expect(await screen.findByText('E4 学生页')).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).toBeNull();
});

test('登录还在等 profile：导师路由显示加载态，不跳转、不渲染内容', async () => {
  const pending = { id: 'p1', email: 'p1@x.com', user_metadata: {} };
  await signOut();
  const fromSpy = jest.spyOn(supabase, 'from').mockImplementationOnce(hangingQuery);
  supabase.__setAuthState({ user: pending, session: { user: pending } });
  await act(async () => { authCb('SIGNED_IN', { user: pending }); });

  renderGuard({ minRole: 2 });
  expect(screen.getByText('加载中…')).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).toBeNull();
  expect(screen.queryByText('首页')).toBeNull();
  fromSpy.mockRestore();
});

test('本机记录是学生：profile 还在加载时学生页直接渲染（保留学生的冷启动速度）', async () => {
  const student = { id: 'h1', email: 'h1@x.com', user_metadata: {} };
  await signOut();
  localStorage.setItem(ROLE_HINT_KEY, JSON.stringify({ id: 'h1', role: 1 }));
  const fromSpy = jest.spyOn(supabase, 'from').mockImplementationOnce(hangingQuery);
  supabase.__setAuthState({ user: student, session: { user: student } });
  await act(async () => { authCb('SIGNED_IN', { user: student }); });

  renderGuard({ studentOnly: true });
  expect(screen.getByText('受保护内容')).toBeInTheDocument();
  fromSpy.mockRestore();
});

test('角色读不到（没有本机提示）：显示中性提示页，不显示导师内容', async () => {
  const unknown = { id: 'z1', email: 'z@x.com', user_metadata: {} };
  await signOut();
  const fromSpy = jest.spyOn(supabase, 'from').mockImplementation(failingQuery);
  supabase.__setAuthState({ user: unknown, session: { user: unknown } });
  await act(async () => { authCb('SIGNED_IN', { user: unknown }); });

  renderGuard({ minRole: 2 });
  expect(await screen.findByText('账号信息读取失败，请检查网络后重试', {}, { timeout: 8000 })).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).toBeNull();
  expect(screen.queryByText('首页')).toBeNull();
  fromSpy.mockRestore();
});

test('没有本机提示、profile 还在加载：学生路由只显示加载态，不先渲染学生外壳', async () => {
  const fresh = { id: 'n1', email: 'n1@x.com', user_metadata: {} };
  await signOut();
  const fromSpy = jest.spyOn(supabase, 'from').mockImplementationOnce(hangingQuery);
  supabase.__setAuthState({ user: fresh, session: { user: fresh } });
  await act(async () => { authCb('SIGNED_IN', { user: fresh }); });

  renderGuard({ studentOnly: true, path: '/records' });
  expect(screen.getByText('加载中…')).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).toBeNull();
  fromSpy.mockRestore();
});
