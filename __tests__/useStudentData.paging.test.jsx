import { renderHook, waitFor } from '@testing-library/react';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { useStudentData } from '../src/lib/useStudentData.js';

// 按 91 天一段并行取近两年的记录：每段 [from, to) 首尾相接——不能漏行也不能重复行；
// 课程被软删除 / 取不到（course 为 null）的行不能让 Today / Insights 崩。

function dayStr(base, n) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fakeSessionsQuery(rows, ranges) {
  const q = { f: {} };
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, order: () => chain,
    gte: (_c, v) => { q.f.gte = v; return chain; },
    lt: (_c, v) => { q.f.lt = v; return chain; },
    limit: (n) => { q.f.limit = n; return chain; },
    then: (resolve) => {
      ranges.push([q.f.gte, q.f.lt]);
      const data = rows.filter(r => r.session_date >= q.f.gte && r.session_date < q.f.lt).slice(0, q.f.limit);
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return chain;
}

test('分段取数：每个日期只出现一次，今天和 730 天前的边界都在', async () => {
  const today = new Date(2026, 9, 26, 0, 20); // 本地 00:20，UTC 上仍是前一天——不能差一天
  const rows = [];
  for (let n = -730; n <= 0; n++) rows.push({ id: `s${n}`, session_date: dayStr(today, n), start_time: '09:00:00', duration_minutes: 30, category: 1, course: n % 7 === 0 ? null : { id: 'c', name: '数学', course_type: 1 } });
  const ranges = [];
  setAuthUser({ id: 'u1' });
  setAuthProfile({ id: 'u1' });
  const origFrom = supabase.from.bind(supabase);
  const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => (
    t === 'learning_sessions' ? fakeSessionsQuery(rows, ranges) : origFrom(t)
  ));
  try {
    const { result } = renderHook(() => useStudentData({ today }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    const dates = result.current.sessions.map(s => s.session_date);
    expect(new Set(dates).size).toBe(dates.length);          // 无重复
    expect(dates).toHaveLength(rows.length);                  // 无遗漏
    expect(dates[0]).toBe('2026-10-26');                      // 本地今天，不是 UTC 昨天
    expect(dates[dates.length - 1]).toBe(dayStr(today, -730));
    // 段与段首尾相接
    const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) expect(sorted[i][0]).toBe(sorted[i - 1][1]);
    expect(sorted[sorted.length - 1][1]).toBe('2026-10-27');
  } finally { spy.mockRestore(); }
});
