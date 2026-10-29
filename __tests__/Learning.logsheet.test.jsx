import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import Layout from '../src/components/Layout.jsx';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { clearAllCaches } from '../src/lib/studentCache.js';
import { computeDuration } from '../src/lib/sessionRules.js';

// 记一下 sheet、再记一次、待补填行内补填、编辑回显。断言的都是保存口径（主观/客观/eval_type/待补填），
// 与 sessionRules.test.js 的规则一致。

const COURSE_ROW = {
  id: 'course-1', name: '数学', subject: '', course_type: 1,
  school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2026-02-01',
  chapters: [{ id: 'ch-1', name: '函数', deleted_at: null, units: [{ id: 'u-1', name: '一次函数', deleted_at: null }] }],
};
const COURSE_2 = {
  id: 'course-2', name: '物理', subject: '', course_type: 2,
  school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2025-09-01', chapters: [],
};
const PAST = '2026-01-05';

function session(o) {
  return {
    id: 's-1', student_id: 'test-user-1', course_id: 'course-1', chapter_id: null, unit_id: null,
    session_date: PAST, start_time: '19:00:00', end_time: '19:45:00', duration_minutes: 45,
    category: 3, form: '自主练习', eval_type: 2, self_rating: 60, grade_label: 'B', score: null, notes: null,
    deleted_at: null, created_at: '2026-01-05T19:45:00Z',
    course: { id: 'course-1', name: '数学', subject: '', course_type: 1 },
    ...o,
  };
}

function seed(sessions = []) {
  supabase.__setTableData('courses', [COURSE_ROW, COURSE_2]);
  supabase.__setTableData('learning_sessions', sessions);
  supabase.__setTableData('user_learning_forms', []);
}

function renderLearning(path = '/learning') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Learning />
    </MemoryRouter>,
  );
}

// 带 Layout 的渲染：桌面 Esc 的全局快捷键在 Layout 里广播 'yb:close-log'
function renderLearningWithLayout() {
  return render(
    <MemoryRouter initialEntries={['/records']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/records" element={<Learning />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const SAVE = { name: /^保存(记录|修改)/ };
const lastCall = (method) => supabase.__getCallHistory().filter(c => c.method === method && c.table === 'learning_sessions').pop();

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: '记一下' }));
  await screen.findByRole('dialog', { name: '记一下' });
  await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
}
function setTimes(start, end) {
  const t = document.querySelectorAll('input[type="time"]');
  fireEvent.change(t[0], { target: { value: start } });
  fireEvent.change(t[1], { target: { value: end } });
}

