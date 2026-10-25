import {
  detectWeeklyIssues, runSupervisionJob, regenerateDraft, evidenceIds, inQuietHours,
  MAX_DRAFTS_PER_RUN,
} from '../api-lib/supervision.mjs';

// 2026-10-26 是周一；上海 10:00。上一整周 = 10/19（周一）– 10/25（周日）
const MON = new Date('2026-10-26T02:00:00Z');
const TUE = new Date('2026-10-27T02:00:00Z');
const TODAY = '2026-10-26';
const YESTERDAY = '2026-10-25';
const WEEK = { start: '2026-10-19', end: '2026-10-25' };

let rid = 0;
const rec = (student_id, session_date, extra = {}) => ({
  id: `r${++rid}`,
  student_id,
  session_date,
  start_time: '19:00:00',
  end_time: '19:45:00',
  course_id: 'c-phy',
  course: '物理',
  chapter: '牛顿定律',
  unit: '受力分析',
  category: 1,
  form: '自主复习',
  duration_minutes: 45,
  self_rating: 60,
  grade_label: null,
  notes: null,
  ...extra,
});

/** 内存版 store，接口与 createSupabaseStore 一致 */
function fakeStore({ students = [], records = [], drafts = [], connections = [] } = {}) {
  const state = { drafts: [...drafts], inserted: [], loads: [] };
  return {
    state,
    async listScopeStudents() { return students; },
    async getProfile(id) { return students.find((s) => s.id === id) || null; },
    async listDraftStudentIds(kind, periodStart) {
      return new Set(state.drafts.filter((d) => d.kind === kind && d.period_start === periodStart).map((d) => d.student_id));
    },
    async loadRecords(ids, from, to) {
      state.loads.push({ ids, from, to });
      return records.filter((r) => ids.includes(r.student_id) && r.session_date >= from && r.session_date <= to);
    },
    async insertDraft(row) {
      const dup = state.drafts.some((d) => d.student_id === row.student_id && d.kind === row.kind && d.period_start === row.period_start);
      if (dup) return null;
      const full = { id: `d${state.drafts.length + 1}`, status: 'draft', edited_body: null, ...row };
      state.drafts.push(full);
      state.inserted.push(full);
      return full;
    },
    async getDraft(id) { return state.drafts.find((d) => d.id === id) || null; },
    async updateDraft(id, patch) {
      const d = state.drafts.find((x) => x.id === id);
      Object.assign(d, patch);
      return d;
    },
    async hasActiveConnection(t, s) { return connections.some((c) => c.teacher_id === t && c.student_id === s && c.status === 1); },
  };
}

const stubGenerate = () => jest.fn(async () => ({ text: '昨天物理受力分析那节课记上了。', evidence: [1] }));
const ENV = { LLM_MODEL: 'test-model' };
const run = (store, generate, extra = {}) => runSupervisionJob({ store, generate, env: ENV, now: MON, ...extra });

// 注册日期：相对 TODAY
const signedUp = (daysAgo) => `${new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86400000).toISOString().slice(0, 10)}T08:00:00Z`;

describe('每日草稿：谁会得到', () => {
  test('新生昨天填了 → 一份 daily 草稿；证据映射回记录 id，model 取环境里的模型名', async () => {
    const r = rec('s1', YESTERDAY);
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }], records: [r] });
    const gen = stubGenerate();
    const out = await run(store, gen);
    expect(out).toMatchObject({ created: 1, daily: 1, failed: 0 });
    expect(store.state.inserted[0]).toMatchObject({
      student_id: 's1', kind: 'daily', period_start: YESTERDAY, period_end: YESTERDAY,
      body: '昨天物理受力分析那节课记上了。', evidence: [r.id], model: 'test-model',
    });
    // 给模型的输入：第 6 天、记录用名称、不含学生 id / 姓名
    const input = gen.mock.calls[0][0];
    expect(input).toMatchObject({ kind: 'daily', dayN: 6 });
    expect(input.records[0]).toMatchObject({ course: '物理', chapter: '牛顿定律', unit: '受力分析' });
    expect(JSON.stringify(input)).not.toMatch(/s1|student_id|r\d+"/);
  });

  test('注册第 1 天（今天注册）不出草稿；昨天没填的新生也不出', async () => {
    const store = fakeStore({
      students: [
        { id: 'day1', created_at: signedUp(0) },
        { id: 'missed', created_at: signedUp(5) },
      ],
      records: [rec('day1', TODAY), rec('day1', YESTERDAY), rec('missed', '2026-10-24')],
    });
    const gen = stubGenerate();
    const out = await run(store, gen);
    expect(out.created).toBe(0);
    expect(gen).not.toHaveBeenCalled();
  });

  test('只用昨天的记录：更早或今天的记录不算', async () => {
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(10) }],
      records: [rec('s1', '2026-10-23'), rec('s1', TODAY)],
    });
    expect((await run(store, stubGenerate())).created).toBe(0);
  });

  test('第 30 天仍是每日；第 31 天起改成每周（周一出周小结，不再出每日）', async () => {
    const store = fakeStore({
      students: [{ id: 'd30', created_at: signedUp(29) }, { id: 'd31', created_at: signedUp(30) }],
      records: [rec('d30', YESTERDAY), rec('d31', YESTERDAY)],
    });
    await run(store, stubGenerate());
    expect(store.state.inserted.map((d) => `${d.student_id}:${d.kind}`).sort()).toEqual(['d30:daily', 'd31:weekly']);
  });
});

