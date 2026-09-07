import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Syllabus from '../src/pages/Syllabus';
import { supabase } from '../src/__mocks__/supabase';

describe('Syllabus Component', () => {
  beforeEach(() => {
    supabase.__resetMocks();
    supabase.__setAuthState({
      user: { id: 'test-user-1', email: 'test@example.com' },
      session: { user: { id: 'test-user-1', email: 'test@example.com' } },
    });
    supabase.__setTableData('profiles', [
      { id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户', school_name: '测试学校', school_id: 'school-1' },
    ]);
  });

  it('should render course list when logged in', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2024-01-01' },
      { id: 'course-2', name: '英语', subject: '', course_type: 2, school_id: 'school-1', created_by: 'other-user', deleted_at: null, created_at: '2024-01-02' },
    ]);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('数学')).toBeInTheDocument();
      expect(screen.getByText('英语')).toBeInTheDocument();
    });
  });

  it('should show add course modal', async () => {
    supabase.__setTableData('courses', []);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      const addBtn = screen.getByRole('button', { name: /添加新课程/i });
      fireEvent.click(addBtn);
    });

    expect(screen.getByText('添加新课程')).toBeInTheDocument();
    expect(screen.getByText('课程名称')).toBeInTheDocument();
  });

  it('should create course successfully', async () => {
    supabase.__setTableData('courses', []);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      const addBtn = screen.getByRole('button', { name: /添加新课程/i });
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('如：AP 微积分 BC');
      expect(nameInput).toBeInTheDocument();
      const submitBtn = screen.getByRole('button', { name: '创建课程' });

      fireEvent.change(nameInput, { target: { value: '物理' } });
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('物理')).toBeInTheDocument();
    });

    const calls = supabase.__getCallHistory();
    const insertCall = calls.find(c => c.method === 'insert' && c.table === 'courses');
    expect(insertCall).toBeDefined();
    expect(insertCall.args.name).toBe('物理');
    expect(insertCall.args.course_type).toBe(1);
  });

  it('should create external course', async () => {
    supabase.__setTableData('courses', []);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      const addBtn = screen.getByRole('button', { name: /添加新课程/i });
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('如：AP 微积分 BC');
      expect(nameInput).toBeInTheDocument();
      const submitBtn = screen.getByRole('button', { name: '创建课程' });

      fireEvent.change(nameInput, { target: { value: '钢琴课' } });
      fireEvent.click(screen.getByRole('button', { name: '校外课程' }));
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('钢琴课')).toBeInTheDocument();
    });

    const calls = supabase.__getCallHistory();
    const insertCall = calls.find(c => c.method === 'insert' && c.table === 'courses');
    expect(insertCall).toBeDefined();
    expect(insertCall.args.course_type).toBe(2);
  });

  it('should display course with no chapters', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2024-01-01', chapters: [] },
    ]);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('数学')).toBeInTheDocument();
      expect(screen.getByText('0 个章节')).toBeInTheDocument();
    });
  });

  it('should show empty state when no courses', async () => {
    supabase.__setTableData('courses', []);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('还没有任何课程')).toBeInTheDocument();
    });
  });

  it('should filter out deleted courses', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '活跃课程', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2024-01-01' },
      { id: 'course-2', name: '已删除课程', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', deleted_at: '2024-01-02', created_at: '2024-01-01' },
    ]);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('活跃课程')).toBeInTheDocument();
      expect(screen.queryByText('已删除课程')).not.toBeInTheDocument();
    });
  });

  it('should filter out deleted chapters and units', async () => {
    supabase.__setTableData('courses', [
      {
        id: 'course-1', name: '数学', subject: '', course_type: 1, school_id: 'school-1',
        created_by: 'test-user-1', deleted_at: null, created_at: '2024-01-01',
        chapters: [
          { id: 'ch-del', name: '已删除章节', order_idx: 1, deleted_at: '2024-01-02', units: [] },
          {
            id: 'ch-live', name: '活跃章节', order_idx: 2, deleted_at: null,
            units: [
              { id: 'u-del', name: '已删除单元', order_idx: 1, deleted_at: '2024-01-03' },
              { id: 'u-live', name: '活跃单元', order_idx: 2, deleted_at: null },
            ],
          },
        ],
      },
    ]);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('活跃章节')).toBeInTheDocument();
      expect(screen.getByText('活跃单元')).toBeInTheDocument();
    });
    expect(screen.queryByText('已删除章节')).not.toBeInTheDocument();
    expect(screen.queryByText('已删除单元')).not.toBeInTheDocument();
  });

  it('should delete course successfully with deleted_at set', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '待删除课程', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2024-01-01', chapters: [] },
    ]);
    supabase.__setTableData('chapters', []);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('待删除课程')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('删除课程'));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(screen.queryByText('待删除课程')).not.toBeInTheDocument();
    });

    const updateCall = supabase.__getCallHistory().find(c => c.method === 'update' && c.table === 'courses');
    expect(updateCall).toBeDefined();
    expect(updateCall.args.deleted_at).toBeTruthy();
  });

  it('should show error toast when delete affects 0 rows (RLS blocked)', async () => {
    supabase.__setTableData('courses', [
      { id: 'course-1', name: '无法删除的课程', subject: '', course_type: 1, school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2024-01-01', chapters: [] },
    ]);
    supabase.__setTableData('chapters', []);

    const toastEvents = [];
    const toastHandler = (e) => toastEvents.push(e.detail);
    window.addEventListener('gpa-toast', toastHandler);

    render(
      <MemoryRouter>
        <Syllabus />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('无法删除的课程')).toBeInTheDocument();
    });

    // 模拟 RLS 拦截：清空 mock 表使 update 匹配 0 行（返回成功但 data 为空）
    supabase.__setTableData('courses', []);

    fireEvent.click(screen.getByTitle('删除课程'));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(toastEvents.some(t => String(t.title).includes('删除未生效'))).toBe(true);
    });

    // 删除失败时课程不应从列表移除
    expect(screen.getByText('无法删除的课程')).toBeInTheDocument();

    window.removeEventListener('gpa-toast', toastHandler);
  });
});