beforeEach(() => {
  supabase.__resetMocks();
  supabase.__setAuthState({
    user: { id: 'test-user-1', email: 'test@example.com' },
    session: { user: { id: 'test-user-1', email: 'test@example.com' } },
  });
  setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
  setAuthProfile({ id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户' });
});

describe('记一下 · 客观评价三种方式', () => {
  async function savePractice(mode) {
    seed();
    renderLearning();
    await openSheet();
    setTimes('08:00', '08:40');
    fireEvent.click(screen.getByRole('radio', { name: '练习' }));
    fireEvent.click(screen.getByRole('button', { name: '自主练习' }));
    if (mode) fireEvent.click(screen.getByRole('radio', { name: mode }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    return lastCall('insert').args;
  }

  test('现在填写：默认 B+，eval_type 2，主观默认 80', async () => {
    const p = await savePractice(null);
    expect(p).toMatchObject({ category: 3, form: '自主练习', grade_label: 'B+', eval_type: 2, self_rating: 80, duration_minutes: 40 });
  });

  test('稍后补充：grade_label null，eval_type 1', async () => {
    const p = await savePractice('稍后补充');
    expect(p.grade_label).toBeNull();
    expect(p.eval_type).toBe(1);
  });

  test('N/A 不适用：grade_label N/A，eval_type 2', async () => {
    const p = await savePractice('N/A 不适用');
    expect(p.grade_label).toBe('N/A');
    expect(p.eval_type).toBe(2);
  });

  test('选等第与主观档位', async () => {
    seed();
    renderLearning();
    await openSheet();
    setTimes('08:00', '08:30');
    fireEvent.click(screen.getByRole('radio', { name: '练习' }));
    fireEvent.click(screen.getByRole('button', { name: '学校作业' }));
    fireEvent.click(screen.getByRole('radio', { name: 'A-' }));
    fireEvent.click(screen.getByRole('radio', { name: '完全掌握' }));
    expect(screen.getByText(/对应百分制 90–92/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ grade_label: 'A-', eval_type: 2, self_rating: 100, form: '学校作业' });
  });

  test('非练习：grade_label null，eval_type 1；切类别清空不属于新类别的形式', async () => {
    seed();
    renderLearning();
    await openSheet();
    setTimes('08:00', '08:30');
    fireEvent.click(screen.getByRole('radio', { name: '练习' }));
    fireEvent.click(screen.getByRole('button', { name: '自主练习' }));
    fireEvent.click(screen.getByRole('radio', { name: '复习' }));
    expect(screen.queryByText('客观评价')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '自主练习' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自主复习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ category: 2, form: '自主复习', grade_label: null, eval_type: 1 });
  });
});

describe('记一下 · 时长优先', () => {
  test('点时长 chip：按现在往前推开始时间，仍写入 start/end/duration', async () => {
    seed();
    renderLearning();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: '60 分钟' }));
    const t = document.querySelectorAll('input[type="time"]');
    expect(t[0].value).not.toBe('');
    expect(computeDuration(t[0].value, t[1].value)).toBe(60);
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    expect(screen.getByRole('button', SAVE)).toHaveTextContent('60 分钟');
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    const p = lastCall('insert').args;
    expect(p.duration_minutes).toBe(60);
    expect(p.start_time).toBe(`${t[0].value}:00`);
    expect(p.end_time).toBe(`${t[1].value}:00`);
  });

  test('改时长输入框', async () => {
    seed();
    renderLearning();
    await openSheet();
    fireEvent.change(screen.getByRole('spinbutton', { name: '时长（分钟）' }), { target: { value: '35' } });
    const t = document.querySelectorAll('input[type="time"]');
    expect(computeDuration(t[0].value, t[1].value)).toBe(35);
  });

  test('先填开始再点时长：开始不被覆盖，结束按开始往后推', async () => {
    seed();
    renderLearning();
    await openSheet();
    const t = document.querySelectorAll('input[type="time"]');
    fireEvent.change(t[0], { target: { value: '14:00' } });
    fireEvent.click(screen.getByRole('button', { name: '60 分钟' }));
    expect(t[0].value).toBe('14:00');
    expect(t[1].value).toBe('15:00');
    fireEvent.click(screen.getByRole('button', { name: '45 分钟' }));
    expect(t[0].value).toBe('14:00');
    expect(t[1].value).toBe('14:45');
  });

  test('先填结束再点时长：结束不被覆盖，开始按结束往前推；两个都填过则较早填的那个让位', async () => {
    seed();
    renderLearning();
    await openSheet();
    const t = document.querySelectorAll('input[type="time"]');
    fireEvent.change(t[1], { target: { value: '16:30' } });
    fireEvent.click(screen.getByRole('button', { name: '45 分钟' }));
    expect(t[0].value).toBe('15:45');
    expect(t[1].value).toBe('16:30');
    fireEvent.change(t[0], { target: { value: '15:00' } });
    fireEvent.change(t[1], { target: { value: '16:10' } });
    fireEvent.click(screen.getByRole('button', { name: '60 分钟' }));
    expect(t[0].value).toBe('15:10');
    expect(t[1].value).toBe('16:10');
  });
});

describe('记一下 · 午夜前后的时长优先', () => {
  afterEach(() => { jest.useRealTimers(); });

  test('现在 00:20 点 45 分钟：开始 23:35 记在前一天，start/end/duration 一致', async () => {
    seed();
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'queueMicrotask', 'nextTick', 'setImmediate', 'clearTimeout', 'clearInterval'] });
    jest.setSystemTime(new Date(2026, 9, 26, 0, 20));
    renderLearning();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: '45 分钟' }));
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({
      session_date: '2026-10-25', start_time: '23:35:00', end_time: '00:20:00', duration_minutes: 45,
    });
  });

  test('00:20 点 45 分钟再改成 10 分钟：日期回到今天', async () => {
    seed();
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'queueMicrotask', 'nextTick', 'setImmediate', 'clearTimeout', 'clearInterval'] });
    jest.setSystemTime(new Date(2026, 9, 26, 0, 20));
    renderLearning();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: '45 分钟' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '时长（分钟）' }), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({
      session_date: '2026-10-26', start_time: '00:10:00', end_time: '00:20:00', duration_minutes: 10,
    });
  });
});

