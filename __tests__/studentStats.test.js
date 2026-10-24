import {
  weekRange, minutesByCategory, dailyMinutes, weekOverWeek, computeStreak,
  pendingObjective, subjectBreakdown, calibration, headlineInsight,
} from '../src/lib/studentStats';

// 2024-01-01 是周一：1–7 日 / 8–14 日 / 15–21 日 各为一个 Mon–Sun 周
const row = (date, extra = {}) => ({ session_date: date, duration_minutes: 30, category: 1, ...extra });
const days = (...ds) => ds.map((d) => row(d));

describe('weekRange', () => {
  it('周中、周一、周日都落在同一个周一至周日', () => {
    for (const d of ['2024-01-01', '2024-01-04', '2024-01-07']) {
      expect(weekRange(d)).toEqual({ start: '2024-01-01', end: '2024-01-07' });
    }
  });
  it('跨周边界：周日 → 周一进入下一周', () => {
    expect(weekRange('2024-01-08')).toEqual({ start: '2024-01-08', end: '2024-01-14' });
  });
  it('跨月/跨年', () => {
    expect(weekRange('2024-02-01')).toEqual({ start: '2024-01-29', end: '2024-02-04' });
    expect(weekRange('2025-01-01')).toEqual({ start: '2024-12-30', end: '2025-01-05' });
  });
  it('接受 Date 对象（本地日）', () => {
    expect(weekRange(new Date(2024, 0, 3, 23, 30))).toEqual({ start: '2024-01-01', end: '2024-01-07' });
  });
});

describe('minutesByCategory', () => {
  it('空数据全为 0', () => {
    expect(minutesByCategory([], { start: '2024-01-01', end: '2024-01-07' }))
      .toEqual({ study: 0, review: 0, practice: 0, total: 0 });
    expect(minutesByCategory(undefined, { start: '2024-01-01', end: '2024-01-07' }).total).toBe(0);
  });
  it('按类别汇总，区间两端含边界，区间外和已删除忽略', () => {
    const s = [
      row('2024-01-01', { category: 1, duration_minutes: 10 }),
      row('2024-01-07', { category: 2, duration_minutes: 20 }),
      row('2024-01-07', { category: 3, duration_minutes: 40 }),
      row('2023-12-31', { category: 1, duration_minutes: 99 }),
      row('2024-01-08', { category: 1, duration_minutes: 99 }),
      row('2024-01-03', { category: 1, duration_minutes: 99, deleted_at: '2024-01-04T00:00:00Z' }),
    ];
    expect(minutesByCategory(s, weekRange('2024-01-04')))
      .toEqual({ study: 10, review: 20, practice: 40, total: 70 });
  });
  it('兼容 Review 页派生的 date 字段与 Date 区间', () => {
    const s = [{ date: '2024-01-02', duration_minutes: 15, category: 2 }];
    expect(minutesByCategory(s, { start: new Date(2024, 0, 1), end: new Date(2024, 0, 7) }).review).toBe(15);
  });
});

describe('dailyMinutes', () => {
  it('每天一项，缺失日为 0，同日累加', () => {
    const s = [row('2024-01-02', { duration_minutes: 20 }), row('2024-01-02', { duration_minutes: 25 })];
    expect(dailyMinutes(s, '2024-01-01', '2024-01-03')).toEqual([
      { date: '2024-01-01', minutes: 0 },
      { date: '2024-01-02', minutes: 45 },
      { date: '2024-01-03', minutes: 0 },
    ]);
  });
  it('空数据仍返回完整日期序列', () => {
    expect(dailyMinutes([], '2024-01-01', '2024-01-07')).toHaveLength(7);
  });
});

