import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { peek, put } from '../src/lib/studentCache.js';
import { KEYS } from '../src/lib/studentResources.js';
import { loadOutbox } from '../src/lib/outbox.js';

// 记录页的保存 / 删除 / 补填：写入由数据库确认之后，列表和缓存立刻更新，不等后台刷新；
// 同时今天 / 洞察用的缓存同步修补，学生切过去看到的是自己刚做完的结果。

const UID = 'test-user-1';
const COURSE = {
  id: 'course-1', name: '数学', subject: '', course_type: 1,
  school_id: 'school-1', created_by: UID, deleted_at: null, created_at: '2026-02-01',
  chapters: [{ id: 'ch-1', name: '函数', deleted_at: null, units: [{ id: 'u-1', name: '一次函数', deleted_at: null }] }],
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function session(o) {
  return {
    id: 's-1', student_id: UID, course_id: 'course-1', chapter_id: null, unit_id: null,
    session_date: '2026-01-05', start_time: '19:00:00', end_time: '19:45:00', duration_minutes: 45,
    category: 3, form: '自主练习', eval_type: 1, self_rating: 60, grade_label: null, score: null, notes: null,
    deleted_at: null, created_at: '2026-01-05T19:45:00Z',
    course: { id: 'course-1', name: '数学', subject: '', course_type: 1 },
    ...o,
  };
}

// 今天 / 洞察那份缓存的精简行（和 fetchStudent 返回的形状一致）
const slim = (r) => ({
  id: r.id, session_date: r.session_date, start_time: r.start_time, duration_minutes: r.duration_minutes,
  category: r.category, form: r.form, self_rating: r.self_rating, grade_label: r.grade_label, score: r.score,
  deleted_at: null, course_id: r.course_id, chapter_id: null, unit_id: null, course: { id: 'course-1', name: '数学', course_type: 1 },
});

function seed(sessions) {
  supabase.__setTableData('courses', [COURSE]);
  supabase.__setTableData('learning_sessions', sessions);
  supabase.__setTableData('user_learning_forms', []);
  supabase.__setTableData('exam_scores', []);
  put(UID, KEYS.student, { todayStr: todayStr(), sessions: sessions.map(slim), historyReady: true, windowStart: '2024-01-01' });
}

// 记录列表的刷新查询（带 order）卡住，用来证明界面不等它；冲突检查、写入照常通过
function holdListRefresh() {
  let release;
  let gate = Promise.resolve();
  const origFrom = supabase.from.bind(supabase);
  const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
    const q = origFrom(t);
    if (t !== 'learning_sessions') return q;
    const origOrder = q.order;
    q.order = function order(...a) { this.__list = true; return origOrder.apply(this, a); };
    const origThen = q.then;
    q.then = function then(res, rej) {
      return (this.__list ? gate : Promise.resolve()).then(() => origThen.call(q, res, rej));
    };
    return q;
  });
  return {
    hold() { gate = new Promise((r) => { release = r; }); },
    release() { release?.(); },
    restore() { spy.mockRestore(); },
  };
}

function renderLearning() {
  return render(<MemoryRouter><Learning /></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  supabase.__resetMocks();
  supabase.__setAuthState({ user: { id: UID, email: 't@x.com' }, session: { user: { id: UID, email: 't@x.com' } } });
  setAuthUser({ id: UID, email: 't@x.com' });
  setAuthProfile({ id: UID, role: 1, full_name: '测试' });
});

test('保存：写入确认后马上关 sheet、新记录马上进列表和缓存，不等后台刷新', async () => {
  seed([session({ id: 'old', grade_label: 'B', session_date: '2026-01-05' })]);
  renderLearning();
  await screen.findByText('最近记录');

  const net = holdListRefresh();
  try {
    net.hold();
    fireEvent.click(screen.getByRole('button', { name: '记一笔' }));
    await screen.findByRole('dialog', { name: '记一笔' });
    await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
    const t = document.querySelectorAll('input[type="time"]');
    fireEvent.change(t[0], { target: { value: '08:00' } });
    fireEvent.change(t[1], { target: { value: '08:40' } });
    fireEvent.click(screen.getByRole('radio', { name: '练习' }));
    fireEvent.click(screen.getByRole('button', { name: '自主练习' }));
    fireEvent.click(screen.getByRole('radio', { name: '稍后补充' }));
    fireEvent.click(screen.getByRole('button', { name: /^保存记录/ }));

    // 列表刷新被卡住的情况下：已经写入、sheet 已关、新行已在最近记录里
    await waitFor(() => expect(supabase.__getCallHistory().some((c) => c.method === 'insert' && c.table === 'learning_sessions')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '记一笔' })).toBeNull());
    expect(await screen.findByText('客观：待补充')).toBeInTheDocument();
    const added = peek(UID, KEYS.recent).find((r) => r.id !== 'old');
    expect(added).toBeDefined();
    expect(added.course_id).toBe('course-1');
    // 待补填列表也有了
    expect(peek(UID, KEYS.pending).map((r) => r.id)).toContain(added.id);
    // 今天 / 洞察的缓存同步
    expect(peek(UID, KEYS.student).sessions.map((s) => s.id)).toContain(added.id);
  } finally {
    net.release();
    net.restore();
  }
});