describe('再记一次', () => {
  test('来自学生自己的最近组合，一点预填，再点保存', async () => {
    seed([session({})]);
    renderLearning();
    const chip = await screen.findByRole('button', { name: '再记一次：数学 · 练习 · 自主练习 · 45 分钟' });
    fireEvent.click(chip);
    await screen.findByRole('dialog', { name: '记一下' });
    expect(screen.getByRole('radio', { name: '练习' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '自主练习' })).toHaveAttribute('aria-pressed', 'true');
    // 等第回到默认 B+，不沿用上次的 B
    expect(screen.getByRole('radio', { name: 'B+' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({
      course_id: 'course-1', category: 3, form: '自主练习', duration_minutes: 45,
      self_rating: 80, grade_label: 'B+', eval_type: 2,
    });
  });

  test('没有记录时不显示，也不再有固定的「自主预习」快速记录', async () => {
    seed();
    renderLearning();
    await screen.findByRole('button', { name: '记一下' });
    expect(screen.queryByText('再记一次')).not.toBeInTheDocument();
    expect(screen.queryByText('快速记录')).not.toBeInTheDocument();
  });
});

describe('打开方式：yb:open-log 事件与 ?log=1', () => {
  test('事件 detail 预填课程/类别/形式/时长', async () => {
    seed();
    renderLearning();
    await screen.findByRole('button', { name: '记一下' });
    await waitFor(() => expect(supabase.__getCallHistory().some(c => c.table === 'courses')).toBe(true));
    act(() => {
      window.dispatchEvent(new CustomEvent('yb:open-log', { detail: { courseId: 'course-2', category: 3, form: '学校作业', durationMinutes: 90 } }));
    });
    await screen.findByRole('dialog', { name: '记一下' });
    await waitFor(() => expect(screen.getByRole('button', { name: '物理' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('radio', { name: '练习' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '学校作业' })).toHaveAttribute('aria-pressed', 'true');
    const t = document.querySelectorAll('input[type="time"]');
    expect(computeDuration(t[0].value, t[1].value)).toBe(90);
  });

  test('无 detail 的事件也能打开', async () => {
    seed();
    renderLearning();
    await screen.findByRole('button', { name: '记一下' });
    act(() => { window.dispatchEvent(new CustomEvent('yb:open-log')); });
    expect(await screen.findByRole('dialog', { name: '记一下' })).toBeInTheDocument();
  });

  test('/learning?log=1 进入即打开', async () => {
    seed();
    renderLearning('/learning?log=1');
    expect(await screen.findByRole('dialog', { name: '记一下' })).toBeInTheDocument();
  });

  test('提醒推送的链接 ?log=1&course&category&form&minutes：打开即预填，与 yb:open-log 一致', async () => {
    seed();
    renderLearning(`/records?log=1&course=course-2&category=3&form=${encodeURIComponent('学校作业')}&minutes=90`);
    await screen.findByRole('dialog', { name: '记一下' });
    await waitFor(() => expect(screen.getByRole('button', { name: '物理' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('radio', { name: '练习' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '学校作业' })).toHaveAttribute('aria-pressed', 'true');
    const t = document.querySelectorAll('input[type="time"]');
    expect(computeDuration(t[0].value, t[1].value)).toBe(90);
    // 主观 / 客观默认不变：默认「基本掌握」(80)，客观 B+
    expect(screen.getByRole('radio', { name: 'B+' })).toHaveAttribute('aria-checked', 'true');
  });

  test('链接里的参数不合法时忽略：类别回到默认、课程不存在则用默认课程', async () => {
    seed();
    renderLearning('/records?log=1&course=nope&category=9&minutes=abc');
    await screen.findByRole('dialog', { name: '记一下' });
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    expect(screen.getByRole('radio', { name: '学习' })).toHaveAttribute('aria-checked', 'true');
  });

  test('链接里的 minutes 无穷大 / 过大时忽略，不会写出 NaN:NaN 的时间', async () => {
    seed();
    renderLearning('/records?log=1&minutes=Infinity');
    await screen.findByRole('dialog', { name: '记一下' });
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    const t = document.querySelectorAll('input[type="time"]');
    expect(t[0].value).toBe('');
    expect(t[1].value).toBe('');
  });

  test('链接里的 form 不属于该类别的预设 / 自定义形式时忽略（不能借链接写入任意形式）', async () => {
    seed();
    renderLearning('/records?log=1&category=1&form=' + encodeURIComponent('学校作业'));
    await screen.findByRole('dialog', { name: '记一下' });
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '学校作业' })).toBeNull();
    expect(screen.getByRole('button', { name: '自主预习' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('关闭按钮有可读名称', async () => {
    seed();
    renderLearning();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '记一下' })).not.toBeInTheDocument());
  });
});

describe('待补填 · 行内补填', () => {
  test('同一口径的列表，点等第即保存（eval_type 2），N/A 也可选', async () => {
    seed([
      session({ id: 'p-1', grade_label: null, eval_type: 1 }),
      session({ id: 'p-2', grade_label: null, eval_type: 1, session_date: '2026-01-04', created_at: '2026-01-04T10:00:00Z' }),
      session({ id: 'done', grade_label: 'A' }),
      session({ id: 'na', grade_label: 'N/A' }),
      session({ id: 'scored', grade_label: null, score: 90 }),
      session({ id: 'study', grade_label: null, category: 1, form: '自主预习' }),
      session({ id: 'deleted', grade_label: null, deleted_at: '2026-01-06T00:00:00Z' }),
    ]);
    renderLearning();
    const tab = await screen.findByRole('tab', { name: /待补填/ });
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'false');

    await waitFor(() => expect(screen.getAllByRole('radiogroup', { name: /补填客观评价/ })).toHaveLength(2));
    const [first, second] = screen.getAllByRole('radiogroup', { name: /补填客观评价/ });
    expect(within(first).getAllByRole('radio')).toHaveLength(14);
    expect(within(first).getByRole('radio', { name: 'N/A' })).toBeInTheDocument();

    fireEvent.click(within(first).getByRole('radio', { name: 'A-' }));
    await waitFor(() => expect(lastCall('update')).toBeDefined());
    expect(lastCall('update').args).toEqual({ grade_label: 'A-', eval_type: 2 });
    expect(await screen.findByText(/已补填 A- · 90–92/)).toBeInTheDocument();

    fireEvent.click(within(second).getByRole('radio', { name: 'N/A' }));
    await waitFor(() => expect(lastCall('update').args).toEqual({ grade_label: 'N/A', eval_type: 2 }));
    const rows = supabase.__getTableData('learning_sessions');
    expect(rows.find(r => r.id === 'p-1').grade_label).toBe('A-');
    expect(rows.find(r => r.id === 'p-2').grade_label).toBe('N/A');
  });
});

describe('编辑记录', () => {
  test('原有等第切到稍后补充：提示清除，保存后 grade_label null', async () => {
    seed([session({ id: 'e-1', grade_label: 'A', self_rating: 60, chapter_id: 'ch-1', unit_id: null })]);
    const origFrom = supabase.from.bind(supabase);
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
      const q = origFrom(t);
      if (q && !q.neq) q.neq = function neq(f, v) { this.filters.push({ type: 'not', operator: 'eq', field: f, value: v }); return this; };
      return q;
    });
    try {
      renderLearning();
      fireEvent.click(await screen.findByRole('button', { name: '编辑这条记录' }));
      await screen.findByRole('dialog', { name: '编辑记录' });
      expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: '有不少没掌握' })).toHaveAttribute('aria-checked', 'true');
      // 无单元的记录不被静默改成第一单元
      expect(screen.getByRole('combobox', { name: '单元' })).toHaveValue('');
      expect(screen.queryByText('保存后将清除原有客观评价，记录回到待补填。')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: '稍后补充' }));
      expect(screen.getByText('保存后将清除原有客观评价，记录回到待补填。')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', SAVE));
      await waitFor(() => expect(lastCall('update')).toBeDefined());
      const p = lastCall('update').args;
      expect(p).toMatchObject({ grade_label: null, eval_type: 1, self_rating: 60, chapter_id: 'ch-1', unit_id: null });
      expect(p).not.toHaveProperty('student_id');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('编辑记录 · 不动没改的字段', () => {
  async function editAndSave(row, mutate) {
    seed([row]);
    const origFrom = supabase.from.bind(supabase);
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
      const q = origFrom(t);
      if (q && !q.neq) q.neq = function neq(f, v) { this.filters.push({ type: 'not', operator: 'eq', field: f, value: v }); return this; };
      return q;
    });
    try {
      renderLearning();
      fireEvent.click(await screen.findByRole('button', { name: '编辑这条记录' }));
      await screen.findByRole('dialog', { name: '编辑记录' });
      if (mutate) mutate();
      fireEvent.click(screen.getByRole('button', SAVE));
      await waitFor(() => expect(lastCall('update')).toBeDefined());
      return lastCall('update').args;
    } finally { spy.mockRestore(); }
  }

  test('章节 / 单元已被删除的记录：只改备注，chapter_id / unit_id 原样保留', async () => {
    const p = await editAndSave(
      session({ id: 'e-2', category: 1, form: '自主预习', grade_label: null, chapter_id: 'ch-gone', unit_id: 'u-gone' }),
      () => fireEvent.change(screen.getByLabelText('备注（可选）'), { target: { value: '补一句' } }),
    );
    expect(p).toMatchObject({ chapter_id: 'ch-gone', unit_id: 'u-gone', notes: '补一句' });
  });

  test('课程已被删除的记录：只改备注，course / chapter / unit 原样保留', async () => {
    const p = await editAndSave(
      session({ id: 'e-3', course_id: 'course-gone', category: 1, form: '自主预习', grade_label: null, chapter_id: 'ch-x', unit_id: 'u-x', course: null }),
      () => fireEvent.change(screen.getByLabelText('备注（可选）'), { target: { value: '补一句' } }),
    );
    expect(p).toMatchObject({ course_id: 'course-gone', chapter_id: 'ch-x', unit_id: 'u-x' });
  });

  test('时间不动：19:00–19:45 / 45 分钟原样写回；跨午夜的旧记录也不变', async () => {
    const p = await editAndSave(session({ id: 'e-4', category: 1, form: '自主预习', grade_label: null }));
    expect(p).toMatchObject({ session_date: PAST, start_time: '19:00:00', end_time: '19:45:00', duration_minutes: 45 });
    cleanup();
    clearAllCaches(); // 重新打开应用：上一轮的内存缓存不能带过来
    const q = await editAndSave(session({ id: 'e-5', category: 1, form: '自主预习', grade_label: null, start_time: '23:30:00', end_time: '00:15:00', duration_minutes: 45 }));
    expect(q).toMatchObject({ session_date: PAST, start_time: '23:30:00', end_time: '00:15:00', duration_minutes: 45 });
  });
});

describe('待补填 · 补填后「全部」列表同步', () => {
  test('在待补填里补了等第，回到全部列表时该行显示客观等第而不是「待补充」', async () => {
    seed([session({ id: 'p-1', grade_label: null, eval_type: 1 })]);
    renderLearning();
    expect(await screen.findByText('客观：待补充')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /待补填/ }));
    const group = await screen.findByRole('radiogroup', { name: /补填客观评价/ });
    fireEvent.click(within(group).getByRole('radio', { name: 'A-' }));
    await screen.findByText(/已补填 A-/);
    // 等待补填列表的延迟刷新完成（都补齐了）
    await screen.findByText('都补齐了', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('tab', { name: /全部/ }));
    expect(await screen.findByText('客观：A-')).toBeInTheDocument();
    expect(screen.queryByText('客观：待补充')).toBeNull();
  });
});

describe('记一下 · 跨午夜时段的冲突检测', () => {
  test('已有 23:00–23:50 的记录，再记 23:35–00:20 被拒绝，不写库', async () => {
    const today = new Date();
    const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    seed([session({ id: 'late', session_date: d, start_time: '23:00:00', end_time: '23:50:00', category: 1, form: '自主预习', grade_label: null })]);
    renderLearning();
    await openSheet();
    setTimes('23:35', '00:20');
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    expect(await screen.findByText(/该时间段已有学习记录（23:00:00 - 23:50:00）/)).toBeInTheDocument();
    expect(lastCall('insert')).toBeUndefined();
  });

  test('同一晚没有冲突时正常保存（date=开始日，end<start，duration 跨午夜）', async () => {
    seed();
    renderLearning();
    await openSheet();
    setTimes('23:35', '00:20');
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ start_time: '23:35:00', end_time: '00:20:00', duration_minutes: 45 });
  });
});

