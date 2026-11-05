import { renderHook, waitFor, act } from '@testing-library/react';
import { supabase } from '../src/__mocks__/supabase';
import { useAuth, readRoleHint, retryProfile, patchProfile } from '../src/lib/useAuth.js';
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

test('自己改名后 patchProfile：所有组件立即拿到新名字；角色不受影响，别人的 uid 不生效', async () => {
  const h = renderHook(() => useAuth());
  await waitFor(() => expect(h.result.current.profile?.id).toBe('u1'));
  act(() => { patchProfile('u2', { full_name: '别人' }); });
  expect(h.result.current.profile.full_name).toBe('一号(库)');
  act(() => { patchProfile('u1', { full_name: '新名字', role: 3 }); });
  expect(h.result.current.profile.full_name).toBe('新名字');
  expect(h.result.current.profile.role).toBe(1);
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

describe('角色未知 ≠ 学生：读不到 role 时绝不降级', () => {
  afterEach(() => { jest.useRealTimers(); });

  const M1 = { id: 'm1', email: 'm1@x.com', user_metadata: { role: 1 } };
  const M3 = { id: 'm3', email: 'm3@x.com', user_metadata: {} };
  const M4 = { id: 'm4', email: 'm4@x.com', user_metadata: { role: 1 } };
  const M5 = { id: 'm5', email: 'm5@x.com', user_metadata: {} };
  const N1 = { id: 'n1', email: 'n1@x.com', user_metadata: { role: 1 } };
  const mentorRow = (id, name) => ({ id, role: 2, full_name: name, default_workspace: 'e4', created_at: '2026-09-01' });

  const errorQuery = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }) }) }),
  });
  const emptyQuery = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  });

  test('后台刷新失败：已确认的导师角色保持不变，loading 不会再回到 true', async () => {
    supabase.__setTableData('profiles', [mentorRow('m1', '导师一')]);
    supabase.__setAuthState({ user: M1, session: { user: M1 } });
    const seen = [];
    const h = renderHook(() => { const a = useAuth(); seen.push(a.loading); return a; });
    await act(async () => { authCb('SIGNED_IN', { user: M1 }); });
    await waitFor(() => expect(h.result.current.profile?.role).toBe(2));
    seen.length = 0;   // 只看「已确认角色之后」的渲染

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
    const fromSpy = jest.spyOn(supabase, 'from').mockImplementation(errorQuery);
    await act(async () => { authCb('TOKEN_REFRESHED', { user: M1 }); });
    nowSpy.mockRestore();
    fromSpy.mockRestore();

    expect(h.result.current.profile.role).toBe(2);
    expect(h.result.current.loading).toBe(false);
    expect(seen.every((loading) => loading === false)).toBe(true);
  });

  test('后台刷新查不到行：已确认角色同样保持不变', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 300000);
    const fromSpy = jest.spyOn(supabase, 'from').mockImplementation(emptyQuery);
    await act(async () => { authCb('SIGNED_IN', { user: M1 }); });
    nowSpy.mockRestore();
    fromSpy.mockRestore();

    const h = renderHook(() => useAuth());
    expect(h.result.current.profile.role).toBe(2);
    expect(h.result.current.profileError).toBe(false);
  });

  test('退出后重新登录：立即进入 loading（profile 为空），随后拿到权威角色', async () => {
    await act(async () => { authCb('SIGNED_OUT', null); });
    supabase.__setTableData('profiles', [mentorRow('m3', '导师三')]);
    supabase.__setAuthState({ user: M3, session: { user: M3 } });
    const h = renderHook(() => useAuth());

    let resolveProfile;
    const fromSpy = jest.spyOn(supabase, 'from').mockImplementationOnce(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => new Promise((res) => { resolveProfile = res; }) }) }),
    }));
    act(() => { authCb('SIGNED_IN', { user: M3 }); });
    expect(h.result.current.loading).toBe(true);
    expect(h.result.current.profile).toBeNull();

    await act(async () => { resolveProfile({ data: mentorRow('m3', '导师三'), error: null }); });
    fromSpy.mockRestore();
    expect(h.result.current.profile.role).toBe(2);
    expect(h.result.current.loading).toBe(false);
  });

  test('user_metadata 写着 1、数据库是 2：任何时刻都不会出现学生角色', async () => {
    await act(async () => { authCb('SIGNED_OUT', null); });
    supabase.__setTableData('profiles', [mentorRow('m4', '导师四')]);
    supabase.__setAuthState({ user: M4, session: { user: M4 } });
    const seen = [];
    const h = renderHook(() => { const a = useAuth(); seen.push(a.profile ? a.profile.role : null); return a; });
    await act(async () => { authCb('SIGNED_IN', { user: M4 }); });
    await waitFor(() => expect(h.result.current.profile?.role).toBe(2));
    expect(seen).not.toContain(1);
  });

  test('新登录的每一次尝试都失败：profile 为空、profileError 为真，重试后恢复', async () => {
    await act(async () => { authCb('SIGNED_OUT', null); });
    supabase.__setTableData('profiles', [mentorRow('m5', '导师五')]);
    supabase.__setAuthState({ user: M5, session: { user: M5 } });
    jest.useFakeTimers();
    const fromSpy = jest.spyOn(supabase, 'from').mockImplementation(errorQuery);
    const h = renderHook(() => useAuth());

    await act(async () => {
      authCb('SIGNED_IN', { user: M5 });
      await jest.advanceTimersByTimeAsync(4200);
    });
    expect(h.result.current.profile).toBeNull();
    expect(h.result.current.profileError).toBe(true);
    expect(h.result.current.loading).toBe(false);

    fromSpy.mockRestore();
    await act(async () => {
      retryProfile();
      await jest.advanceTimersByTimeAsync(4200);
    });
    expect(h.result.current.profile.role).toBe(2);
    expect(h.result.current.profileError).toBe(false);
    expect(h.result.current.loading).toBe(false);
  });

  test('库里还没有这一行、本机也没有提示：仍按学生处理（新注册照常可用）', async () => {
    await act(async () => { authCb('SIGNED_OUT', null); });
    supabase.__setTableData('profiles', []);
    supabase.__setAuthState({ user: N1, session: { user: N1 } });
    const h = renderHook(() => useAuth());
    await act(async () => { authCb('SIGNED_IN', { user: N1 }); });
    await waitFor(() => expect(h.result.current.profile?.role).toBe(1), { timeout: 8000 });
    expect(h.result.current.profileError).toBe(false);
    expect(h.result.current.loading).toBe(false);
  });
});
