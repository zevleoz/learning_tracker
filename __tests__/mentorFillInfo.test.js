import { renderHook, waitFor, act } from '@testing-library/react';
import { supabase } from '../src/__mocks__/supabase';
import { toLocalDateStr } from '../src/lib/date.js';
import { addDays } from '../src/lib/supervision.js';
import {
  buildFillInfo,
  firstMonthDayStatus,
  sortGroupStudents,
  groupCounts,
  draftKindLabel,
  weekBoardRow,
  evidenceLine,
  namesListText,
  formatMD,
  gapLabel,
} from '../src/components/mentor/fillInfo.js';
import {
  useDrafts,
  isMissingTable,
  isMissingColumn,
  nextAltText,
} from '../src/components/mentor/useDrafts.js';

const TODAY = '2026-10-26';
const stu = (id, signup) => ({ id, created_at: `${signup}T09:00:00`, full_name: id });
const info = (student, dates, extra = {}) =>
  buildFillInfo({ student, connected: true, dates, todayIso: TODAY, ...extra });

describe('buildFillInfo', () => {
  it('首月第 13 天，昨天填了：阶段标签 + 绿色「昨天填了」', () => {
    const i = info(stu('a', '2026-10-14'), ['2026-10-25', '2026-10-24', '2026-10-22']);
    expect(i.isNew).toBe(true);
    expect(i.day).toBe(13);
    expect(i.stage).toBe('首月 · 第 13 天');
    expect(i.cell).toEqual({ text: '昨天填了', tone: 'ok' });
    expect(i.summary.count).toBe(3);
    expect(i.lastText).toBe('10/25 · 昨天');
    expect(i.attention).toBeNull();
  });

  it('首月昨天没填：红色「昨天没填」，归入首月昨天没填', () => {
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

  it('第 30 天仍是首月，第 31 天起每周看', () => {
    expect(info(stu('a', '2026-09-27'), []).isNew).toBe(true);   // 第 30 天
    const late = info(stu('b', '2026-09-26'), ['2026-10-26']);   // 第 31 天
    expect(late.isNew).toBe(false);
    expect(late.stage).toBe('每周看');
  });

  it('非首月：3 天及以上才显示「N 天没填」，2 天不提示', () => {
    expect(info(stu('a', '2026-01-01'), ['2026-10-24']).cell).toBeNull();
    const four = info(stu('a', '2026-01-01'), ['2026-10-22']);
    expect(four.cell).toEqual({ text: '4 天没填', tone: 'warn' });
    expect(four.attention).toBe('gap');
  });

  it('非首月从没有记录：「还没有记录」，最后记录显示 —', () => {
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

describe('firstMonthDayStatus', () => {
  it('首月：昨天 / 今天两段状态；非首月为 null', () => {
    const s = firstMonthDayStatus(info(stu('a', '2026-10-14'), ['2026-10-25']));
    expect(s.yesterday.text).toBe('昨天已填');
    expect(s.today.text).toBe('今天还没填');
    expect(firstMonthDayStatus(info(stu('b', '2026-01-01'), []))).toBeNull();
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

  it('已连接在前，首月在前，再按没填天数从多到少，未连接最后', () => {
    const sorted = sortGroupStudents(list, infoOf).map((s) => s.id);
    // 首月：new-miss 间隔 3 天，new-ok 间隔 1 天
    expect(sorted).toEqual(['new-miss', 'new-ok', 'weekly-none', 'weekly-gap4', 'weekly-ok', 'invited']);
  });

  it('同样没填天数时保持原顺序', () => {
    const a = stu('a', '2026-01-01'); const b = stu('b', '2026-01-01');
    const m = { a: info(a, ['2026-10-25']), b: info(b, ['2026-10-25']) };
    expect(sortGroupStudents([b, a], (id) => m[id]).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('组头统计：首月数 / 首月昨天没填 / 3 天以上没填', () => {
    expect(groupCounts(list, infoOf)).toEqual({ total: 6, newCount: 2, newMissed: 1, gapCount: 2 });
  });
});

describe('这周谁记了（weekBoardRow）', () => {
  const row = (student, dates, draft = null, extra = {}) =>
    weekBoardRow(
      { id: student.id, name: '小满', school_name: '平和双语', mentorName: '陈老师', created_at: student.created_at, ...extra },
      info(student, dates, extra.infoExtra || {}),
      draft,
      TODAY,
    );

  it('首月学生：7 天状态、阶段、最后记录、待发消息', () => {
    const r = row(stu('a', '2026-10-14'), ['2026-10-25', '2026-10-20', '2026-10-26']);
    expect(r.days).toHaveLength(7);
    expect(r.days[0].date).toBe('2026-10-20');
    expect(r.days[0].state).toBe('f');
    expect(r.days[6].date).toBe(TODAY);
    expect(r.days[6].state).toBe('f');
    expect(r.days[5].state).toBe('f');
    expect(r.days[4].state).toBe('e');
    expect(r.stageText).toBe('首月 · 第 13 天');
    expect(r.stateText).toBe('正常');
    expect(r.warn).toBe(false);
    expect(r.subText).toBe('今天已经记了');
    expect(r.lastText).toBe('10/26 · 今天');
    expect(r.name).toBe('小满');
    expect(r.school).toBe('平和双语');
    expect(r.mentorName).toBe('陈老师');
    expect(r.draft).toBeNull();
  });

  it('注册前的日期是 n，今天没记是 t；待发草稿原样带出', () => {
    const draft = { id: 'd1', kind: 'daily' };
    const r = row(stu('a', '2026-10-24'), [], draft);
    expect(r.days.slice(0, 4).every((d) => d.state === 'n')).toBe(true);
    expect(r.days[4].state).toBe('e');
    expect(r.days[5].state).toBe('e');
    expect(r.days[6].state).toBe('t');
    expect(r.stageText).toBe('首月 · 第 3 天');
    expect(r.stateText).toBe('还没开始记');
    expect(r.warn).toBe(true); // 首月第 3 天还没记过 → 要跟进
    expect(r.subText).toBe('注册后一条都没有');
    expect(r.draft).toBe(draft);
  });

  it('首月第 1 天还没记：不催，不进要跟进', () => {
    const r = row(stu('a', TODAY), []);
    expect(r.stateText).toBe('还没开始记');
    expect(r.warn).toBe(false);
    expect(r.stageText).toBe('首月 · 第 1 天');
  });

  it('7 天都记：每天都记；有实测待补时优先显示', () => {
    const dates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];
    const r = row(stu('a', '2026-01-01'), dates, null, { infoExtra: { pending: 2 } });
    expect(r.days.every((d) => d.state === 'f')).toBe(true);
    expect(r.stateText).toBe('每天都记');
    expect(r.subText).toBe('实测待补 2 条');
    expect(r.stageText).toBe('每周看');
  });

  it('3 天以上没记：N 天没记 + 要跟进', () => {
    const r = row(stu('a', '2026-01-01'), ['2026-10-22']);
    expect(r.stateText).toBe('4 天没记');
    expect(r.warn).toBe(true);
    expect(r.lastText).toBe('10/22 · 4 天前');
    expect(r.subText).toBe('今天还没记');
  });

  it('未连接：没有记录状态，阶段仍按注册日算', () => {
    const student = stu('a', '2026-10-14');
    const r = weekBoardRow(
      { id: student.id, name: '小满', created_at: student.created_at },
      buildFillInfo({ student, connected: false, dates: [], todayIso: TODAY }),
      null,
      TODAY,
    );
    expect(r.days[6].state).toBe('t');
    expect(r.days[5].state).toBe('e');
    expect(r.stateText).toBe('还没开始记');
    expect(r.subText).toBe('');
    expect(r.lastText).toBe('—');
  });
});

describe('消息类型文案', () => {
  it('每日表扬 / 周小结 / 周小结 + 提醒 / 提醒', () => {
    expect(draftKindLabel({ kind: 'daily' })).toBe('每日表扬');
    expect(draftKindLabel({ kind: 'weekly' })).toBe('周小结');
    expect(draftKindLabel({ kind: 'weekly', meta: { nudge: true } })).toBe('周小结 + 提醒');
    expect(draftKindLabel({ kind: 'nudge' })).toBe('提醒');
  });
});

describe('换说法（nextAltText）', () => {
  const d = (body, alts, edited = null) => ({ body, edited_body: edited, meta: { alts } });

  it('从原稿往下换；到最后一条返回 null', () => {
    const draft = d('原稿', ['说法一', '说法二']);
    expect(nextAltText(draft)).toBe('说法一');
    expect(nextAltText(d('原稿', ['说法一', '说法二'], '说法一'))).toBe('说法二');
    expect(nextAltText(d('原稿', ['说法一', '说法二'], '说法二'))).toBeNull();
  });

  it('没有备选返回 null；手改过的正文从第一条备选开始', () => {
    expect(nextAltText(d('原稿', []))).toBeNull();
    expect(nextAltText({ body: '原稿', edited_body: null, meta: {} })).toBeNull();
    expect(nextAltText(d('原稿', ['说法一', '说法二'], '我自己改的'))).toBe('说法一');
  });
});

describe('依据 / 复制名单 / 日期文案', () => {
  it('依据：日期 + 课程 + 类别 + 等第；找不到的记录跳过', () => {
    const sessions = {
      s1: { id: 's1', session_date: '2026-10-25', category: 3, grade_label: 'B+', score: null, course: { name: '物理' } },
      s2: { id: 's2', session_date: '2026-10-20', category: 2, grade_label: null, score: null, course: { name: '微积分' } },
    };
    expect(evidenceLine(['s1', 'gone', 's2'], sessions, TODAY)).toBe('昨天 物理 练习 B+ · 10/20 微积分 复习');
    expect(evidenceLine([], sessions, TODAY)).toBe('');
  });

  it('复制名单：纯文本，每人一行', () => {
    const text = namesListText('首月昨天没填', [
      { name: '陈思远', advisor: 'Angela', detail: '首月 · 第 21 天', lastText: '10/23 · 3 天前' },
      { name: '刘佳琪', advisor: null, detail: '首月 · 第 6 天', lastText: '还没有记录' },
    ]);
    expect(text).toBe('首月昨天没填（2 人）\n陈思远（Angela） · 首月 · 第 21 天 · 最后记录 10/23 · 3 天前\n刘佳琪 · 首月 · 第 6 天 · 最后记录 还没有记录');
  });

  it('formatMD / gapLabel', () => {
    expect(formatMD('2026-10-05')).toBe('10/5');
    expect(gapLabel(0)).toBe('今天');
    expect(gapLabel(1)).toBe('昨天');
    expect(gapLabel(5)).toBe('5 天前');
  });
});

describe('草稿表的报错识别', () => {
  it('识别表不存在的几种报错', () => {
    expect(isMissingTable({ code: '42P01', message: 'x' })).toBe(true);
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.supervision_drafts' in the schema cache" })).toBe(true);
    expect(isMissingTable({ message: 'relation "supervision_drafts" does not exist' })).toBe(true);
    expect(isMissingTable({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });

  it('识别 v2 字段不存在的几种报错', () => {
    expect(isMissingColumn({ code: '42703', message: 'x' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204', message: "Could not find the 'snooze_until' column of 'supervision_drafts' in the schema cache" })).toBe(true);
    expect(isMissingColumn({ message: 'column "meta" does not exist' })).toBe(true);
    expect(isMissingColumn({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });
});

describe('useDrafts（C3）', () => {
  const baseDraft = (over = {}) => ({
    id: 'd-open', student_id: 's1', kind: 'daily', status: 'draft',
    body: '原稿', edited_body: null, evidence: [], meta: { alts: ['说法一', '说法二'] },
    handled_by: null, handled_at: null, snooze_until: null, skip_reason: null,
    created_at: `${toLocalDateStr(new Date())}T07:00:00`, ...over,
  });
  const updates = () => supabase.__getCallHistory().filter((c) => c.method === 'update' && c.table === 'supervision_drafts');

  function seed() {
    const today = toLocalDateStr(new Date());
    supabase.__setTableData('profiles', [
      { id: 'u1', full_name: '我' },
      { id: 'u2', full_name: '李老师' },
    ]);
    supabase.__setTableData('supervision_drafts', [
      baseDraft(),
      baseDraft({
        id: 'd-sent', status: 'sent', handled_by: 'u2', handled_at: `${today}T09:00:00`, body: '已发的一条',
      }),
      baseDraft({
        id: 'd-old', status: 'sent', handled_by: 'u2', handled_at: '2020-01-01T09:00:00',
        created_at: '2020-01-01T07:00:00',
      }),
    ]);
    return today;
  }

  async function mount() {
    const view = renderHook(() => useDrafts({
      supabase,
      getAccessToken: async () => 'token',
      userId: 'u1',
      studentIds: ['s1'],
    }));
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    return view;
  }

  beforeEach(() => {
    supabase.__resetMocks();
  });

  it('读取待发 + 今天处理过的，带 snooze_until / skip_reason / meta', async () => {
    seed();
    const { result } = await mount();
    expect(result.current.drafts.map((d) => d.id).sort()).toEqual(['d-open', 'd-sent']);
    expect(result.current.drafts.find((d) => d.id === 'd-open').meta.alts).toEqual(['说法一', '说法二']);
    expect(result.current.handlerName('u1')).toBe('你');
    expect(result.current.handlerName('u2')).toBe('李老师');
    expect(result.current.handlerName('nobody')).toBe('—');
  });

  it('表或 v2 字段不存在：status = unavailable，不报错', async () => {
    const realFrom = supabase.from;
    const missing = {
      select: () => missing, in: () => missing, eq: () => missing, gte: () => missing,
      order: () => missing, limit: () => missing,
      then: (resolve) => resolve({ data: null, error: { code: '42703', message: 'column "meta" does not exist' } }),
    };
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => (
      t === 'supervision_drafts' ? missing : realFrom.call(supabase, t)
    ));
    const { result } = renderHook(() => useDrafts({
      supabase, getAccessToken: async () => 'token', userId: 'u1', studentIds: ['s1'],
    }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.drafts).toEqual([]);
    spy.mockRestore();
  });

  it('复制即已发：本地折叠成 sent；撤销回到 draft 并清空处理信息', async () => {
    seed();
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = await mount();
    const open = result.current.drafts.find((d) => d.id === 'd-open');

    let copied;
    await act(async () => { copied = await result.current.copyAndSend(open, null); });
    expect(copied).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('原稿');
    await waitFor(() => expect(result.current.drafts.find((d) => d.id === 'd-open').status).toBe('sent'));
    expect(updates()[0].args).toMatchObject({ status: 'sent', handled_by: 'u1' });

    const sent = result.current.drafts.find((d) => d.id === 'd-open');
    await act(async () => { await result.current.undo(sent); });
    await waitFor(() => expect(result.current.drafts.find((d) => d.id === 'd-open').status).toBe('draft'));
    expect(updates()[1].args).toEqual({
      status: 'draft', handled_by: null, handled_at: null, snooze_until: null, skip_reason: null,
    });
  });

  it('过几天再说：只接受 3 / 5 / 7 天，snooze_until = 今天 + days', async () => {
    const today = seed();
    const { result } = await mount();
    const open = result.current.drafts.find((d) => d.id === 'd-open');

    let ok;
    await act(async () => { ok = await result.current.snooze(open, 3); });
    expect(ok).toBe(true);
    await waitFor(() => expect(result.current.drafts.find((d) => d.id === 'd-open').status).toBe('snoozed'));
    expect(result.current.drafts.find((d) => d.id === 'd-open').snooze_until).toBe(addDays(today, 3));
    expect(updates()[0].args).toMatchObject({ status: 'snoozed', snooze_until: addDays(today, 3) });

    let bad;
    await act(async () => { bad = await result.current.snooze(open, 4); });
    expect(bad).toBe(false);
    expect(updates()).toHaveLength(1);
  });

  it('不用发 + 跳过原因', async () => {
    seed();
    const { result } = await mount();
    const open = result.current.drafts.find((d) => d.id === 'd-open');

    await act(async () => { await result.current.skip(open); });
    await waitFor(() => expect(result.current.drafts.find((d) => d.id === 'd-open').status).toBe('skipped'));

    const skipped = result.current.drafts.find((d) => d.id === 'd-open');
    await act(async () => { await result.current.setSkipReason(skipped, '请假了'); });
    await waitFor(() => expect(result.current.drafts.find((d) => d.id === 'd-open').skip_reason).toBe('请假了'));
    expect(updates()[1].args).toEqual({ skip_reason: '请假了' });

    let bad;
    await act(async () => { bad = await result.current.setSkipReason(skipped, '随便写的'); });
    expect(bad).toBe(false);
  });

  it('换说法：依次写 edited_body，用完返回 null', async () => {
    seed();
    const { result } = await mount();
    const open = result.current.drafts.find((d) => d.id === 'd-open');

    let first;
    await act(async () => { first = await result.current.nextAlt(open); });
    expect(first).toBe('说法一');
    await waitFor(() => expect(result.current.drafts.find((d) => d.id === 'd-open').edited_body).toBe('说法一'));

    let second;
    const draft2 = result.current.drafts.find((d) => d.id === 'd-open');
    await act(async () => { second = await result.current.nextAlt(draft2); });
    expect(second).toBe('说法二');

    let end;
    const draft3 = result.current.drafts.find((d) => d.id === 'd-open');
    await act(async () => { end = await result.current.nextAlt(draft3); });
    expect(end).toBeNull();
  });

  it('发过的消息：最近 30 天，不含待发和已丢弃', async () => {
    seed();
    const { result } = await mount();
    let history;
    await act(async () => { history = await result.current.loadHistory('s1'); });
    expect(history.map((d) => d.id)).toEqual(['d-sent']);
  });

  it('重新生成遇到 409：悄悄移掉这条，不显示错误', async () => {
    seed();
    const { result } = await mount();
    const open = result.current.drafts.find((d) => d.id === 'd-open');
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ status: 409, ok: false, json: async () => ({ error: '已丢弃' }) }));
    try {
      let ok;
      await act(async () => { ok = await result.current.regenerate(open); });
      expect(ok).toBe(true);
      expect(result.current.drafts.some((d) => d.id === 'd-open')).toBe(false);
      expect(result.current.errors['d-open']).toBeUndefined();
    } finally {
      global.fetch = realFetch;
    }
  });
});