describe('待补填 · 键盘操作', () => {
  test('方向键只移动焦点，不会在移动途中把等第存进库；回车 / 空格才是确认', async () => {
    seed([session({ id: 'p-1', grade_label: null, eval_type: 1 })]);
    renderLearning();
    fireEvent.click(await screen.findByRole('tab', { name: /待补填/ }));
    const group = await screen.findByRole('radiogroup', { name: /补填客观评价/ });
    const first = within(group).getAllByRole('radio')[0];
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    await new Promise(r => setTimeout(r, 30));
    expect(lastCall('update')).toBeUndefined();
    expect(within(group).getAllByRole('radio')[2]).toHaveFocus();
    fireEvent.click(document.activeElement);
    await waitFor(() => expect(lastCall('update')).toBeDefined());
    expect(lastCall('update').args).toEqual({ grade_label: 'A-', eval_type: 2 });
  });
});

describe('记一下 · 现在按钮与自动标记', () => {
  afterEach(() => { jest.useRealTimers(); });

  test('点「现在」把开始 / 结束填成系统当前时间，并算作亲手填过', async () => {
    seed();
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'queueMicrotask', 'nextTick', 'setImmediate', 'clearTimeout', 'clearInterval'] });
    jest.setSystemTime(new Date(2026, 9, 26, 10, 30));
    renderLearning();
    await openSheet();
    const [startNow, endNow] = screen.getAllByRole('button', { name: '现在' });
    const t = document.querySelectorAll('input[type="time"]');
    fireEvent.click(startNow);
    expect(t[0].value).toBe('10:30');
    fireEvent.click(endNow);
    expect(t[1].value).toBe('10:30');
  });

  test('系统推出来的时间标「自动」，亲手填后该字段不再标', async () => {
    seed();
    renderLearning();
    await openSheet();
    expect(screen.queryAllByText('自动')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '45 分钟' }));
    const t = document.querySelectorAll('input[type="time"]');
    // 没亲手填过：开始、结束都是系统推的，两个字段都标「自动」
    expect(screen.getAllByText('自动')).toHaveLength(2);
    expect(t[0].className).toContain('is-auto');
    expect(t[1].className).toContain('is-auto');
    fireEvent.change(t[0], { target: { value: '14:00' } });
    // 亲手填了开始：只有结束还是自动
    expect(screen.getAllByText('自动')).toHaveLength(1);
    expect(t[0].className).not.toContain('is-auto');
    expect(t[1].className).toContain('is-auto');
  });
});

