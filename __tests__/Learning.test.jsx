import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

// 公共 fixture：Learning.jsx 的课程查询带 .is('deleted_at', null)，
// 行数据必须显式带 deleted_at: null 才能通过 mock 的过滤
const COURSE_ROW = {
  id: 'course-1', name: '数学', subject: '', course_type: 1,
  school_id: 'school-1', created_by: 'test-user-1',
  deleted_at: null, chapters: [],
};

function seedBase() {
  supabase.__setTableData('courses', [COURSE_ROW]);
  supabase.__setTableData('learning_sessions', []);
  supabase.__setTableData('user_learning_forms', []);
}

function todayStr() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function renderLearning() {
  return render(
    <MemoryRouter>
      <Learning />
    </MemoryRouter>
  );
}

// 等待表单就绪（课程加载完成，提交按钮出现）
async function waitForForm() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '保存记录' })).toBeInTheDocument();
  });
}

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
    seedBase();
    renderLearning();
    await waitForForm();

    // 课程已进入组件：不出现空态，快速记录按钮与课程下拉都包含「数学」
    expect(screen.queryByText('还没有课程')).not.toBeInTheDocument();
    expect(screen.getAllByText('数学').length).toBeGreaterThan(0);

    // 三级下拉：课程 / 章节 / 单元 + 学习行为形式，共 4 个 select
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(4);
    // 加载完成后自动选中第一个课程
    expect(selects[0].value).toBe('course-1');

    // 时间区：1 个日期 + 2 个时间输入
    expect(document.querySelectorAll('input[type="date"]').length).toBe(1);
    expect(document.querySelectorAll('input[type="time"]').length).toBe(2);
  });

  it('should show validation errors for missing fields', async () => {
    seedBase();
    renderLearning();
    await waitForForm();

    // 直接提交：结束时间为空、学习行为形式未选
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));

    await waitFor(() => {
      expect(screen.getByText('请填写开始和结束时间')).toBeInTheDocument();
      expect(screen.getByText('请选择学习行为形式')).toBeInTheDocument();
    });
    // 校验失败不应写库
    const calls = supabase.__getCallHistory();
    expect(calls.find(c => c.method === 'insert' && c.table === 'learning_sessions')).toBeUndefined();
  });

  it('should detect time conflict and prevent duplicate entries', async () => {
    const dateStr = todayStr();
    supabase.__setTableData('courses', [COURSE_ROW]);
    supabase.__setTableData('learning_sessions', [
      { id: 'session-1', student_id: 'test-user-1', course_id: 'course-1', session_date: dateStr, start_time: '09:00:00', end_time: '10:00:00', deleted_at: null },
    ]);
    supabase.__setTableData('user_learning_forms', []);

    renderLearning();
    await waitForForm();

    // 新记录 09:30-10:30 与已有 09:00-10:00 重叠
    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: '09:30' } });
    fireEvent.change(timeInputs[1], { target: { value: '10:30' } });
    fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: '自主预习' } });
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));

    await waitFor(() => {
      expect(screen.getByText(/该时间段已有学习记录/)).toBeInTheDocument();
    });
    const calls = supabase.__getCallHistory();
    const insertCall = calls.find(c => c.method === 'insert' && c.table === 'learning_sessions');
    expect(insertCall).toBeUndefined();
  });

  it('should allow non-overlapping time entries', async () => {
    const dateStr = todayStr();
    supabase.__setTableData('courses', [COURSE_ROW]);
    supabase.__setTableData('learning_sessions', [
      { id: 'session-1', student_id: 'test-user-1', course_id: 'course-1', session_date: dateStr, start_time: '09:00:00', end_time: '10:00:00', deleted_at: null },
    ]);
    supabase.__setTableData('user_learning_forms', []);

    renderLearning();
    await waitForForm();

    // 新记录 10:00-11:00 紧接已有记录之后，不重叠
    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: '10:00' } });
    fireEvent.change(timeInputs[1], { target: { value: '11:00' } });
    fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: '自主预习' } });
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));

    await waitFor(() => {
      const calls = supabase.__getCallHistory();
      const insertCall = calls.find(c => c.method === 'insert' && c.table === 'learning_sessions');
      expect(insertCall).toBeDefined();
      expect(insertCall.args.duration_minutes).toBe(60);
      expect(insertCall.args.student_id).toBe('test-user-1');
      expect(insertCall.args.form).toBe('自主预习');
    });
  });

  it('should handle cross-midnight learning sessions', async () => {
    seedBase();
    renderLearning();
    await waitForForm();

    // 23:00 → 次日 01:00，时长应计为 120 分钟
    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: '23:00' } });
    fireEvent.change(timeInputs[1], { target: { value: '01:00' } });
    fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: '自主预习' } });
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));

    await waitFor(() => {
      const calls = supabase.__getCallHistory();
      const insertCall = calls.find(c => c.method === 'insert' && c.table === 'learning_sessions');
      expect(insertCall).toBeDefined();
      expect(insertCall.args.duration_minutes).toBe(120);
    });
  });

  it('should load recent learning sessions', async () => {
    const dateStr = todayStr();
    supabase.__setTableData('courses', [COURSE_ROW]);
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
        course: { id: 'course-1', name: '数学', subject: '', course_type: 1 },
      },
    ]);
    supabase.__setTableData('user_learning_forms', []);

    renderLearning();
    await waitForForm();

    // 最近记录卡片：课程名、行为形式、主观标签、时长（数字与单位分两个元素渲染）
    await waitFor(() => {
      expect(screen.getByText('自主复习')).toBeInTheDocument();
      expect(screen.getByText('主观：基本掌握')).toBeInTheDocument();
      const durNum = document.querySelector('.record-card__duration-num');
      expect(durNum).not.toBeNull();
      expect(durNum.textContent).toBe('60');
      expect(document.querySelector('.record-card__duration-unit').textContent).toBe('分钟');
    });
  });

  it('should add custom learning form', async () => {
    seedBase();
    renderLearning();
    await waitForForm();

    // 学习行为形式下拉（第 4 个 select）选择「＋ 其他 / 自定义…」
    fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: '__ADD_OTHER__' } });

    await waitFor(() => {
      expect(document.querySelectorAll('input[placeholder*="填写一个新的形式名称"]').length).toBeGreaterThan(0);
    });

    fireEvent.change(document.querySelector('input[placeholder*="填写一个新的形式名称"]'), { target: { value: '在线课程' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => {
      const calls = supabase.__getCallHistory();
      const insertCall = calls.find(c => c.method === 'insert' && c.table === 'user_learning_forms');
      expect(insertCall).toBeDefined();
      expect(insertCall.args.name).toBe('在线课程');
      expect(insertCall.args.student_id).toBe('test-user-1');
    });
  });

  it('should render with subjective evaluation by default', async () => {
    seedBase();
    renderLearning();
    await waitForForm();

    // 默认类别为「学习」：只显示必填的主观评估，不显示客观评估
    expect(screen.getByText('主观评估')).toBeInTheDocument();
    expect(screen.queryByText('客观评估')).not.toBeInTheDocument();

    // 主观滑轨默认第 4 档「基本掌握」（tooltip 与刻度标签都会出现该文案）
    expect(screen.getAllByText('基本掌握').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.glass-rail').length).toBe(1);

    // 切到「练习」类别后出现客观评估区（含第二根滑轨）
    fireEvent.click(screen.getByRole('button', { name: '练习' }));
    await waitFor(() => {
      expect(screen.getByText('客观评估')).toBeInTheDocument();
      expect(document.querySelectorAll('.glass-rail').length).toBe(2);
    });
  });
});
