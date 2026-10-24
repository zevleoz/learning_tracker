import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../src/pages/Login';
import { supabase } from '../src/__mocks__/supabase';

describe('Login Component', () => {
  beforeEach(() => {
    supabase.__resetMocks();
  });

  it('should render login form', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('至少 6 位')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('should have login form that can be submitted', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const submitBtn = screen.getByRole('button', { name: '登录' });
    expect(submitBtn).toBeInTheDocument();
  });

  it('should show error for invalid credentials', async () => {
    supabase.__setTableData('profiles', [
      { id: 'student-1', email: 'student@example.com', role: 1, full_name: '学生' },
    ]);

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const emailInput = screen.getByPlaceholderText('your@email.com');
    const passwordInput = screen.getByPlaceholderText('至少 6 位');
    const submitBtn = screen.getByRole('button', { name: '登录' });

    fireEvent.change(emailInput, { target: { value: 'student@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Invalid password').length).toBeGreaterThan(0);
    });
  });

  it('should show error for non-existent email', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const emailInput = screen.getByPlaceholderText('your@email.com');
    const passwordInput = screen.getByPlaceholderText('至少 6 位');
    const submitBtn = screen.getByRole('button', { name: '登录' });

    fireEvent.change(emailInput, { target: { value: 'nonexistent@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Email not found').length).toBeGreaterThan(0);
    });
  });

  it('should log in student successfully', async () => {
    supabase.__setTableData('profiles', [
      { id: 'student-1', email: 'student@example.com', role: 1, full_name: '学生', school_name: '测试学校' },
    ]);

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const emailInput = screen.getByPlaceholderText('your@email.com');
    const passwordInput = screen.getByPlaceholderText('至少 6 位');
    const submitBtn = screen.getByRole('button', { name: '登录' });

    fireEvent.change(emailInput, { target: { value: 'student@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('登录成功')).toBeInTheDocument();
    });

    const calls = supabase.__getCallHistory();
    const signInCall = calls.find(c => c.method === 'signInWithPassword');
    expect(signInCall).toBeDefined();
    expect(signInCall.args.email).toBe('student@example.com');
  });

  it('should log in teacher successfully', async () => {
    supabase.__setTableData('profiles', [
      { id: 'teacher-1', email: 'teacher@example.com', role: 2, full_name: '老师', school_name: '' },
    ]);

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const emailInput = screen.getByPlaceholderText('your@email.com');
    const passwordInput = screen.getByPlaceholderText('至少 6 位');
    const submitBtn = screen.getByRole('button', { name: '登录' });

    fireEvent.change(emailInput, { target: { value: 'teacher@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('登录成功')).toBeInTheDocument();
    });

    const calls = supabase.__getCallHistory();
    const signInCall = calls.find(c => c.method === 'signInWithPassword');
    expect(signInCall).toBeDefined();
    expect(signInCall.args.email).toBe('teacher@example.com');
  });

  it('should show forgot password modal', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const forgotBtn = screen.getByRole('button', { name: '忘记密码？' });
    fireEvent.click(forgotBtn);

    expect(screen.getByText('重置密码')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('your@email.com').length).toBeGreaterThan(0);
  });

  it('should close forgot password modal', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    const forgotBtn = screen.getByRole('button', { name: '忘记密码？' });
    fireEvent.click(forgotBtn);

    const cancelBtn = screen.getByRole('button', { name: '取消' });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText('重置密码')).not.toBeInTheDocument();
  });

  it('shows inline field errors for empty submit', async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findAllByText('请填写邮箱')).not.toHaveLength(0);
    expect(screen.getAllByText('请填写密码').length).toBeGreaterThan(0);
    expect(supabase.__getCallHistory().find((c) => c.method === 'signInWithPassword')).toBeUndefined();
  });

  it('keeps the anti-enumeration message for bad credentials', async () => {
    const spy = jest.spyOn(supabase.auth, 'signInWithPassword')
      .mockResolvedValueOnce({ data: null, error: { message: 'Invalid login credentials' } });
    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByPlaceholderText('至少 6 位'), { target: { value: 'whatever1' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getAllByText('邮箱或密码错误').length).toBeGreaterThan(0));
    spy.mockRestore();
  });

  it('toggles password visibility', () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    const pw = screen.getByPlaceholderText('至少 6 位');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }));
    expect(pw).toHaveAttribute('type', 'password');
  });
});