describe('记一下 · 主观评价可拖动刻度', () => {
  test('拖动轨道吸到最近一档，保存的 self_rating 跟着变', async () => {
    seed();
    renderLearning();
    await openSheet();
    setTimes('08:00', '08:40');
    const track = screen.getByRole('slider', { name: /主观评价/ });
    // jsdom 里所有元素宽度都是 0，给轨道一个可换算的尺寸
    track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 32, right: 200, bottom: 32 });
    // jsdom 没有 PointerEvent，直接用带 clientX 的 MouseEvent 派发 pointer* 事件
    const pe = (type, clientX) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 16 });
    // 左右各留 10px：clientX 100 → 比例 0.5 → 第 2 档（有不少没掌握）
    fireEvent(track, pe('pointerdown', 10));
    fireEvent(track, pe('pointermove', 100));
    fireEvent(track, pe('pointerup', 100));
    expect(track).toHaveAttribute('aria-valuenow', '2');
    expect(track).toHaveAttribute('aria-valuetext', '有不少没掌握');
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ self_rating: 60 });
  });

  test('方向键 → 移动一档，保存的 self_rating 跟着变', async () => {
    seed();
    renderLearning();
    await openSheet();
    setTimes('08:00', '08:40');
    const track = screen.getByRole('slider', { name: /主观评价/ });
    expect(track).toHaveAttribute('aria-valuenow', '3');
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(track).toHaveAttribute('aria-valuenow', '4');
    expect(track).toHaveAttribute('aria-valuetext', '完全掌握');
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ self_rating: 100 });
  });
});

