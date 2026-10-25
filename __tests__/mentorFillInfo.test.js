import {
  buildFillInfo,
  newbieDayStatus,
  sortGroupStudents,
  groupCounts,
  draftKindLabel,
  evidenceLine,
  namesListText,
  formatMD,
  gapLabel,
} from '../src/components/mentor/fillInfo.js';
import { isMissingTable } from '../src/components/mentor/useDrafts.js';

const TODAY = '2026-10-26';
const stu = (id, signup) => ({ id, created_at: `${signup}T09:00:00` });
const info = (student, dates, extra = {}) =>
  buildFillInfo({ student, connected: true, dates, todayIso: TODAY, ...extra });

describe('buildFillInfo', () => {
  it('新生第 13 天，昨天填了：阶段标签 + 绿色「昨天填了」', () => {
    const i = info(stu('a', '2026-10-14'), ['2026-10-25', '2026-10-24', '2026-10-22']);
    expect(i.isNew).toBe(true);
    expect(i.day).toBe(13);
    expect(i.stage).toBe('新生 · 第 13 天');
    expect(i.cell).toEqual({ text: '昨天填了', tone: 'ok' });
    expect(i.summary.count).toBe(3);
    expect(i.lastText).toBe('10/25 · 昨天');
    expect(i.attention).toBeNull();
  });

  it('新生昨天没填：红色「昨天没填」，归入新生昨天没填', () => {
    const i = info(stu('a', '2026-10-06'), ['2026-10-23']);
    expect(i.day).toBe(21);
    expect(i.cell).toEqual({ text: '昨天没填', tone: 'bad' });
    expect(i.attention).toBe('new-missed-yesterday');
    expect(i.lastText).toBe('10/23 · 3 天前');
  });

  it('注册当天（第 1 天）不显示昨天状态', () => {
    const i = info(stu('a', TODAY), []);
    expect(i.day).toBe(1);
    expect(i.cell).toBeNull();
    expect(i.attention).toBeNull();
    expect(i.lastText).toBe('还没有记录');
  });

  it('第 30 天仍是新生，第 31 天起每周', () => {
    expect(info(stu('a', '2026-09-27'), []).isNew).toBe(true);   // 第 30 天
    const late = info(stu('b', '2026-09-26'), ['2026-10-26']);   // 第 31 天
    expect(late.isNew).toBe(false);
    expect(late.stage).toBe('每周');
  });

  it('非新生：3 天及以上才显示「N 天没填」，2 天不提示', () => {
    expect(info(stu('a', '2026-01-01'), ['2026-10-24']).cell).toBeNull();
    const four = info(stu('a', '2026-01-01'), ['2026-10-22']);
    expect(four.cell).toEqual({ text: '4 天没填', tone: 'warn' });
    expect(four.attention).toBe('gap');
  });

  it('非新生从没有记录：「还没有记录」，最后记录显示 —', () => {
    const i = info(stu('a', '2026-01-01'), []);
    expect(i.cell).toEqual({ text: '还没有记录', tone: 'warn' });
    expect(i.attention).toBe('gap');
    expect(i.lastText).toBe('—');
  });

  it('最后记录：今天 / 昨天', () => {
    expect(info(stu('a', '2026-01-01'), ['2026-10-26']).lastText).toBe('10/26 · 今天');
    expect(info(stu('a', '2026-01-01'), ['2026-10-25']).lastText).toBe('10/25 · 昨天');
  });

  it('近 7 天窗口外的最后记录也能算出间隔', () => {
    const i = info(stu('a', '2026-01-01'), ['2026-10-10']);
    expect(i.summary.count).toBe(0);
    expect(i.summary.gap).toBe(16);
    expect(i.cell.text).toBe('16 天没填');
  });

  it('未连接：只返回 connected=false，保留待补填数', () => {
    const i = buildFillInfo({ student: stu('a', '2026-10-14'), connected: false, dates: [], todayIso: TODAY, pending: 2 });
    expect(i).toEqual({ connected: false, pending: 2 });
  });
});

describe('newbieDayStatus', () => {
  it('新生：昨天 / 今天两段状态；非新生为 null', () => {
    const s = newbieDayStatus(info(stu('a', '2026-10-14'), ['2026-10-25']));
    expect(s.yesterday.text).toBe('昨天已填');
    expect(s.today.text).toBe('今天还没填');
    expect(newbieDayStatus(info(stu('b', '2026-01-01'), []))).toBeNull();
  });
});

