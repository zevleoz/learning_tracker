import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { buildSessionPayload } from '../src/lib/sessionRules.js';

// Step 2：桌面版记录页在 ≥1180px 用内嵌表单，900–1179px 用居中对话框；保存口径与 sheet 完全一致。

const COURSE_ROW = {
  id: 'course-1', name: '数学', subject: '', course_type: 1,
  school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2026-02-01',
  chapters: [{ id: 'ch-1', name: '函数', deleted_at: null, units: [{ id: 'u-1', name: '一次函数', deleted_at: null }] }],
};
const PAST = '2026-01-05';

function session(o) {
  return {
    id: 's-1', student_id: 'test-user-1', course_id: 'course-1', chapter_id: 'ch-1', unit_id: null,
    session_date: PAST, start_time: '19:00:00', end_time: '19:45:00', duration_minutes: 45,
    category: 1, form: '自主预习', eval_type: 1, self_rating: 60, grade_label: null, score: null, notes: '旧备注',
    deleted_at: null, created_at: '2026-01-05T19:45:00Z',
    course: { id: 'course-1', name: '数学', subject: '', course_type: 1 },
    ...o,
  };
}

function seed(sessions = []) {
  supabase.__setTableData('courses', [COURSE_ROW]);
  supabase.__setTableData('learning_sessions', sessions);
  supabase.__setTableData('user_learning_forms', []);
}

