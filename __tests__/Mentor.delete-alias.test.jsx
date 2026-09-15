import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Mentor from '../src/pages/Mentor';
import { supabase } from '../src/__mocks__/supabase';

// ───────────────────────────────────────────────────────────────
// Mentor desktop view — delete + alias features
// matchMedia is mocked to return matches:false (setupEnv.js),
// so the desktop split-layout always renders in jsdom.
// Student names appear in BOTH the left-panel list AND the right-panel
// grid, so we use getAllByText / getAllByRole throughout.
// ───────────────────────────────────────────────────────────────

function setupAdmin() {
  supabase.__setAuthState({
    user: { id: 'admin-1', email: 'admin@test.com' },
    session: { user: { id: 'admin-1', email: 'admin@test.com' } },
  });
  supabase.__setTableData('profiles', [
    { id: 'admin-1', role: 3, full_name: '管理员', school_name: '学校A' },
    { id: 'student-1', role: 1, full_name: '王小明', school_name: '学校A', created_at: '2024-01-01' },
    { id: 'student-2', role: 1, full_name: '李小华', school_name: '学校B', created_at: '2024-01-02' },
  ]);
  supabase.__setTableData('teacher_student_connections', [
    { id: 'c1', teacher_id: 'admin-1', student_id: 'student-1', status: 1, mentor_alias: null, note: '', created_at: '', updated_at: '' },
    { id: 'c2', teacher_id: 'admin-1', student_id: 'student-2', status: 1, mentor_alias: null, note: '', created_at: '', updated_at: '' },
  ]);
  supabase.__setTableData('learning_sessions', []);
}

function setupMentor() {
  supabase.__setAuthState({
    user: { id: 'mentor-1', email: 'mentor@test.com' },
    session: { user: { id: 'mentor-1', email: 'mentor@test.com' } },
  });
  supabase.__setTableData('profiles', [
    { id: 'mentor-1', role: 2, full_name: '老师', school_name: '学校A' },
    { id: 'student-1', role: 1, full_name: '王小明', school_name: '学校A', created_at: '2024-01-01' },
    { id: 'student-2', role: 1, full_name: '李小华', school_name: '学校B', created_at: '2024-01-02' },
  ]);
  supabase.__setTableData('teacher_student_connections', [
    { id: 'c1', teacher_id: 'mentor-1', student_id: 'student-1', status: 1, mentor_alias: null, note: '', created_at: '', updated_at: '' },
  ]);
  supabase.__setTableData('learning_sessions', []);
}

function setupAliasForStudent1(alias) {
  const tsc = supabase.__getTableData('teacher_student_connections');
  supabase.__setTableData('teacher_student_connections', tsc.map((c) =>
    c.student_id === 'student-1' ? { ...c, mentor_alias: alias } : c
  ));
}

function rpcCalls(name) {
  return supabase.__getCallHistory().filter((c) => c.method === 'rpc' && c.table === name);
}

async function waitForStudents() {
  await waitFor(() => {
    expect(screen.getAllByText('王小明').length).toBeGreaterThan(0);
  });
}