test('保存失败（写库报错）：不显示成功，不进缓存，仍进本机暂存队列', async () => {
  seed([]);
  supabase.__setInsertError('learning_sessions', { message: 'network down' });
  renderLearning();
  await screen.findByText('最近记录');
  fireEvent.click(screen.getByRole('button', { name: '记一笔' }));
  await screen.findByRole('dialog', { name: '记一笔' });
  await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
  const t = document.querySelectorAll('input[type="time"]');
  fireEvent.change(t[0], { target: { value: '08:00' } });
  fireEvent.change(t[1], { target: { value: '08:40' } });
  fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
  fireEvent.click(screen.getByRole('button', { name: /^保存记录/ }));
  await waitFor(() => expect(loadOutbox()).toHaveLength(1));
  expect(screen.getByText(/待同步/)).toBeInTheDocument();
  expect(peek(UID, KEYS.recent)).toEqual([]);
  expect(peek(UID, KEYS.student).sessions).toHaveLength(0);
});

test('补填等第：写入确认后该行立刻显示已补填，「全部」里立刻变成等第，今天 / 洞察缓存同步', async () => {
  seed([session({ id: 'p-1' })]);
  renderLearning();
  expect(await screen.findByText('客观：待补充')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /待补填/ }));

  const net = holdListRefresh();
  try {
    net.hold();
    const group = await screen.findByRole('radiogroup', { name: /补填客观评价/ });
    fireEvent.click(within(group).getByRole('radio', { name: 'A-' }));
    await screen.findByText(/已补填 A-/);
    // 只有一次写入，列表刷新还没回来，缓存已经是新的
    const updates = supabase.__getCallHistory().filter((c) => c.method === 'update' && c.table === 'learning_sessions');
    expect(updates).toHaveLength(1);
    expect(peek(UID, KEYS.recent).find((r) => r.id === 'p-1').grade_label).toBe('A-');
    expect(peek(UID, KEYS.student).sessions.find((s) => s.id === 'p-1').grade_label).toBe('A-');
    fireEvent.click(screen.getByRole('tab', { name: /全部/ }));
    expect(await screen.findByText('客观：A-')).toBeInTheDocument();
  } finally {
    net.release();
    net.restore();
  }
});

test('删除：该行马上从最近记录、待补填、今天 / 洞察缓存里消失', async () => {
  seed([session({ id: 'del-1' }), session({ id: 'keep-1', session_date: '2026-01-06', grade_label: 'B' })]);
  renderLearning();
  await screen.findByText('客观：待补充');
  const net = holdListRefresh();
  try {
    net.hold();
    const deleteButtons = screen.getAllByRole('button', { name: '删除这条记录' });
    // 第一条是日期较新的 keep-1，第二条是 del-1
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    fireEvent.click(await screen.findByRole('button', { name: '确认删除这条记录' }));
    await waitFor(() => expect(peek(UID, KEYS.recent).map((r) => r.id)).toEqual(['keep-1']));
    expect(peek(UID, KEYS.pending).map((r) => r.id)).toEqual([]);
    expect(peek(UID, KEYS.student).sessions.map((s) => s.id)).toEqual(['keep-1']);
    await waitFor(() => expect(screen.queryByText('客观：待补充')).toBeNull());
  } finally {
    net.release();
    net.restore();
  }
});

test('切回记录页：先显示上次的列表（缓存），不转圈', async () => {
  seed([session({ id: 'a', grade_label: 'B' })]);
  const first = renderLearning();
  await screen.findByText('最近记录');
  first.unmount();
  // 网络变慢：重新进入时列表读取一直不返回
  const net = holdListRefresh();
  try {
    net.hold();
    renderLearning();
    expect(screen.getByText('最近记录')).toBeInTheDocument();
    expect(screen.getAllByText('数学').length).toBeGreaterThan(0);
    expect(screen.queryByText('加载中…')).toBeNull();
  } finally {
    net.release();
    net.restore();
  }
});
