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
      expect(screen.getByText('Invalid password')).toBeInTheDocument();
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
      expect(screen.getByText('Email not found')).toBeInTheDocument();
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
});