describe('sortGroupStudents / groupCounts', () => {
  const list = [
    stu('weekly-ok', '2026-01-01'),
    stu('weekly-gap4', '2026-01-01'),
    stu('new-ok', '2026-10-14'),
    stu('new-miss', '2026-10-06'),
    { id: 'invited', created_at: '2026-01-01T00:00:00' },
    stu('weekly-none', '2026-01-01'),
  ];
  const dates = {
    'weekly-ok': ['2026-10-26'],
    'weekly-gap4': ['2026-10-22'],
    'new-ok': ['2026-10-25'],
    'new-miss': ['2026-10-23'],
    'weekly-none': [],
  };
  const infos = {};
  for (const s of list) {
    infos[s.id] = s.id === 'invited'
      ? { connected: false, pending: 0 }
      : info(s, dates[s.id]);
  }
  const infoOf = (id) => infos[id];

  it('已连接在前，新生在前，再按没填天数从多到少，未连接最后', () => {
    const sorted = sortGroupStudents(list, infoOf).map((s) => s.id);
    // 新生：new-miss 间隔 3 天，new-ok 间隔 1 天
    expect(sorted).toEqual(['new-miss', 'new-ok', 'weekly-none', 'weekly-gap4', 'weekly-ok', 'invited']);
  });

  it('同样没填天数时保持原顺序', () => {
    const a = stu('a', '2026-01-01'); const b = stu('b', '2026-01-01');
    const m = { a: info(a, ['2026-10-25']), b: info(b, ['2026-10-25']) };
    expect(sortGroupStudents([b, a], (id) => m[id]).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('组头统计：新生数 / 新生昨天没填 / 3 天以上没填', () => {
    expect(groupCounts(list, infoOf)).toEqual({ total: 6, newCount: 2, newMissed: 1, gapCount: 2 });
  });
});

describe('今日反馈文案', () => {
  it('草稿类型：每日 · 新生第 N 天 / 周报 · 上周', () => {
    const i = info(stu('a', '2026-10-14'), []);
    expect(draftKindLabel({ kind: 'daily' }, i, TODAY)).toBe('每日 · 新生第 13 天');
    expect(draftKindLabel({ kind: 'weekly', period_start: '2026-10-19', period_end: '2026-10-25' }, i, TODAY)).toBe('周报 · 上周');
    expect(draftKindLabel({ kind: 'weekly', period_start: '2026-10-12', period_end: '2026-10-18' }, i, TODAY)).toBe('周报 · 10/12–10/18');
  });

  it('依据：日期 + 课程 + 类别 + 等第；找不到的记录跳过', () => {
    const sessions = {
      s1: { id: 's1', session_date: '2026-10-25', category: 3, grade_label: 'B+', score: null, course: { name: '物理' } },
      s2: { id: 's2', session_date: '2026-10-20', category: 2, grade_label: null, score: null, course: { name: '微积分' } },
    };
    expect(evidenceLine(['s1', 'gone', 's2'], sessions, TODAY)).toBe('昨天 物理 练习 B+ · 10/20 微积分 复习');
    expect(evidenceLine([], sessions, TODAY)).toBe('');
  });

  it('复制名单：纯文本，每人一行', () => {
    const text = namesListText('新生昨天没填', [
      { name: '陈思远', advisor: 'Angela', detail: '新生 · 第 21 天', lastText: '10/23 · 3 天前' },
      { name: '刘佳琪', advisor: null, detail: '新生 · 第 6 天', lastText: '还没有记录' },
    ]);
    expect(text).toBe('新生昨天没填（2 人）\n陈思远（Angela） · 新生 · 第 21 天 · 最后记录 10/23 · 3 天前\n刘佳琪 · 新生 · 第 6 天 · 最后记录 还没有记录');
  });

  it('formatMD / gapLabel', () => {
    expect(formatMD('2026-10-05')).toBe('10/5');
    expect(gapLabel(0)).toBe('今天');
    expect(gapLabel(1)).toBe('昨天');
    expect(gapLabel(5)).toBe('5 天前');
  });
});

describe('isMissingTable', () => {
  it('识别表不存在的几种报错', () => {
    expect(isMissingTable({ code: '42P01', message: 'x' })).toBe(true);
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.supervision_drafts' in the schema cache" })).toBe(true);
    expect(isMissingTable({ message: 'relation "supervision_drafts" does not exist' })).toBe(true);
    expect(isMissingTable({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
