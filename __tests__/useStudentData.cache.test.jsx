import { renderHook, waitFor, act } from '@testing-library/react';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { useStudentData } from '../src/lib/useStudentData.js';
import { peek, clearAllCaches } from '../src/lib/studentCache.js';
import {
  KEYS, fetchStudent, afterSessionAdded, afterSessionDeleted, afterSessionGraded,
} from '../src/lib/studentResources.js';

// 学生数据缓存：切回来立即显示、后台刷新；自己的保存 / 删除 / 补填之后列表不陈旧；换账号不串数据。

const TODAY = new Date(2026, 9, 26, 12, 0);   // 2026-10-26

function dayStr(n) {
  const d = new Date(2026, 9, 26 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function row(id, studentId, offset, extra = {}) {
  return {
    id, student_id: studentId, session_date: dayStr(offset), start_time: '09:00:00', duration_minutes: 30,
    category: 1, form: '自主预习', self_rating: 60, grade_label: null, score: null, deleted_at: null,
    course_id: 'c1', chapter_id: null, unit_id: null, course: { id: 'c1', name: '数学', course_type: 1 },
    ...extra,
  };
}

function login(id) {
  setAuthUser({ id, email: `${id}@x.com` });
  setAuthProfile({ id, role: 1, full_name: id });
}

// 让 learning_sessions 的每次查询都卡在 gate 上，模拟 0.5 s 一次往返的慢网络
function slowNetwork() {
  let release;
  let gate = new Promise((r) => { release = r; });
  const origFrom = supabase.from.bind(supabase);
  const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
    const q = origFrom(t);
    const origThen = q.then;
    q.then = (res, rej) => gate.then(() => origThen.call(q, res, rej));
    return q;
  });
  return {
    release: () => release(),
    close: () => { gate = new Promise((r) => { release = r; }); },
    restore: () => spy.mockRestore(),
  };
}

beforeEach(() => {
  supabase.__resetMocks();
  clearAllCaches();
  supabase.__setTableData('exam_scores', []);
  supabase.__setTableData('teacher_student_connections', []);
});

describe('再次打开：先显示缓存，后台刷新', () => {
  test('第二次挂载时 loading 为 false、数据立即在，不等网络；刷新回来后更新', async () => {
    login('u1');
    supabase.__setTableData('learning_sessions', [row('s1', 'u1', 0), row('s2', 'u1', -1)]);

    const first = renderHook(() => useStudentData({ today: TODAY }));
    expect(first.result.current.loading).toBe(true);        // 第一次没有缓存，必须等
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.sessions).toHaveLength(2);
    first.unmount();

    // 离开后数据库多了一条，网络变慢
    supabase.__setTableData('learning_sessions', [row('s1', 'u1', 0), row('s2', 'u1', -1), row('s3', 'u1', -2)]);
    const net = slowNetwork();
    const realNow = Date.now;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 10_000);  // 过了一会儿：缓存已超过「刚取过」的间隔
    try {
      const states = [];
      const second = renderHook(() => {
        const r = useStudentData({ today: TODAY });
        states.push({ loading: r.loading, n: r.sessions.length });
        return r;
      });
      // 网络还没回来：立即有数据，从没出现过 loading
      expect(second.result.current.loading).toBe(false);
      expect(second.result.current.sessions).toHaveLength(2);
      expect(states.every((s) => s.loading === false)).toBe(true);

      await act(async () => { net.release(); });
      await waitFor(() => expect(second.result.current.sessions).toHaveLength(3));
      expect(states.every((s) => s.loading === false)).toBe(true);   // 全程没有整页转圈
    } finally { net.restore(); nowSpy.mockRestore(); }
  });

  test('先出最近 91 天（publish 阶段性结果），更早的历史在后台补齐后再给最终结果', async () => {
    login('u1');
    supabase.__setTableData('learning_sessions', [row('new', 'u1', 0), row('old', 'u1', -300)]);
    const publish = jest.fn();
    const full = await fetchStudent('u1', dayStr(0), { publish });
    expect(publish).toHaveBeenCalledTimes(1);
    const partial = publish.mock.calls[0][0];
    expect(partial.historyReady).toBe(false);
    expect(partial.sessions.map((s) => s.id)).toEqual(['new']);        // 只有最近一段
    expect(partial.windowStart).toBe(dayStr(-90));
    expect(full.historyReady).toBe(true);
    expect(full.sessions.map((s) => s.id)).toEqual(['new', 'old']);    // 补齐后完整、顺序不变
  });

  test('hook 最终拿到完整历史', async () => {
    login('u1');
    supabase.__setTableData('learning_sessions', [row('new', 'u1', 0), row('old', 'u1', -300)]);
    const { result } = renderHook(() => useStudentData({ today: TODAY }));
    await waitFor(() => expect(result.current.historyReady).toBe(true));
    expect(result.current.sessions.map((s) => s.id)).toEqual(['new', 'old']);
  });

  test('没有更早的记录：一轮就 historyReady，不发历史分段查询', async () => {
    login('u1');
    supabase.__setTableData('learning_sessions', [row('new', 'u1', -3)]);
    const { result } = renderHook(() => useStudentData({ today: TODAY }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.historyReady).toBe(true);
    const sessionReads = supabase.__getCallHistory().filter((c) => c.method === 'select' && c.table === 'learning_sessions');
    expect(sessionReads).toHaveLength(2);   // 最近一段 + 「更早是否还有」的探测
  });
});

