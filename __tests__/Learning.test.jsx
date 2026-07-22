import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

describe('Learning Component', () => {
  beforeEach(() => {
    supabase.__resetMocks();
    supabase.__setAuthState({
      user: { id: 'test-user-1', email: 'test@example.com' },
      session: { user: { id: 'test-user-1', email: 'test@example.com' } },
    });
    setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
    setAuthProfile({ id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户', school_name: '测试学校' });
    supabase.__setTableData('profiles', [
      { id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户', school_name: '测试学校' },
    ]);
  });

  it('should render learning form with course selection', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('数学').length).toBeGreaterThan(0);
      const timeInputs = document.querySelectorAll('input[type="time"]');
      expect(timeInputs.length).toBe(2);
    });
  });

  it('should show validation errors for missing fields', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      const submitBtn = screen.getByRole('button', { name: '保存记录' });
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('请填写开始和结束时间')).toBeInTheDocument();
    });
  });

  it('should detect time conflict and prevent duplicate entries', async () => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', [
      { id: 'session-1', student_id: 'test-user-1', course_id: 'course-1', session_date: dateStr, start_time: '09:00:00', end_time: '10:00:00', deleted_at: null },
    ]);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      const courseSelect = selects[0];
      const formSelect = selects[3];
      const timeInputs = document.querySelectorAll('input[type="time"]');
      const submitBtn = screen.getByRole('button', { name: '保存记录' });

      fireEvent.change(courseSelect, { target: { value: 'course-1' } });
      fireEvent.change(timeInputs[0], { target: { value: '09:30' } });
      fireEvent.change(timeInputs[1], { target: { value: '10:30' } });
      fireEvent.change(formSelect, { target: { value: '自主预习' } });
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      const calls = supabase.__getCallHistory();
      const insertCall = calls.find(c => c.method === 'insert' && c.table === 'learning_sessions');
      expect(insertCall).toBeUndefined();
    });
  });

  it('should allow non-overlapping time entries', async () => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', [
      { id: 'session-1', student_id: 'test-user-1', course_id: 'course-1', session_date: dateStr, start_time: '09:00:00', end_time: '10:00:00', deleted_at: null },
    ]);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      const courseSelect = selects[0];
      const formSelect = selects[3];
      const timeInputs = document.querySelectorAll('input[type="time"]');
      const submitBtn = screen.getByRole('button', { name: '保存记录' });

      fireEvent.change(courseSelect, { target: { value: 'course-1' } });
      fireEvent.change(timeInputs[0], { target: { value: '10:00' } });
      fireEvent.change(timeInputs[1], { target: { value: '11:00' } });
      fireEvent.change(formSelect, { target: { value: '自主预习' } });
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      const calls = supabase.__getCallHistory();
      const insertCall = calls.find(c => c.method === 'insert' && c.table === 'learning_sessions');
      expect(insertCall).toBeDefined();
    });
  });

  it('should handle cross-midnight learning sessions', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      const courseSelect = selects[0];
      const formSelect = selects[3];
      const timeInputs = document.querySelectorAll('input[type="time"]');
      const submitBtn = screen.getByRole('button', { name: '保存记录' });

      fireEvent.change(courseSelect, { target: { value: 'course-1' } });
      fireEvent.change(timeInputs[0], { target: { value: '23:00' } });
      fireEvent.change(timeInputs[1], { target: { value: '01:00' } });
      fireEvent.change(formSelect, { target: { value: '自主预习' } });
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      const calls = supabase.__getCallHistory();
      const insertCall = calls.find(c => c.method === 'insert' && c.table === 'learning_sessions');
      expect(insertCall).toBeDefined();
      expect(insertCall.args.duration_minutes).toBe(120);
    });
  });

  it('should load recent learning sessions', async () => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', [
      { 
        id: 'session-1', 
        student_id: 'test-user-1', 
        course_id: 'course-1', 
        session_date: dateStr, 
        start_time: '09:00:00', 
        end_time: '10:00:00', 
        duration_minutes: 60,
        category: 1,
        form: '自主复习',
        eval_type: 1,
        self_rating: 80,
        deleted_at: null,
        course: { id: 'course-1', name: '数学', subject: '' },
      },
    ]);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('自主复习')).toBeInTheDocument();
      expect(screen.getByText('60分钟')).toBeInTheDocument();
    });
  });

  it('should add custom learning form', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      const formSelect = selects[3];
      fireEvent.change(formSelect, { target: { value: '__ADD_OTHER__' } });
    });

    await waitFor(() => {
      const customInputs = document.querySelectorAll('input[placeholder*="填写一个新的形式名称"]');
      expect(customInputs.length).toBeGreaterThan(0);
      const addBtns = screen.getAllByRole('button', { name: '添加' });
      const addBtn = addBtns[addBtns.length - 1];

      fireEvent.change(customInputs[0], { target: { value: '在线课程' } });
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      const calls = supabase.__getCallHistory();
      const insertCall = calls.find(c => c.method === 'insert' && c.table === 'user_learning_forms');
      expect(insertCall).toBeDefined();
      expect(insertCall.args.name).toBe('在线课程');
      expect(insertCall.args.student_id).toBe('test-user-1');
    });
  });

  it('should render with subjective evaluation by default', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', chapters: [] },
    ]);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);

    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('主观评估')).toBeInTheDocument();
    });
  });
});