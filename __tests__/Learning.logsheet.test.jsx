import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { computeDuration } from '../src/lib/sessionRules.js';

// 记一笔 sheet、再记一次、待补填行内补填、编辑回显。断言的都是保存口径（主观/客观/eval_type/待补填），
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

const SAVE = { name: /^保存(记录|修改)/ };
const lastCall = (method) => supabase.__getCallHistory().filter(c => c.method === method && c.table === 'learning_sessions').pop();

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: '记一笔' }));
  await screen.findByRole('dialog', { name: '记一笔' });
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

describe('记一笔 · 客观评价三种方式', () => {
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

describe('记一笔 · 时长优先', () => {
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
});

describe('再记一次', () => {
  test('来自学生自己的最近组合，一点预填，再点保存', async () => {
    seed([session({})]);
    renderLearning();
    const chip = await screen.findByRole('button', { name: '再记一次：数学 · 练习 · 自主练习 · 45 分钟' });
    fireEvent.click(chip);
    await screen.findByRole('dialog', { name: '记一笔' });
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
    await screen.findByRole('button', { name: '记一笔' });
    expect(screen.queryByText('再记一次')).not.toBeInTheDocument();
    expect(screen.queryByText('快速记录')).not.toBeInTheDocument();
  });
});

describe('打开方式：yb:open-log 事件与 ?log=1', () => {
  test('事件 detail 预填课程/类别/形式/时长', async () => {
    seed();
    renderLearning();
    await screen.findByRole('button', { name: '记一笔' });
    await waitFor(() => expect(supabase.__getCallHistory().some(c => c.table === 'courses')).toBe(true));
    act(() => {
      window.dispatchEvent(new CustomEvent('yb:open-log', { detail: { courseId: 'course-2', category: 3, form: '学校作业', durationMinutes: 90 } }));
    });
    await screen.findByRole('dialog', { name: '记一笔' });
    await waitFor(() => expect(screen.getByRole('button', { name: '物理' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('radio', { name: '练习' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '学校作业' })).toHaveAttribute('aria-pressed', 'true');
    const t = document.querySelectorAll('input[type="time"]');
    expect(computeDuration(t[0].value, t[1].value)).toBe(90);
  });

  test('无 detail 的事件也能打开', async () => {
    seed();
    renderLearning();
    await screen.findByRole('button', { name: '记一笔' });
    act(() => { window.dispatchEvent(new CustomEvent('yb:open-log')); });
    expect(await screen.findByRole('dialog', { name: '记一笔' })).toBeInTheDocument();
  });

  test('/learning?log=1 进入即打开', async () => {
    seed();
    renderLearning('/learning?log=1');
    expect(await screen.findByRole('dialog', { name: '记一笔' })).toBeInTheDocument();
  });

  test('关闭按钮有可读名称', async () => {
    seed();
    renderLearning();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '记一笔' })).not.toBeInTheDocument());
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
      expect(screen.getByRole('button', { name: /章节 \/ 单元/ })).toHaveTextContent('整章');
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
