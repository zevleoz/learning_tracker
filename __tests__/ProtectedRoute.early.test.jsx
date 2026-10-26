import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../src/components/ProtectedRoute.jsx';

// 冷启动省一次往返：只要求登录的路由在 session 确认后就放行，不等 profiles；
// 导师专属路由（minRole > 0）仍然等权威角色，绝不提前放行。

let mockAuth;
// ProtectedRoute 以 ../lib/useAuth.js 引用，jest 会把它映射到 __mocks__ 版本，所以替换的是那一份
jest.mock('../src/__mocks__/useAuth.js', () => ({ __esModule: true, useAuth: () => mockAuth }));

function renderAt(minRole) {
  return render(
    <MemoryRouter initialEntries={['/x']}>
      <Routes>
        <Route element={<ProtectedRoute minRole={minRole} />}>
          <Route path="/x" element={<div>受保护内容</div>} />
        </Route>
        <Route path="/login" element={<div>登录页</div>} />
        <Route path="/" element={<div>首页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

test('已有 session、profile 还在加载：普通路由直接放行', () => {
  mockAuth = { user: { id: 'u1' }, profile: null, loading: true };
  renderAt(0);
  expect(screen.getByText('受保护内容')).toBeInTheDocument();
});

test('已有 session、profile 还在加载：导师路由继续等待（不渲染内容、不跳转）', () => {
  mockAuth = { user: { id: 'u1' }, profile: { id: 'u1', role: 2 }, loading: true };
  renderAt(2);
  expect(screen.queryByText('受保护内容')).toBeNull();
  expect(screen.queryByText('首页')).toBeNull();
  expect(screen.getByText('加载中…')).toBeInTheDocument();
});

test('还不知道有没有 session：等待', () => {
  mockAuth = { user: null, profile: null, loading: true };
  renderAt(0);
  expect(screen.getByText('加载中…')).toBeInTheDocument();
});

test('确认没有登录：去登录页', () => {
  mockAuth = { user: null, profile: null, loading: false };
  renderAt(0);
  expect(screen.getByText('登录页')).toBeInTheDocument();
});

test('profile 加载完：学生进导师路由回首页，导师放行', () => {
  mockAuth = { user: { id: 'u1' }, profile: { id: 'u1', role: 1 }, loading: false };
  renderAt(2);
  expect(screen.getByText('首页')).toBeInTheDocument();
});