describe('自己的保存 / 删除 / 补填之后，缓存里没有陈旧数据', () => {
  async function mounted() {
    login('u1');
    supabase.__setTableData('learning_sessions', [
      row('keep', 'u1', 0),
      row('prac', 'u1', -1, { category: 3 }),
    ]);
    const hook = renderHook(() => useStudentData({ today: TODAY }));
    await waitFor(() => expect(hook.result.current.historyReady).toBe(true));
    return hook;
  }

  test('保存：新行立刻出现（不等重新取数），且顺序正确', async () => {
    const hook = await mounted();
    const net = slowNetwork();
    try {
      act(() => {
        afterSessionAdded('u1', {
          id: 'added', session_date: dayStr(0), start_time: '15:00:00', duration_minutes: 45,
          category: 3, form: '自主练习', self_rating: 80, grade_label: null, score: null,
          course_id: 'c1', course: { id: 'c1', name: '数学', subject: '', course_type: 1 },
          chapter: null, unit: null,
        });
      });
      expect(hook.result.current.sessions.map((s) => s.id)).toEqual(['added', 'keep', 'prac']);
      expect(hook.result.current.loading).toBe(false);
      expect(hook.result.current.sessions[0].course.name).toBe('数学');
    } finally { net.release(); net.restore(); }
  });

  test('删除：该行立刻消失', async () => {
    const hook = await mounted();
    act(() => { afterSessionDeleted('u1', 'keep'); });
    expect(hook.result.current.sessions.map((s) => s.id)).toEqual(['prac']);
  });

  test('补填：该行立刻带上等第，不再算待补填', async () => {
    const hook = await mounted();
    act(() => { afterSessionGraded('u1', 'prac', { grade_label: 'A-', eval_type: 2 }); });
    const prac = hook.result.current.sessions.find((s) => s.id === 'prac');
    expect(prac.grade_label).toBe('A-');
  });

  test('修补之后仍会后台刷新一次，与数据库对齐', async () => {
    const hook = await mounted();
    // 数据库里其实还多了一条别处写入的
    supabase.__setTableData('learning_sessions', [
      row('prac', 'u1', -1, { category: 3 }), row('other', 'u1', -5),
    ]);
    act(() => { afterSessionDeleted('u1', 'keep'); });
    await waitFor(() => expect(hook.result.current.sessions.map((s) => s.id).sort()).toEqual(['other', 'prac']));
  });
});

describe('按用户隔离：退出再换号，看不到上一个人的数据', () => {
  test('换成 B：B 先转圈、只会看到 B 自己的数据，A 的缓存读不到', async () => {
    login('A');
    supabase.__setTableData('learning_sessions', [row('a-1', 'A', 0), row('b-1', 'B', 0, { duration_minutes: 99 })]);
    const hook = renderHook(() => useStudentData({ today: TODAY }));
    await waitFor(() => expect(hook.result.current.historyReady).toBe(true));
    expect(hook.result.current.sessions.map((s) => s.id)).toEqual(['a-1']);
    expect(peek('A', KEYS.student)).toBeDefined();

    // 退出 → B 登录（同一个浏览器标签）
    setAuthUser(null);
    hook.rerender();
    expect(hook.result.current.sessions).toEqual([]);
    expect(hook.result.current.loading).toBe(true);

    login('B');
    const net = slowNetwork();
    try {
      hook.rerender();
      // B 的数据还没回来：不能出现 A 的行
      expect(hook.result.current.sessions).toEqual([]);
      expect(hook.result.current.loading).toBe(true);
      expect(peek('B', KEYS.student)).toBeUndefined();
      await act(async () => { net.release(); });
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      expect(hook.result.current.sessions.map((s) => s.id)).toEqual(['b-1']);
    } finally { net.restore(); }
  });

  test('退出时清空该用户的缓存之后，再登回 A 也要重新取数', async () => {
    login('A');
    supabase.__setTableData('learning_sessions', [row('a-1', 'A', 0)]);
    const hook = renderHook(() => useStudentData({ today: TODAY }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    clearAllCaches('A');          // useAuth 在退出 / 换号时做的事
    expect(peek('A', KEYS.student)).toBeUndefined();
    expect(peek('A', KEYS.exams)).toBeUndefined();
  });
});
