import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../src/pages/Login';
import { supabase } from '../src/__mocks__/supabase';

// 重置密码链接回到 /login 的几种情况
describe('Login 重置密码链接', () => {
  beforeEach(() => {
    supabase.__resetMocks();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/login');
  });

  function renderLogin() {
    return render(<MemoryRouter><Login /></MemoryRouter>);
  }

  it('链接失效（otp_expired）时明确提示并打开重新发送弹窗，而不是静默显示登录框', async () => {
    window.history.replaceState(null, '', '/login#error=access_denied&error_code=otp_expired&error_description=expired');
    renderLogin();
    expect((await screen.findAllByText(/重置链接已失效/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog', { name: '重置密码' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('有效的重置链接显示“设置新密码”表单', async () => {
    supabase.__setAuthState({ user: { id: 'u1', email: 'a@b.com' }, session: { user: { id: 'u1', email: 'a@b.com' } } });
    window.history.replaceState(null, '', '/login#access_token=t&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
    renderLogin();
    expect(await screen.findByText('设置新密码', { selector: 'h1' })).toBeInTheDocument();
  });

  it('刷新页面后（hash 已被清掉）仍停留在“设置新密码”表单', async () => {
    supabase.__setAuthState({ user: { id: 'u1', email: 'a@b.com' }, session: { user: { id: 'u1', email: 'a@b.com' } } });
    sessionStorage.setItem('ybrc-recovery-pending', String(Date.now()));
    renderLogin();
    expect(await screen.findByText('设置新密码', { selector: 'h1' })).toBeInTheDocument();
  });

  it('链接带 type=recovery 但拿不到 session 时提示失效', async () => {
    window.history.replaceState(null, '', '/login#access_token=t&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
    renderLogin();
    expect((await screen.findAllByText(/重置链接已失效/)).length).toBeGreaterThan(0);
  });

  it('新密码与旧密码相同时给中文提示', async () => {
    supabase.__setAuthState({ user: { id: 'u1', email: 'a@b.com' }, session: { user: { id: 'u1', email: 'a@b.com' } } });
    supabase.auth.updateUser = jest.fn(async () => ({ data: null, error: { status: 422, code: 'same_password', message: 'New password should be different from the old password.' } }));
    window.history.replaceState(null, '', '/login#access_token=t&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
    renderLogin();
    await screen.findByText('设置新密码', { selector: 'h1' });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'abcdef1' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'abcdef1' } });
    fireEvent.click(screen.getByRole('button', { name: '设置新密码' }));
    expect(await screen.findByText('新密码不能和旧密码相同，请换一个')).toBeInTheDocument();
  });

  it('设置成功后回到登录表单并预填邮箱', async () => {
    supabase.__setAuthState({ user: { id: 'u1', email: 'a@b.com' }, session: { user: { id: 'u1', email: 'a@b.com' } } });
    supabase.auth.updateUser = jest.fn(async () => ({ data: {}, error: null }));
    window.history.replaceState(null, '', '/login#access_token=t&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
    renderLogin();
    await screen.findByText('设置新密码', { selector: 'h1' });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'abcdef1' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'abcdef1' } });
    fireEvent.click(screen.getByRole('button', { name: '设置新密码' }));
    await waitFor(() => expect(screen.getByPlaceholderText('your@email.com')).toHaveValue('a@b.com'));
    expect(sessionStorage.getItem('ybrc-recovery-pending')).toBeNull();
  });
});