describe('每周草稿：只在周一', () => {
  const students = [{ id: 'w1', created_at: signedUp(60) }];
  const records = [rec('w1', '2026-10-20'), rec('w1', '2026-10-22')];

  test('周一：非新生上一整周有记录 → 一份 weekly 草稿，period 是上周一到上周日', async () => {
    const store = fakeStore({ students, records });
    const gen = stubGenerate();
    const out = await run(store, gen);
    expect(out).toMatchObject({ created: 1, weekly: 1 });
    expect(store.state.inserted[0]).toMatchObject({ kind: 'weekly', period_start: WEEK.start, period_end: WEEK.end });
    expect(gen.mock.calls[0][0].kind).toBe('weekly');
  });

  test('周二：不生成周报', async () => {
    const store = fakeStore({ students, records });
    const gen = stubGenerate();
    const out = await runSupervisionJob({ store, generate: gen, env: ENV, now: TUE });
    expect(out.created).toBe(0);
    expect(gen).not.toHaveBeenCalled();
  });

  test('上一整周一条记录都没有 → 不出草稿（即使更早有记录）', async () => {
    const store = fakeStore({ students, records: [rec('w1', '2026-10-10')] });
    expect((await run(store, stubGenerate())).created).toBe(0);
  });

  test('只算已连接（status=1）的 role 1 学生：不在名单里的学生不处理', async () => {
    const store = fakeStore({ students: [], records });
    expect((await run(store, stubGenerate())).created).toBe(0);
  });
});

describe('幂等、上限、静默时段', () => {
  test('重复运行不会重复生成（已有草稿先跳过；插入撞唯一键返回 null 也不计数）', async () => {
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }], records: [rec('s1', YESTERDAY)] });
    const gen = stubGenerate();
    expect((await run(store, gen)).created).toBe(1);
    const again = await run(store, gen);
    expect(again.created).toBe(0);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(store.state.drafts).toHaveLength(1);

    // 并发：名单里没看到，但插入时撞唯一键
    const racy = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }], records: [rec('s1', YESTERDAY)] });
    racy.listDraftStudentIds = async () => new Set();
    racy.state.drafts.push({ id: 'x', student_id: 's1', kind: 'daily', period_start: YESTERDAY });
    expect((await run(racy, stubGenerate())).created).toBe(0);
  });

  test(`一次运行最多 ${MAX_DRAFTS_PER_RUN} 份，剩下的下一轮接着做`, async () => {
    const students = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, created_at: signedUp(5) }));
    const records = students.map((s) => rec(s.id, YESTERDAY));
    const store = fakeStore({ students, records });
    const gen = stubGenerate();
    const first = await run(store, gen);
    expect(first.created).toBe(15);
    expect(first.skipped).toEqual({ cap: true });
    const second = await run(store, gen);
    expect(second.created).toBe(5);
    expect(store.state.drafts).toHaveLength(20);
  });

  test('超过时间预算后不再开始新的', async () => {
    const students = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, created_at: signedUp(5) }));
    const store = fakeStore({ students, records: students.map((s) => rec(s.id, YESTERDAY)) });
    let t = 0;
    const clock = () => (t += 20000); // 每次读时钟前进 20 秒
    const out = await run(store, stubGenerate(), { clock });
    expect(out.created).toBeLessThan(5);
    expect(out.skipped).toEqual({ time: true });
  });

  test('连续 3 次生成失败就停（模型挂了不要一直打），失败的下一轮会重试', async () => {
    const students = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, created_at: signedUp(5) }));
    const store = fakeStore({ students, records: students.map((s) => rec(s.id, YESTERDAY)) });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const gen = jest.fn(async () => { throw new Error('模型请求失败'); });
    const out = await run(store, gen);
    expect(out).toMatchObject({ created: 0, failed: 3, skipped: { failures: true } });
    expect(store.state.drafts).toHaveLength(0);
    console.error.mockRestore();
  });

  test('上海时间 23:00–06:00 不运行', async () => {
    expect(inQuietHours(new Date('2026-10-26T15:00:00Z'))).toBe(true); // 23:00
    expect(inQuietHours(new Date('2026-10-25T21:59:00Z'))).toBe(true); // 05:59
    expect(inQuietHours(new Date('2026-10-25T22:00:00Z'))).toBe(false); // 06:00
    expect(inQuietHours(new Date('2026-10-26T14:59:00Z'))).toBe(false); // 22:59
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }], records: [rec('s1', YESTERDAY)] });
    const gen = stubGenerate();
    const out = await runSupervisionJob({ store, generate: gen, env: ENV, now: new Date('2026-10-26T16:00:00Z') });
    expect(out.skipped).toEqual({ quiet: true });
    expect(gen).not.toHaveBeenCalled();
  });
});