describe('weekOverWeek', () => {
  it('空数据', () => {
    expect(weekOverWeek([], '2024-01-10')).toEqual({ thisWeek: 0, lastWeek: 0, diff: 0, lastWeekToDate: 0 });
  });
  it('周日记录算上周，周一算本周（周边界）', () => {
    const s = [row('2024-01-07'), row('2024-01-08'), row('2024-01-09')];
    const r = weekOverWeek(s, '2024-01-10');
    expect(r.thisWeek).toBe(60);
    expect(r.lastWeek).toBe(30);
    expect(r.diff).toBe(30);
  });
  it('lastWeekToDate 只统计上周同一天为止', () => {
    const s = [row('2024-01-01'), row('2024-01-02'), row('2024-01-06')];
    expect(weekOverWeek(s, '2024-01-10').lastWeekToDate).toBe(60);
    expect(weekOverWeek(s, '2024-01-10').lastWeek).toBe(90);
  });
  it('不含上上周与已删除', () => {
    const s = [row('2023-12-31'), row('2024-01-09', { deleted_at: 'x' })];
    expect(weekOverWeek(s, '2024-01-10')).toMatchObject({ thisWeek: 0, lastWeek: 0 });
  });
});

describe('computeStreak', () => {
  it('空数据', () => {
    expect(computeStreak([], '2024-01-10')).toMatchObject({
      current: 0, restDaysUsedThisWeek: 0, restDaysLeftThisWeek: 2, restDates: [],
    });
  });
  it('连续每天有记录，且可超过 7 天（跨周）', () => {
    const s = days('2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05',
      '2024-01-06', '2024-01-07', '2024-01-08', '2024-01-09', '2024-01-10');
    const r = computeStreak(s, '2024-01-10');
    expect(r.current).toBe(10);
    expect(r.restDates).toEqual([]);
    expect(r.todayDone).toBe(true);
  });
  it('今天还没记录不断：从昨天起算，也不消耗休息日', () => {
    const r = computeStreak(days('2024-01-08', '2024-01-09'), '2024-01-10');
    expect(r.current).toBe(2);
    expect(r.todayDone).toBe(false);
    expect(r.restDates).toEqual([]);
    expect(r.restDaysLeftThisWeek).toBe(2);
    expect(r.atRisk).toBe(false);
  });
  it('每周最多 2 个休息日不断，休息日不计天数', () => {
    // 周一 记、周二 休、周三 记、周四 休、周五 记（今天）
    const r = computeStreak(days('2024-01-01', '2024-01-03', '2024-01-05'), '2024-01-05');
    expect(r.current).toBe(3);
    expect(r.restDates).toEqual(['2024-01-02', '2024-01-04']);
    expect(r.restDaysUsedThisWeek).toBe(2);
    expect(r.restDaysLeftThisWeek).toBe(0);
  });
  it('同一周第 3 个空白日断开连续', () => {
    // 周一 记，周二三四 空，周五 记（今天）→ 周五 + 到不了周一
    const r = computeStreak(days('2024-01-01', '2024-01-05'), '2024-01-05');
    expect(r.current).toBe(1);
    expect(r.restDates).toEqual([]);
  });
  it('休息日额度按自然周分别计算（周日/周一不共用）', () => {
    // 上周 周四 记，周五周六 休；周日 记；本周 周一周二 休；周三 记（今天）
    const s = days('2024-01-04', '2024-01-07', '2024-01-10');
    const r = computeStreak(s, '2024-01-10');
    expect(r.current).toBe(3);
    expect(r.restDates).toEqual(['2024-01-05', '2024-01-06', '2024-01-08', '2024-01-09']);
    expect(r.restDaysUsedThisWeek).toBe(2);
  });
  it('最早记录之前的空白不算休息日', () => {
    const r = computeStreak(days('2024-01-04', '2024-01-05'), '2024-01-05');
    expect(r.current).toBe(2);
    expect(r.restDates).toEqual([]);
    expect(r.restDaysLeftThisWeek).toBe(2);
  });
  it('末端被断开处之前的休息日不计入', () => {
    // 周一 记；周二三四 空（断）；周五 记 → 只有周五
    expect(computeStreak(days('2024-01-01', '2024-01-05'), '2024-01-05').restDates).toEqual([]);
  });
  it('一次错过不会清零连续（本周 7 天窗口问题的回归）', () => {
    // 过去 3 周每周 5 天有记录（周末休），今天周三
    const s = [];
    for (const start of ['2023-12-18', '2023-12-25', '2024-01-01']) {
      for (let i = 0; i < 5; i++) {
        const d = new Date(Date.UTC(...start.split('-').map(Number).map((n, k) => (k === 1 ? n - 1 : n))) + i * 86400000);
        s.push(row(d.toISOString().slice(0, 10)));
      }
    }
    const r = computeStreak(s, '2024-01-05');
    expect(r.current).toBe(15);
  });
  it('已删除记录不计；未来日期的记录忽略', () => {
    const s = [row('2024-01-09', { deleted_at: 'x' }), row('2024-01-11')];
    expect(computeStreak(s, '2024-01-10').current).toBe(0);
  });
  it('休息日已用完且今天还没记 → atRisk', () => {
    // 周一 记，周二周三 休，今天（周四）空
    const r = computeStreak(days('2024-01-01'), '2024-01-04');
    expect(r.current).toBe(1);
    expect(r.restDaysLeftThisWeek).toBe(0);
    expect(r.atRisk).toBe(true);
    expect(computeStreak(days('2024-01-01', '2024-01-04'), '2024-01-04').atRisk).toBe(false);
  });
  it('Date 对象作为 today', () => {
    expect(computeStreak(days('2024-01-02'), new Date(2024, 0, 2, 12)).current).toBe(1);
  });
  it('同一天多条记录只算一天', () => {
    expect(computeStreak(days('2024-01-02', '2024-01-02', '2024-01-02'), '2024-01-02').current).toBe(1);
  });
});

