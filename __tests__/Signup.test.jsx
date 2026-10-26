import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Signup from '../src/pages/Signup';
import { supabase } from '../src/__mocks__/supabase';

function renderAt(url = '/signup') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Signup />
    </MemoryRouter>
  );
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
function renderWithRoutes(url = '/signup') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

// 学生第 1、2 步
async function fillStudentSteps({ email = 'stu@school.edu', pw = 'secret12', name = '陈一舟', school = '明德高中' } = {}) {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^密码/), { target: { value: pw } });
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.change(await screen.findByLabelText('姓名'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/^学校/), { target: { value: school } });
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
}

const calls = (method) => supabase.__getCallHistory().filter((c) => c.method === method);

describe('Signup · student', () => {
  let signUpSpy;
  beforeEach(() => {
    supabase.__resetMocks();
    signUpSpy = null;
  });
  afterEach(() => signUpSpy?.mockRestore());

  it('does not show the teacher role switch or key field, and never queries other profiles', () => {
    renderAt();
    expect(screen.queryByText('老师注册密钥')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('老师注册密钥')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用导师注册' })).toHaveAttribute('href', '/signup?role=teacher');
    expect(calls('select')).toHaveLength(0);
  });

  it('validates the account step inline before moving on', async () => {
    renderAt();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText(/^密码/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findAllByText('请输入有效的邮箱地址')).not.toHaveLength(0);
    expect(screen.getAllByText('密码至少 6 位').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
  });

  it('signs up with name and a plain-text school, without any school lookup', async () => {
    renderAt();
    await fillStudentSteps();
    await waitFor(() => expect(calls('signUp')).toHaveLength(1));
    const { args } = calls('signUp')[0];
    expect(args.email).toBe('stu@school.edu');
    expect(args.options.data).toEqual({ full_name: '陈一舟', school_name: '明德高中' });
    expect(args.options.data.role).toBeUndefined();
    expect(calls('select')).toHaveLength(0);
    expect(calls('rpc')).toHaveLength(0);
  });

  it('skips the course step when signUp returns no session', async () => {
    renderAt();
    await fillStudentSteps();
    await waitFor(() => expect(calls('signUp')).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByText(/账号已创建/).length).toBeGreaterThan(0));
    expect(screen.queryByText('这学期在学哪些课？')).not.toBeInTheDocument();
    expect(calls('insert')).toHaveLength(0);
  });

  it('shows the course step when signUp returns a session and inserts courses', async () => {
    signUpSpy = jest.spyOn(supabase.auth, 'signUp').mockResolvedValue({
      data: { user: { id: 'new-user-1' }, session: { user: { id: 'new-user-1' } } },
      error: null,
    });
    supabase.__setTableData('profiles', [{ id: 'new-user-1', school_id: 'school-9' }]);
    renderAt();
    await fillStudentSteps();

    expect(await screen.findByText('这学期在学哪些课？')).toBeInTheDocument();

    // 手动输入 + 固定建议 + 校外切换
    fireEvent.change(screen.getByLabelText('课程名称'), { target: { value: 'AP 化学' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 数学' }));
    expect(screen.queryByRole('button', { name: '＋ 数学' })).not.toBeInTheDocument();
    const chemGroup = screen.getByRole('group', { name: 'AP 化学 课程类型' });
    fireEvent.click(within(chemGroup).getByRole('button', { name: '校外' }));

    fireEvent.click(screen.getByRole('button', { name: '完成，已添加 2 门' }));

    await waitFor(() => expect(calls('insert')).toHaveLength(1));
    const ins = calls('insert')[0];
    expect(ins.table).toBe('courses');
    expect(ins.args).toEqual([
      { name: 'AP 化学', subject: '', course_type: 2, school_id: 'school-9', created_by: 'new-user-1' },
      { name: '数学', subject: '', course_type: 1, school_id: 'school-9', created_by: 'new-user-1' },
    ]);
  });

  it('skipping the course step creates no courses', async () => {
    signUpSpy = jest.spyOn(supabase.auth, 'signUp').mockResolvedValue({
      data: { user: { id: 'new-user-2' }, session: { user: { id: 'new-user-2' } } },
      error: null,
    });
    renderAt();
    await fillStudentSteps();
    fireEvent.click(await screen.findByRole('button', { name: /跳过/ }));
    await waitFor(() => expect(screen.getAllByText('账号已创建').length).toBeGreaterThan(0));
    expect(calls('insert')).toHaveLength(0);
  });

  it('lands a new student on /today (not the old /learning or /syllabus) after the course step', async () => {
    signUpSpy = jest.spyOn(supabase.auth, 'signUp').mockResolvedValue({
      data: { user: { id: 'new-user-3' }, session: { user: { id: 'new-user-3' } } },
      error: null,
    });
    renderWithRoutes();
    await fillStudentSteps();
    fireEvent.click(await screen.findByRole('button', { name: /跳过/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/today');
  });

  it('shows the signUp error under the form and stays on step 2', async () => {
    signUpSpy = jest.spyOn(supabase.auth, 'signUp').mockResolvedValue({
      data: null, error: { message: 'User already registered' },
    });
    renderAt();
    await fillStudentSteps();
    expect((await screen.findAllByText('User already registered')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('姓名')).toBeInTheDocument();
  });
});

describe('Signup · teacher (/signup?role=teacher)', () => {
  beforeEach(() => supabase.__resetMocks());

  function fillTeacher(key = 'good-key') {
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李老师' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'li@school.edu' } });
    fireEvent.change(screen.getByLabelText(/^密码/), { target: { value: 'secret12' } });
    fireEvent.change(screen.getByLabelText('老师注册密钥'), { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: '创建导师账号' }));
  }

  it('verifies the key, signs up without role, then elevates via register_teacher', async () => {
    supabase.__setRpcDefault({ data: true, error: null });
    renderAt('/signup?role=teacher');
    fillTeacher();

    await waitFor(() => expect(calls('signOut')).toHaveLength(1));
    const rpcs = calls('rpc').map((c) => c.table);
    expect(rpcs).toEqual(['verify_teacher_key', 'register_teacher']);
    expect(calls('rpc')[0].args).toEqual({ key_text: 'good-key' });
    const { args } = calls('signUp')[0];
    expect(args.options.data.role).toBeUndefined();
    expect(args.options.data.school_name).toBe('');
    expect(calls('select')).toHaveLength(0);
  });

  it('does not sign up when the key check fails', async () => {
    supabase.__setRpcResponse('verify_teacher_key', { data: false, error: null });
    renderAt('/signup?role=teacher');
    fillTeacher('bad');
    expect((await screen.findAllByText('老师注册密钥错误')).length).toBeGreaterThan(0);
    expect(calls('signUp')).toHaveLength(0);
  });
});