describe('周报要提的问题（代码判定）', () => {
  const S = 'w1';
  const plan = (extra = {}) => rec(S, '2026-10-20', { category: 3, ...extra });
  // 每天一条，避免触发「连续没记录」
  const everyDay = () => ['19', '20', '21', '22', '23', '24', '25'].map((d) => rec(S, `2026-10-${d}`, { course_id: 'c-eng', course: '英语' }));

  test('什么问题都没有 → []', () => {
    expect(detectWeeklyIssues(everyDay(), WEEK)).toEqual([]);
  });

  test('自评基本掌握以上、实测 B- 及以下 → 按课程说明', () => {
    const rows = [
      ...everyDay(),
      plan({ self_rating: 80, grade_label: 'B-' }),
      plan({ self_rating: 100, grade_label: 'C+', session_date: '2026-10-21' }),
      plan({ self_rating: 80, grade_label: 'B', session_date: '2026-10-22' }), // B 不算
      plan({ self_rating: 60, grade_label: 'D', session_date: '2026-10-23' }), // 自评低不算
    ];
    expect(detectWeeklyIssues(rows, WEEK)).toEqual(['物理有 2 次练习自评是基本掌握以上，实测只有 B-、C+']);
  });

  test('练习的实测还没填 → 按课程计数；N/A 不算没填', () => {
    const rows = [
      ...everyDay(),
      plan(),
      plan({ session_date: '2026-10-21' }),
      plan({ session_date: '2026-10-22', grade_label: 'N/A' }),
      rec(S, '2026-10-23', { category: 1 }), // 不是练习
    ];
    expect(detectWeeklyIssues(rows, WEEK)).toEqual(['物理有 2 次练习的实测还没填']);
  });

  test('前三周有记录、这周没有的课程', () => {
    const rows = [
      ...everyDay(),
      rec(S, '2026-10-05', { course_id: 'c-geo', course: '地理' }),
      rec(S, '2026-09-27', { course_id: 'c-old', course: '化学' }), // 超出前三周
    ];
    expect(detectWeeklyIssues(rows, WEEK)).toEqual(['地理前三周都有记录，上周一条都没有']);
  });

  test('一周内连续 ≥ 3 天没记录：写出星期和日期；2 天不算', () => {
    const rows = ['19', '20', '21'].map((d) => rec(S, `2026-10-${d}`));
    expect(detectWeeklyIssues(rows, WEEK)).toEqual(['周四到周日（10/22–10/25）连续 4 天没有记录']);

    const two = ['19', '20', '21', '24'].map((d) => rec(S, `2026-10-${d}`)); // 周四五（22、23）只空 2 天，周日 25 空 1 天
    expect(detectWeeklyIssues(two, WEEK)).toEqual([]);
  });

  test('中间一段也能识别，并且最多返回 4 条', () => {
    const rows = [rec(S, '2026-10-19'), rec(S, '2026-10-23'), rec(S, '2026-10-24'), rec(S, '2026-10-25')];
    expect(detectWeeklyIssues(rows, WEEK)[0]).toBe('周二到周四（10/20–10/22）连续 3 天没有记录');

    const many = [
      rec(S, '2026-10-19', { category: 3, course_id: 'a', course: 'A', self_rating: 80, grade_label: 'C' }),
      rec(S, '2026-10-19', { category: 3, course_id: 'b', course: 'B' }),
      rec(S, '2026-10-05', { course_id: 'g', course: '地理' }),
    ];
    expect(detectWeeklyIssues(many, WEEK).length).toBeLessThanOrEqual(4);
  });

  test('问题随草稿一起交给模型（issues），没有问题时传空数组', async () => {
    const withIssue = fakeStore({
      students: [{ id: S, created_at: signedUp(60) }],
      records: [rec(S, '2026-10-19'), rec(S, '2026-10-20', { category: 3 })],
    });
    const gen = stubGenerate();
    await run(withIssue, gen);
    expect(gen.mock.calls[0][0].issues).toEqual(expect.arrayContaining(['物理有 1 次练习的实测还没填']));
    // 历史（前 3 周）也被一起读取，用来判断「某课这周没有」
    expect(withIssue.state.loads[0].from).toBe('2026-09-28');

    const clean = fakeStore({ students: [{ id: S, created_at: signedUp(60) }], records: everyDay() });
    const gen2 = stubGenerate();
    await run(clean, gen2);
    expect(gen2.mock.calls[0][0].issues).toEqual([]);
  });
});