describe('pendingObjective', () => {
  const base = { category: 3, grade_label: null, score: null, deleted_at: null };
  it('空数据', () => expect(pendingObjective([])).toEqual([]));
  it('只保留 练习 + 无等第 + 无分数 + 未删除', () => {
    const keep = { id: 1, ...base };
    const rows = [
      keep,
      { id: 2, ...base, grade_label: 'A' },
      { id: 3, ...base, grade_label: 'N/A' },
      { id: 4, ...base, score: 90 },
      { id: 5, ...base, deleted_at: '2024-01-01T00:00:00Z' },
      { id: 6, ...base, category: 1 },
      { id: 7, ...base, category: 2 },
      { id: 8, category: 3 }, // 字段缺失视为空
    ];
    expect(pendingObjective(rows).map((r) => r.id)).toEqual([1, 8]);
  });
  it('score = 0 不算空', () => {
    expect(pendingObjective([{ ...base, score: 0 }])).toEqual([]);
  });
});

describe('subjectBreakdown', () => {
  it('空数据', () => expect(subjectBreakdown([], { start: '2024-01-01', end: '2024-01-07' })).toEqual([]));
  it('按课程与类别汇总并降序', () => {
    const s = [
      row('2024-01-01', { subject: '数学', category: 1, duration_minutes: 30 }),
      row('2024-01-02', { subject: '数学', category: 3, duration_minutes: 20 }),
      row('2024-01-02', { course: { name: '物理' }, category: 2, duration_minutes: 60 }),
      row('2024-01-09', { subject: '数学', duration_minutes: 500 }),
    ];
    expect(subjectBreakdown(s, { start: '2024-01-01', end: '2024-01-07' })).toEqual([
      { course: '物理', study: 0, review: 60, practice: 0, total: 60 },
      { course: '数学', study: 30, review: 0, practice: 20, total: 50 },
    ]);
  });
});

describe('calibration', () => {
  const today = '2024-01-28';
  const p = (date, self, grade, extra = {}) =>
    row(date, { category: 3, subject: '数学', self_rating: self, grade_label: grade, ...extra });

  it('空数据', () => expect(calibration([], { today })).toEqual([]));
  it('自评 80 对 B+ 为一致（与录入默认值同刻度）', () => {
    const r = calibration([p('2024-01-20', 80, 'B+')], { today });
    expect(r[0]).toMatchObject({ course: '数学', n: 1, verdict: '一致' });
    expect(r[0].gap).toBeCloseTo(0);
  });
  it('自评远高于成绩 → 偏乐观；远低于成绩 → 偏保守', () => {
    expect(calibration([p('2024-01-20', 100, 'C')], { today })[0].verdict).toBe('偏乐观');
    expect(calibration([p('2024-01-20', 40, 'A')], { today })[0].verdict).toBe('偏保守');
  });
  it('排除 N/A、空等第、非练习、已删除、无自评', () => {
    const rows = [
      p('2024-01-20', 100, 'N/A'),
      p('2024-01-21', 100, null),
      p('2024-01-22', 100, 'D', { category: 1 }),
      p('2024-01-23', 100, 'D', { deleted_at: 'x' }),
      p('2024-01-24', null, 'D'),
    ];
    expect(calibration(rows, { today })).toEqual([]);
  });
  it('只看近 4 周（含今天共 28 天）', () => {
    expect(calibration([p('2023-12-31', 100, 'F')], { today })).toEqual([]);
    expect(calibration([p('2024-01-01', 100, 'F')], { today })).toHaveLength(1);
    expect(calibration([p('2023-12-31', 100, 'F')], { today, weeks: 5 })).toHaveLength(1);
  });
  it('按课程平均', () => {
    const rows = [p('2024-01-20', 100, 'A+'), p('2024-01-21', 20, 'F'), p('2024-01-22', 100, 'F', { subject: '英语' })];
    const r = calibration(rows, { today });
    expect(r.find((x) => x.course === '数学')).toMatchObject({ n: 2, verdict: '一致' });
    expect(r.find((x) => x.course === '英语').verdict).toBe('偏乐观');
  });
});