describe('记一下 · 章节 / 单元两个下拉', () => {
  const MULTI_COURSE = {
    id: 'course-m', name: '化学', subject: '', course_type: 1,
    school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2026-02-01',
    chapters: [
      { id: 'ch-a', name: '第一章', deleted_at: null, units: [
        { id: 'u-a', name: '单元A', deleted_at: null },
        { id: 'u-b', name: '单元B', deleted_at: null },
      ] },
      { id: 'ch-b', name: '第二章', deleted_at: null, units: [
        { id: 'u-c', name: '单元C', deleted_at: null },
      ] },
    ],
  };

  test('单元只列所选章节的单元，保存写入对应的 chapter_id / unit_id', async () => {
    supabase.__setTableData('courses', [MULTI_COURSE]);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);
    renderLearning();
    fireEvent.click(await screen.findByRole('button', { name: '记一下' }));
    await screen.findByRole('dialog', { name: '记一下' });
    await waitFor(() => expect(screen.getByRole('button', { name: '化学', pressed: true })).toBeInTheDocument());

    const chapter = screen.getByRole('combobox', { name: '章节' });
    const unit = screen.getByRole('combobox', { name: '单元' });
    // 默认沿用改版前的行为：第一个章节 + 其第一个单元
    expect(chapter).toHaveValue('ch-a');
    expect(unit).toHaveValue('u-a');
    fireEvent.change(chapter, { target: { value: 'ch-b' } });
    expect(unit).toHaveValue('');
    expect(within(unit).queryByRole('option', { name: '单元A' })).toBeNull();
    fireEvent.change(unit, { target: { value: 'u-c' } });

    setTimes('08:00', '08:40');
    fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
    fireEvent.click(screen.getByRole('button', SAVE));
    await waitFor(() => expect(lastCall('insert')).toBeDefined());
    expect(lastCall('insert').args).toMatchObject({ course_id: 'course-m', chapter_id: 'ch-b', unit_id: 'u-c' });
  });
});