describe('Supabase REST store', () => {
  const { createSupabaseStore } = require('../api-lib/supervision.mjs');
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

  test('loadRecords 展开课程 / 章节 / 单元名称并只读未删除记录；insertDraft 撞唯一键返回 null', async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (url.includes('learning_sessions')) {
        return reply(200, [{ id: 'r1', student_id: 's1', session_date: '2026-10-25', courses: { name: '物理' }, chapters: null, units: { name: '受力分析' } }]);
      }
      if (url.includes('supervision_drafts') && init.method === 'POST') return reply(409, { code: '23505' });
      return reply(200, []);
    });
    const store = createSupabaseStore({ url: 'https://p.supabase.co/', serviceKey: 'svc', fetchImpl });
    const rows = await store.loadRecords(['s1'], '2026-10-25', '2026-10-25');
    expect(rows).toEqual([expect.objectContaining({ id: 'r1', course: '物理', chapter: '', unit: '受力分析' })]);
    expect(rows[0]).not.toHaveProperty('courses');
    expect(calls[0].url).toContain('deleted_at=is.null');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer svc');
    await expect(store.insertDraft({ student_id: 's1' })).resolves.toBeNull();
  });
});

describe('其他', () => {
  test('evidenceIds：1 基序号 → id，去重，越界丢弃', () => {
    expect(evidenceIds([1, 3, 1, 9, 0], [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual(['a', 'c']);
  });

  test('regenerateDraft：覆盖 body、清掉导师改过的版本、状态回到 draft', async () => {
    const r = rec('s1', YESTERDAY);
    const draft = {
      id: 'd1', student_id: 's1', kind: 'daily', period_start: YESTERDAY, period_end: YESTERDAY,
      body: '旧', edited_body: '导师改过', status: 'skipped', handled_by: 't1', handled_at: 'x', evidence: [],
    };
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }], records: [r], drafts: [draft] });
    const gen = jest.fn(async () => ({ text: '新稿', evidence: [1] }));
    const out = await regenerateDraft({ store, draft, generate: gen, env: ENV, now: MON });
    expect(out).toMatchObject({ body: '新稿', edited_body: null, status: 'draft', handled_by: null, evidence: [r.id], model: 'test-model' });
    expect(gen.mock.calls[0][0].dayN).toBe(6);
  });

  test('regenerateDraft：这一期已经没有记录 → 409', async () => {
    const draft = { id: 'd1', student_id: 's1', kind: 'daily', period_start: YESTERDAY, period_end: YESTERDAY };
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }], records: [], drafts: [draft] });
    await expect(regenerateDraft({ store, draft, generate: stubGenerate(), env: ENV })).rejects.toMatchObject({ status: 409 });
  });
});