describe('headlineInsight', () => {
  it('空数据 → 引导记第一次', () => {
    const r = headlineInsight([], '2024-01-10');
    expect(r.title).toBe('还没有学习记录');
    expect(r.action.log).toEqual({});
  });
  it('连续 ≥3 天、休息日用完、今天未记 → 断档风险', () => {
    // 上周 二三四五 记；本周 周一 记，周二周三 休，周四 记；今天周五空，本周休息日已用完
    const s = days('2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08', '2024-01-11');
    const r = headlineInsight(s, '2024-01-12');
    expect(r.title).toContain('今天还没有记录');
  });
  it('复习占比远低于前 4 周平均', () => {
    const rows = [];
    for (let i = 1; i <= 4; i++) { // 前几周每周一条复习 60 + 学习 60
      rows.push(row(`2024-01-0${i}`, { category: 2, duration_minutes: 60 }));
      rows.push(row(`2024-01-0${i}`, { category: 1, duration_minutes: 60 }));
    }
    rows.push(row('2024-01-15', { category: 1, duration_minutes: 90 }));
    rows.push(row('2024-01-16', { category: 2, duration_minutes: 5 }));
    expect(headlineInsight(rows, '2024-01-16').title).toBe('本周复习偏少');
  });
  it('前 4 周学过的课本周周三起仍无记录', () => {
    const rows = [
      row('2024-01-03', { subject: '数学', course_id: 'abc', duration_minutes: 60 }),
      row('2024-01-10', { subject: '数学', course_id: 'abc', duration_minutes: 60 }),
      row('2024-01-15', { subject: '英语', course_id: 'def', duration_minutes: 60 }),
      row('2024-01-16', { subject: '英语', course_id: 'def', duration_minutes: 60 }),
      row('2024-01-17', { subject: '英语', course_id: 'def', duration_minutes: 60 }),
    ];
    const r = headlineInsight(rows, '2024-01-17');
    expect(r.title).toBe('数学 本周还没有记录');
    expect(r.action.log).toEqual({ courseId: 'abc' });
  });
  it('周一/周二不触发「某课没记录」', () => {
    const rows = [
      row('2024-01-03', { subject: '数学', duration_minutes: 60 }),
      row('2024-01-15', { subject: '英语', duration_minutes: 60 }),
    ];
    expect(headlineInsight(rows, '2024-01-16').title).not.toContain('数学');
  });
  it('兜底：本周 vs 上周同期，不含任何目标措辞', () => {
    const rows = [row('2024-01-09', { duration_minutes: 30 }), row('2024-01-16', { duration_minutes: 90 })];
    const r = headlineInsight(rows, '2024-01-16');
    expect(r.title).toBe('本周已记录 1 小时 30 分钟');
    expect(r.detail).toBe('比上周同期多 1 小时。');
    expect(`${r.title}${r.detail}${r.action.label}`).not.toMatch(/目标|还差/);
  });
  it('已删除的记录不参与', () => {
    expect(headlineInsight([row('2024-01-10', { deleted_at: 'x' })], '2024-01-10').title).toBe('还没有学习记录');
  });
});