// 按窗口宽度 / 指针精度返回 matchMedia 结果；宽度变化不派发 change（测试里无需 resize）
const ORIGINAL_MATCH_MEDIA = window.matchMedia;
function setViewport(width, fine = false) {
  window.matchMedia = jest.fn((query) => {
    const min = query.match(/min-width:\s*(\d+)px/);
    const max = query.match(/max-width:\s*(\d+)px/);
    let matches = false;
    if (min) matches = width >= Number(min[1]);
    else if (max) matches = width <= Number(max[1]);
    else if (query.includes('pointer: fine')) matches = fine;
    return {
      matches, media: query, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
  });
}

function renderLearning(path = '/records') {
  return render(<MemoryRouter initialEntries={[path]}><Learning /></MemoryRouter>);
}
const lastCall = (method) => supabase.__getCallHistory().filter(c => c.method === method && tableIs(c, 'learning_sessions')).pop();
const tableIs = (c, t) => c.table === t;
const SAVE = { name: /^保存(记录|修改)/ };
const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 编辑时的时段冲突查询会用到 q.neq（测试 mock 里没有）
function withNeq() {
  const origFrom = supabase.from.bind(supabase);
  return jest.spyOn(supabase, 'from').mockImplementation((t) => {
    const q = origFrom(t);
    if (q && !q.neq) q.neq = function neq(f, v) { this.filters.push({ type: 'not', operator: 'eq', field: f, value: v }); return this; };
    return q;
  });
}

beforeEach(() => {
  localStorage.clear();
  supabase.__resetMocks();
  supabase.__setAuthState({
    user: { id: 'test-user-1', email: 'test@example.com' },
    session: { user: { id: 'test-user-1', email: 'test@example.com' } },
  });
  setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
  setAuthProfile({ id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户' });
});

afterEach(() => {
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
});

describe('≥1180px：记录页内嵌二列表单', () => {
  test('表单在页内、不弹对话框，保存写入与 sheet 相同的 payload', async () => {
    setViewport(1280);
    seed();
    renderLearning();
    expect(await screen.findByRole('region', { name: '记一下表单' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('最近记录')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());

    const [start, end] = document.querySelectorAll('input[type="time"]');
    fireEvent.change(start, { target: { value: '14:30' } });
    fireEvent.change(end, { target: { value: '15:30' } });
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());

    // 与 sessionRules 组装出的 sheet payload 严格一致
    expect(lastCall('insert').args).toEqual(buildSessionPayload({
      studentId: 'test-user-1', courseId: 'course-1', chapterId: 'ch-1', unitId: 'u-1',
      category: 1, formValue: '自主预习', notes: '',
      dateStr: toDateStr(new Date()), startStr: '14:30', endStr: '15:30',
      subjIdx: 3, objIdx: 9, objDeferred: false, isObjNA: false,
    }));
    // 保存后不弹对话框，内嵌表单仍在
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: '记一下表单' })).toBeInTheDocument();
  });

  test('保存新记录后清空时间与备注，保留课程和形式（同旧版）', async () => {
    setViewport(1280);
    seed();
    renderLearning();
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());

    const [start, end] = document.querySelectorAll('input[type="time"]');
    fireEvent.change(start, { target: { value: '07:00' } });
    fireEvent.change(end, { target: { value: '07:45' } });
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.change(screen.getByLabelText('备注（可选）'), { target: { value: '错题' } });
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());

    await waitFor(() => expect(document.querySelectorAll('input[type="time"]')[0]).toHaveValue(''));
    expect(document.querySelectorAll('input[type="time"]')[1]).toHaveValue('');
    expect(screen.getByLabelText('备注（可选）')).toHaveValue('');
    expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自主预习', pressed: true })).toBeInTheDocument();
    expect(supabase.__getCallHistory().filter(c => c.method === 'insert' && tableIs(c, 'learning_sessions'))).toHaveLength(1);
  });

  test('点记录编辑：载入内嵌表单、该行 aria-current；取消编辑清除', async () => {
    setViewport(1280);
    seed([session({})]);
    renderLearning();
    await screen.findByRole('region', { name: '记一下表单' });
    fireEvent.click(await screen.findByRole('button', { name: '编辑这条记录' }));

    expect(await screen.findByRole('region', { name: '编辑记录表单' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    const row = document.querySelector('.yb-rec--editing');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('备注（可选）')).toHaveValue('旧备注');

    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    expect(await screen.findByRole('region', { name: '记一下表单' })).toBeInTheDocument();
    expect(document.querySelector('.yb-rec--editing')).toBeNull();
  });

  test('编辑保存走 update，payload 与 sheet 一致；保存后行不再高亮', async () => {
    setViewport(1280);
    seed([session({})]);
    const spy = withNeq();
    try {
      renderLearning();
      await screen.findByRole('region', { name: '记一下表单' });
      fireEvent.click(await screen.findByRole('button', { name: '编辑这条记录' }));
      await screen.findByRole('region', { name: '编辑记录表单' });
      fireEvent.change(screen.getByLabelText('备注（可选）'), { target: { value: '新备注' } });
      fireEvent.click(screen.getByRole('button', { name: /^保存修改/ }));
      await waitFor(() => expect(lastCall('update')).toBeDefined());
      expect(lastCall('update').args).toEqual(buildSessionPayload({
        courseId: 'course-1', chapterId: 'ch-1', unitId: null,
        category: 1, formValue: '自主预习', notes: '新备注',
        dateStr: PAST, startStr: '19:00', endStr: '19:45',
        subjIdx: 2, objIdx: 9, objDeferred: true, isObjNA: false,
      }));
      expect(lastCall('update').args).not.toHaveProperty('student_id');
      await waitFor(() => expect(document.querySelector('.yb-rec--editing')).toBeNull());
    } finally {
      spy.mockRestore();
    }
  });

  test('＋ 记一下 / 再记一次 在宽屏预填内嵌表单，不弹对话框', async () => {
    setViewport(1280);
    seed([session({})]);
    renderLearning();
    await screen.findByRole('region', { name: '记一下表单' });
    fireEvent.click(await screen.findByRole('button', { name: '再记一次：数学 · 学习 · 自主预习 · 45 分钟' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('region', { name: '记一下表单' })).toBeInTheDocument();
    const [start, end] = document.querySelectorAll('input[type="time"]');
    expect(end.value).not.toBe('');
    expect(start.value).not.toBe('');
  });

  test('⌘↵ / Ctrl+↵ 在表单内保存', async () => {
    setViewport(1280);
    seed();
    renderLearning();
    await screen.findByRole('region', { name: '记一下表单' });
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    const [start, end] = document.querySelectorAll('input[type="time"]');
    fireEvent.change(start, { target: { value: '14:30' } });
    fireEvent.change(end, { target: { value: '15:30' } });
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.keyDown(start, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args.start_time).toBe('14:30:00');
  });
});

describe('900–1179px：＋ 记一下用居中对话框', () => {
  test('打开后是 role="dialog"（非底部 sheet），保存仍走同一个表单', async () => {
    setViewport(1000);
    seed();
    renderLearning();
    expect(screen.queryByRole('region', { name: '记一下表单' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '记一下' }));
    const dialog = await screen.findByRole('dialog', { name: '记一下' });
    expect(dialog.className).toContain('yb-dialog');
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    const [start, end] = document.querySelectorAll('input[type="time"]');
    fireEvent.change(start, { target: { value: '09:00' } });
    fireEvent.change(end, { target: { value: '09:45' } });
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ start_time: '09:00:00', end_time: '09:45:00', duration_minutes: 45 });
  });

  test('?log=1（从别的页面点 ＋）在宽屏也用对话框', async () => {
    setViewport(1280);
    seed();
    renderLearning('/records?log=1');
    const dialog = await screen.findByRole('dialog', { name: '记一下' });
    expect(dialog.className).toContain('yb-dialog');
    // 宽屏的内嵌表单仍挂载（保留草稿），但此时隐藏且不可聚焦
    expect(document.querySelector('.yb-inline')).toHaveClass('is-hidden');
    expect(document.querySelector('.yb-inline')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('桌面时间快捷输入（(pointer: fine)）', () => {
  test('1430 → 14:30、930 → 09:30，↑/↓ 每次 ±5 分钟，非法红框不写入', async () => {
    setViewport(1280, true);
    seed();
    renderLearning();
    await screen.findByRole('region', { name: '记一下表单' });
    const start = screen.getByLabelText('开始');
    const end = screen.getByLabelText('结束');
    expect(start.tagName).toBe('INPUT');
    expect(start.type).toBe('text');

    fireEvent.change(start, { target: { value: '1430' } });
    expect(start).toHaveValue('14:30');
    fireEvent.change(end, { target: { value: '930' } });
    expect(end).toHaveValue('09:30');

    fireEvent.keyDown(start, { key: 'ArrowUp' });
    expect(start).toHaveValue('14:35');
    fireEvent.keyDown(start, { key: 'ArrowDown' });
    expect(start).toHaveValue('14:30');

    fireEvent.change(start, { target: { value: '2400' } });
    expect(start).toHaveValue('2400');
    expect(start).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(start);
    expect(start).toHaveValue('14:30');
    expect(start).not.toHaveAttribute('aria-invalid');
  });

  test('输入 1430 / 1530 后保存，时间按 14:30–15:30 写库', async () => {
    setViewport(1280, true);
    seed();
    renderLearning();
    await screen.findByRole('region', { name: '记一下表单' });
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('开始'), { target: { value: '1430' } });
    fireEvent.change(screen.getByLabelText('结束'), { target: { value: '1530' } });
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ start_time: '14:30:00', end_time: '15:30:00', duration_minutes: 60 });
  });
});
