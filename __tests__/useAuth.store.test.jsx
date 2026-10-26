import { renderHook, waitFor, act } from '@testing-library/react';
import { supabase } from '../src/__mocks__/supabase';
import { useAuth, readRoleHint } from '../src/lib/useAuth.js';
import { put, peek } from '../src/lib/studentCache.js';

// 真实的 useAuth（不是 __mocks__ 版本）：登录态是整个应用共用的一份——
// getSession 与 profile 只取一次；换人 / 退出时上一个人的缓存立即清空。

let authCb = null;
jest.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb) => {
  authCb = cb;
  return { data: { subscription: { unsubscribe() {} } } };
});

const U1 = { id: 'u1', email: 'u1@x.com', user_metadata: { role: 1, full_name: '一号' } };
const U2 = { id: 'u2', email: 'u2@x.com', user_metadata: { role: 1, full_name: '二号' } };
const calls = (method, table) => supabase.__getCallHistory().filter((c) => c.method === method && (!table || c.table === table));

beforeAll(() => {
  localStorage.clear();
  supabase.__resetMocks();
  supabase.__setAuthState({ user: U1, session: { user: U1 } });
  supabase.__setTableData('profiles', [
    { id: 'u1', role: 1, full_name: '一号(库)', default_workspace: null, created_at: '2026-09-01' },
    { id: 'u2', role: 1, full_name: '二号(库)', default_workspace: null, created_at: '2026-09-02' },
  ]);
});

test('多个组件同时用 useAuth：getSession 与 profiles 各只查一次，大家拿到同一份', async () => {
  const a = renderHook(() => useAuth());
  const b = renderHook(() => useAuth());
  const c = renderHook(() => useAuth());
  expect(a.result.current.loading).toBe(true);
  await waitFor(() => expect(a.result.current.loading).toBe(false));
  expect(calls('getSession')).toHaveLength(1);
  expect(calls('select', 'profiles')).toHaveLength(1);
  for (const h of [a, b, c]) {
    expect(h.result.current.user.id).toBe('u1');
    expect(h.result.current.profile.full_name).toBe('一号(库)');   // 信任 profiles 表，不是 user_metadata
    expect(h.result.current.loading).toBe(false);
  }
});

test('刚取过 profile 又收到同一用户的认证事件（切回前台 / 刷新 token）：不再重复查', async () => {
  const before = calls('select', 'profiles').length;
  await act(async () => { authCb('TOKEN_REFRESHED', { user: U1 }); });
  await act(async () => { authCb('SIGNED_IN', { user: U1 }); });
  expect(calls('select', 'profiles')).toHaveLength(before);
});

test('确认过的角色记在本机（只用于冷启动先去哪个页面，不参与权限）', () => {
  expect(readRoleHint('u1')).toBe(1);
  expect(readRoleHint('u2')).toBeNull();   // 别人的提示不会被套用
});

test('换成另一个用户：上一个人的缓存立即清空，新用户的 profile 单独取', async () => {
  put('u1', 'student', { sessions: [{ id: 'secret' }] });
  const h = renderHook(() => useAuth());
  expect(peek('u1', 'student')).toBeDefined();

  supabase.__setAuthState({ user: U2, session: { user: U2 } });
  await act(async () => { authCb('SIGNED_IN', { user: U2 }); });

  expect(peek('u1', 'student')).toBeUndefined();
  await waitFor(() => expect(h.result.current.profile?.full_name).toBe('二号(库)'));
  expect(h.result.current.user.id).toBe('u2');
});

test('退出：用户 / profile 置空、不再 loading，缓存清空，角色提示清除', async () => {
  put('u2', 'student', { sessions: [{ id: 'secret2' }] });
  const h = renderHook(() => useAuth());
  await act(async () => { authCb('SIGNED_OUT', null); });
  expect(h.result.current.user).toBeNull();
  expect(h.result.current.profile).toBeNull();
  expect(h.result.current.loading).toBe(false);
  expect(peek('u2', 'student')).toBeUndefined();
  expect(readRoleHint('u2')).toBeNull();
});

test('主动 signOut()：不等认证事件，立刻清掉这个人的缓存', async () => {
  supabase.__setAuthState({ user: U1, session: { user: U1 } });
  await act(async () => { authCb('SIGNED_IN', { user: U1 }); });
  const h = renderHook(() => useAuth());
  await waitFor(() => expect(h.result.current.user?.id).toBe('u1'));
  put('u1', 'student', { sessions: [{ id: 'mine' }] });
  await act(async () => { await h.result.current.signOut(); });
  expect(peek('u1', 'student')).toBeUndefined();
});