describe('记一下 · 关前确认', () => {
  test('有改动时点遮罩先 confirm，取消则保留；确认后才关闭', async () => {
    seed();
    renderLearning();
    await openSheet();
    const orig = window.confirm;
    window.confirm = jest.fn(() => false);
    try {
      fireEvent.change(document.querySelectorAll('input[type="time"]')[0], { target: { value: '08:00' } });
      fireEvent.click(document.querySelector('.yb-sheet-scrim'));
      expect(window.confirm).toHaveBeenCalledWith('放弃这条记录？');
      expect(screen.getByRole('dialog', { name: '记一下' })).toBeInTheDocument();
      window.confirm.mockReturnValue(true);
      fireEvent.click(document.querySelector('.yb-sheet-scrim'));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '记一下' })).not.toBeInTheDocument());
    } finally {
      window.confirm = orig;
    }
  });

  test('没改动时点遮罩直接关闭，不弹 confirm', async () => {
    seed();
    renderLearning();
    await openSheet();
    const orig = window.confirm;
    window.confirm = jest.fn();
    try {
      fireEvent.click(document.querySelector('.yb-sheet-scrim'));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '记一下' })).not.toBeInTheDocument());
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = orig;
    }
  });
});

describe('记一下 · 桌面 Esc 也走未保存确认', () => {
  test('焦点在弹层外按 Esc：有改动时 confirm，取消则保留', async () => {
    seed();
    renderLearningWithLayout();
    // Layout 和页面各有一个「记一下」，点 Layout 的那个（快捷键入口）
    fireEvent.click(screen.getAllByRole('button', { name: '记一下' })[0]);
    await screen.findByRole('dialog', { name: '记一下' });
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    const t = document.querySelectorAll('input[type="time"]');
    fireEvent.change(t[0], { target: { value: '08:00' } });

    const orig = window.confirm;
    window.confirm = jest.fn(() => false);
    try {
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(window.confirm).toHaveBeenCalledWith('放弃这条记录？');
      expect(screen.getByRole('dialog', { name: '记一下' })).toBeInTheDocument();
    } finally {
      window.confirm = orig;
    }
  });
});

describe('记一下 · 编辑时点时长保留开始', () => {
  test('编辑 14:00–15:00 的记录，时长改成 30：开始 14:00、结束 14:30', async () => {
    seed([session({ id: 's-edit', category: 1, form: '自主预习', grade_label: null, start_time: '14:00:00', end_time: '15:00:00', duration_minutes: 60 })]);
    renderLearning();
    fireEvent.click(await screen.findByRole('button', { name: '编辑这条记录' }));
    await screen.findByRole('dialog', { name: '编辑记录' });
    fireEvent.change(screen.getByRole('spinbutton', { name: '时长（分钟）' }), { target: { value: '30' } });
    const t = document.querySelectorAll('input[type="time"]');
    expect(t[0].value).toBe('14:00');
    expect(t[1].value).toBe('14:30');
  });
});