describe('Mentor desktop — delete + alias features', () => {
  beforeEach(() => {
    supabase.__resetMocks();
  });

  // ── Delete (admin only) ──────────────────────────────────

  it('shows delete button on each student card for admin', async () => {
    setupAdmin();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    // Admin sees all students; both cards get a 删除 button.
    const deleteBtns = screen.getAllByRole('button', { name: '删除' });
    expect(deleteBtns.length).toBe(2);
  });

  it('does NOT show delete button for non-admin mentor', async () => {
    setupMentor();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    // Mentor (role=2) has no 删除 button anywhere.
    expect(screen.queryAllByRole('button', { name: '删除' }).length).toBe(0);
  });

  it('clicking delete opens confirm dialog with student name + warning', async () => {
    setupAdmin();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    const deleteBtns = screen.getAllByRole('button', { name: '删除' });
    fireEvent.click(deleteBtns[0]);
    await waitFor(() => {
      expect(screen.getByText('永久删除学生')).toBeInTheDocument();
      // Warning text mentions "不可恢复" + "测试账号"
      expect(screen.getByText(/不可恢复/)).toBeInTheDocument();
      expect(screen.getByText(/测试账号/)).toBeInTheDocument();
    });
    // Confirm button label is "永久删除"
    expect(screen.getByRole('button', { name: '永久删除' })).toBeInTheDocument();
  });

  it('canceling delete does not call delete_student RPC', async () => {
    setupAdmin();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    const deleteBtns = screen.getAllByRole('button', { name: '删除' });
    fireEvent.click(deleteBtns[0]);
    const cancelBtn = await screen.findByRole('button', { name: '取消' });
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByText('永久删除学生')).not.toBeInTheDocument();
    });
    expect(rpcCalls('delete_student').length).toBe(0);
  });

  it('confirming delete calls delete_student RPC with the student id', async () => {
    setupAdmin();
    supabase.__setRpcResponse('delete_student', { data: 'student-1', error: null });
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    const deleteBtns = screen.getAllByRole('button', { name: '删除' });
    // Grid is sorted created_at desc → student-2 (Jan 2) is first, student-1 second.
    fireEvent.click(deleteBtns[1]);
    const confirmBtn = await screen.findByRole('button', { name: '永久删除' });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      const calls = rpcCalls('delete_student');
      expect(calls.length).toBe(1);
      expect(calls[0].args.p_student_id).toBe('student-1');
    });
  });

  // ── Alias ───────────────────────────────────────────────

  it('shows 别名 button on connected student cards (status=1)', async () => {
    setupAdmin();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    // Each connected student card has a 别名 button. Both students are status=1
    // for admin (auto-connect). But only the right-panel grid has these buttons,
    // so we should get 2 (one per student).
    const aliasBtns = screen.getAllByRole('button', { name: '备注名' });
    expect(aliasBtns.length).toBe(2);
  });

  it('clicking 备注名 opens inline editor with placeholder', async () => {
    setupAdmin();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    const aliasBtns = screen.getAllByRole('button', { name: '备注名' });
    fireEvent.click(aliasBtns[0]);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入备注名（留空清除）')).toBeInTheDocument();
    });
  });

  it('saving alias calls update_student_alias RPC with the typed value', async () => {
    setupAdmin();
    supabase.__setRpcResponse('update_student_alias', { data: null, error: null });
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    // student-1's card is second in the grid (created_at asc order in our test data,
    // but grid is sorted desc → student-2 first, student-1 second).
    const aliasBtns = screen.getAllByRole('button', { name: '备注名' });
    fireEvent.click(aliasBtns[1]);  // student-1's button
    const input = await screen.findByPlaceholderText('输入备注名（留空清除）');
    fireEvent.change(input, { target: { value: '隔壁小王' } });
    const saveBtn = screen.getByRole('button', { name: '保存' });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      const calls = rpcCalls('update_student_alias');
      expect(calls.length).toBe(1);
      expect(calls[0].args.p_alias).toBe('隔壁小王');
      expect(calls[0].args.p_student_id).toBe('student-1');
    });
  });

  it('shows alias as primary name + real name as subtitle when alias is set', async () => {
    setupAdmin();
    setupAliasForStudent1('隔壁小王');
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitFor(() => {
      // Primary name = alias (appears in left list + right card)
      expect(screen.getAllByText('隔壁小王').length).toBeGreaterThan(0);
      // Real name shown as subtitle "本名：王小明" (left list + right card)
      expect(screen.getAllByText('本名：王小明').length).toBeGreaterThan(0);
    });
    // "备注" indicator chip is rendered (only in right card grid)
    expect(screen.getAllByText('备注').length).toBeGreaterThan(0);
    // 备注名 button label changes to "改备注" when alias is set
    expect(screen.getByRole('button', { name: '改备注' })).toBeInTheDocument();
  });

  it('search input matches by alias when alias is set', async () => {
    setupAdmin();
    setupAliasForStudent1('隔壁小王');
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getAllByText('隔壁小王').length).toBeGreaterThan(0);
    });
    // Before search: 李小华 appears only in the right grid (left panel hidden
    // when no student is picked).
    expect(screen.getAllByText('李小华').length).toBe(1);
    const searchInput = screen.getByPlaceholderText('搜索学生…');
    fireEvent.change(searchInput, { target: { value: '隔壁' } });
    await waitFor(() => {
      // student-1 (alias=隔壁小王) still visible
      expect(screen.getAllByText('隔壁小王').length).toBeGreaterThan(0);
      // student-2 (no alias) filtered out entirely
      expect(screen.queryAllByText('李小华').length).toBe(0);
    });
  });

  it('search input still matches by real name when no alias', async () => {
    setupAdmin();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    // Before search: 李小华 only in right grid.
    expect(screen.getAllByText('李小华').length).toBe(1);
    const searchInput = screen.getByPlaceholderText('搜索学生…');
    fireEvent.change(searchInput, { target: { value: '王小' } });
    await waitFor(() => {
      // student-1 (王小明) still visible
      expect(screen.getAllByText('王小明').length).toBeGreaterThan(0);
      // student-2 (李小华) filtered out
      expect(screen.queryAllByText('李小华').length).toBe(0);
    });
  });

  it('escape key closes alias editor without calling RPC', async () => {
    setupAdmin();
    render(<MemoryRouter><Mentor /></MemoryRouter>);
    await waitForStudents();
    const aliasBtns = screen.getAllByRole('button', { name: '备注名' });
    fireEvent.click(aliasBtns[0]);
    const input = await screen.findByPlaceholderText('输入备注名（留空清除）');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('输入备注名（留空清除）')).not.toBeInTheDocument();
    });
    expect(rpcCalls('update_student_alias').length).toBe(0);
  });
});
