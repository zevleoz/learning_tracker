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
function fakeStore({
  students = [], records = [], drafts = [], connections = [], exams = [], pushes = [], mutes = [],
} = {}) {
  const state = { drafts: drafts.map((d) => ({ status: 'draft', meta: {}, created_at: '2026-10-20T02:00:00Z', ...d })), inserted: [], loads: [], dropped: [] };
  const inIds = (ids) => (d) => ids.includes(d.student_id);
  const isNudge = (d) => d.kind === 'nudge' || d.meta?.nudge === true;
  return {
    state,
    async listScopeStudents() { return students; },
    async listActiveMuteIds(today) {
      return new Set(mutes
        .filter((m) => m.mode === 'hidden' || (m.mode === 'snoozed' && m.until && m.until >= today))
        .map((m) => m.student_id));
    },
    async getProfile(id) { return students.find((s) => s.id === id) || null; },
    async listDraftStudentIds(kind, start, end = start) {
      return new Set(state.drafts.filter((d) => d.kind === kind && (d.period_start === start || d.period_end === end)).map((d) => d.student_id));
    },
    async loadRecords(ids, from, to) {
      state.loads.push({ ids, from, to });
      return records.filter((r) => ids.includes(r.student_id) && r.session_date >= from && r.session_date <= to);
    },
    async loadSessionDates(ids, from, to) {
      return records.filter((r) => ids.includes(r.student_id) && r.session_date >= from && r.session_date <= to)
        .map((r) => ({ student_id: r.student_id, session_date: r.session_date }));
    },
    async listOpenDrafts(ids) {
      return state.drafts.filter((d) => inIds(ids)(d) && ['draft', 'snoozed'].includes(d.status));
    },
    async listDueSnoozed(today) {
      return state.drafts.filter((d) => d.status === 'snoozed' && d.snooze_until <= today);
    },
    async lastNudgeSentAt(ids) {
      const out = new Map();
      for (const d of state.drafts) {
        if (!inIds(ids)(d) || !isNudge(d) || !['sent', 'snoozed', 'skipped'].includes(d.status) || !d.handled_at) continue;
        if (!out.has(d.student_id) || d.handled_at > out.get(d.student_id)) out.set(d.student_id, d.handled_at);
      }
      return out;
    },
    async lastSent(id) {
      const sent = state.drafts.filter((d) => d.student_id === id && d.status === 'sent').sort((a, b) => b.handled_at.localeCompare(a.handled_at))[0];
      return sent ? { text: sent.edited_body || sent.body, date: sent.handled_at.slice(0, 10) } : null;
    },
    async styleRefs(id) {
      return state.drafts.filter((d) => d.student_id === id && d.edited_body && d.edited_body !== d.body)
        .slice(0, 3).map((d) => ({ before: d.body, after: d.edited_body }));
    },
    async rejected(id) {
      return state.drafts.filter((d) => d.student_id === id && d.status === 'skipped' && d.skip_reason === '这条写得不合适')
        .slice(0, 2).map((d) => d.body);
    },
    async recentInactivePush(ids, since) {
      const out = new Map();
      for (const p of pushes) if (ids.includes(p.user_id) && p.sent_date >= since && (!out.has(p.user_id) || p.sent_date > out.get(p.user_id))) out.set(p.user_id, p.sent_date);
      return out;
    },
    async loadExams(ids, from, to) {
      return exams.filter((e) => ids.includes(e.student_id) && e.date >= from && e.date <= to);
    },
    async dropDrafts(ids, reason) {
      let n = 0;
      for (const d of state.drafts) {
        if (!ids.includes(d.id) || !['draft', 'snoozed'].includes(d.status)) continue;
        Object.assign(d, { status: 'dropped', meta: { ...d.meta, drop_reason: reason } });
        state.dropped.push(d.id);
        n += 1;
      }
      return n;
    },
    async insertDraft(row) {
      const dup = state.drafts.some((d) => d.student_id === row.student_id && d.kind === row.kind && d.period_start === row.period_start);
      if (dup) return null;
      const full = {
        id: `d${state.drafts.length + 1}`, status: 'draft', edited_body: null, meta: {}, created_at: MON.toISOString(), ...row,
      };
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
    // 没有每日表扬；'missed'（第 6 天，前天之后一直没记）只会得到一条提醒
    expect(out).toMatchObject({ daily: 0, weekly: 0, nudge: 1 });
    expect(store.state.inserted.map((d) => `${d.student_id}:${d.kind}`)).toEqual(['missed:nudge']);
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
    expect(out.weekly).toBe(0);
    expect(gen.mock.calls.some(([i]) => i.kind === 'weekly')).toBe(false);
  });

  test('上一整周一条记录都没有 → 不出周小结（即使更早有记录）；断了很久，由提醒接手', async () => {
    const store = fakeStore({ students, records: [rec('w1', '2026-10-10')] });
    const out = await run(store, stubGenerate());
    expect(out).toMatchObject({ weekly: 0, nudge: 1 });
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
    expect(withIssue.state.loads[0].from).toBe('2026-09-19'); // 周一的 30 天窗口，已覆盖前 3 周

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

// ===========================================================================
// 消息草稿 v2
// ===========================================================================
const { createSupabaseStore, DROP_SUPERSEDED, DROP_RECORDED, DROP_MUTED } = require('../api-lib/supervision.mjs');

let gseq = 0;
/** 返回 C2 形状：text / alts / evidence / facts / why / lint */
const richGen = (over = {}) => jest.fn(async (input) => ({
  text: `第${++gseq}号稿：${input.kind}`,
  alts: ['备选一', '备选二'],
  evidence: [1],
  facts: ['概况一行'],
  why: `理由-${input.kind}`,
  lint: [],
  ...over,
}));
const runTue = (store, generate, extra = {}) => runSupervisionJob({ store, generate, env: ENV, now: TUE, ...extra });
const draftRow = (o) => ({
  period_start: o.period_end || YESTERDAY, period_end: YESTERDAY, body: '旧稿', created_at: '2026-10-24T02:00:00Z', ...o,
});
const byId = (store, id) => store.state.drafts.find((d) => d.id === id);
const openOf = (store, sid) => store.state.drafts.filter((d) => d.student_id === sid && d.status === 'draft');
const WEEKLY = (id) => ({ id, created_at: signedUp(60) }); // 首月之后

describe('v2 · 一人最多一条 draft', () => {
  test('新草稿写入后，旧的 draft 被撤下并记原因；库里只剩一条 draft', async () => {
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(5) }],
      records: [rec('s1', YESTERDAY)],
      drafts: [draftRow({ id: 'old', student_id: 's1', kind: 'daily', period_start: '2026-10-23', period_end: '2026-10-23' })],
    });
    const out = await run(store, richGen());
    expect(out).toMatchObject({ created: 1, daily: 1, dropped: 1 });
    expect(byId(store, 'old')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_SUPERSEDED } });
    expect(openOf(store, 's1')).toHaveLength(1);
    expect(openOf(store, 's1')[0].period_start).toBe(YESTERDAY);
  });

  test('v1 遗留的多条 draft：只留最新一条，其余撤下，且不为此调用模型', async () => {
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(5) }],
      records: [rec('s1', YESTERDAY)],
      drafts: [
        draftRow({ id: 'd1', student_id: 's1', kind: 'daily', period_start: '2026-10-24', period_end: '2026-10-24', created_at: '2026-10-25T02:00:00Z' }),
        draftRow({ id: 'd2', student_id: 's1', kind: 'daily', period_start: YESTERDAY, period_end: YESTERDAY, created_at: '2026-10-26T01:00:00Z' }),
      ],
    });
    const gen = richGen();
    await run(store, gen);
    expect(byId(store, 'd1').status).toBe('dropped');
    expect(byId(store, 'd2').status).toBe('draft');
    expect(gen).not.toHaveBeenCalled();
  });

  test('已被导师处理的（sent）不会被撤下', async () => {
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(5) }],
      records: [rec('s1', YESTERDAY)],
      drafts: [draftRow({ id: 'was-sent', student_id: 's1', kind: 'daily', period_start: '2026-10-23', period_end: '2026-10-23', status: 'sent', handled_at: '2026-10-24T05:00:00Z' })],
    });
    await run(store, richGen());
    expect(byId(store, 'was-sent').status).toBe('sent');
  });
});

describe('v2 · 提醒（nudge）谁会得到', () => {
  test('首月：昨天没记（隔 ≥2 天）或第 3 天起从没记过；记过 / 第 2 天还没记的不提醒', async () => {
    const store = fakeStore({
      students: [
        { id: 'f2', created_at: signedUp(10) }, // 最后一次 10/24，gap 2
        { id: 'f1', created_at: signedUp(10) }, // 昨天记了，gap 1 → 只有每日表扬
        { id: 'never2', created_at: signedUp(1) }, // 第 2 天，还没记 → 不提醒
        { id: 'never3', created_at: signedUp(2) }, // 第 3 天，从没记 → 提醒
      ],
      records: [rec('f2', '2026-10-24'), rec('f1', YESTERDAY)],
    });
    const gen = richGen();
    const out = await run(store, gen);
    expect(out).toMatchObject({ nudge: 2, daily: 1 });
    expect(store.state.inserted.filter((d) => d.kind === 'nudge').map((d) => d.student_id).sort()).toEqual(['f2', 'never3']);
    const never = gen.mock.calls.map(([i]) => i).find((i) => i.nudge?.neverRecorded);
    expect(never).toMatchObject({
      kind: 'nudge', today: TODAY, dayN: 3, records: [], context: [], combineNudge: false,
      nudge: { neverRecorded: true, phase: 'first-month' },
    });
    const f2 = store.state.inserted.find((d) => d.student_id === 'f2' && d.kind === 'nudge');
    expect(f2).toMatchObject({ period_start: TODAY, period_end: TODAY });
    expect(f2.evidence).toHaveLength(1); // 序号 1 指向 context 里的记录（[...records, ...context]）
  });

  test('首月之后：连续 3 天没记才提醒，上下文是前 30 天的记录', async () => {
    const store = fakeStore({
      students: [WEEKLY('w3'), WEEKLY('w2'), WEEKLY('never')],
      records: [rec('w3', '2026-10-24'), rec('w3', '2026-10-01'), rec('w2', '2026-10-25')],
    });
    const gen = richGen();
    const out = await runTue(store, gen);
    expect(out.nudge).toBe(2);
    expect(store.state.inserted.map((d) => d.student_id).sort()).toEqual(['never', 'w3']);
    const w3 = gen.mock.calls.map(([i]) => i).find((i) => i.context.length === 2);
    expect(w3).toMatchObject({ kind: 'nudge', records: [], nudge: { neverRecorded: false, phase: 'weekly' } });
    expect(w3.context.map((r) => r.session_date)).toEqual(['2026-10-01', '2026-10-24']);
  });

  test('两次提醒至少隔 3 天：2 天前发过 / 昨天跳过 / 压着一条推迟 / 周小结顺带提醒过的都不再提醒；3 天前的可以', async () => {
    const students = ['a', 'b', 'c', 'd', 'e', 'f'].map(WEEKLY);
    const mk = (id, sid, extra) => draftRow({ id, student_id: sid, kind: 'nudge', period_start: '2026-10-20', period_end: '2026-10-20', ...extra });
    const store = fakeStore({
      students,
      records: students.map((s) => rec(s.id, '2026-10-22')), // 都已经 5 天没记
      drafts: [
        mk('na', 'a', { status: 'sent', handled_at: '2026-10-25T03:00:00Z' }), // 2 天前
        mk('nb', 'b', { status: 'sent', handled_at: '2026-10-24T03:00:00Z' }), // 3 天前 → 放行
        mk('nc', 'c', { status: 'skipped', handled_at: '2026-10-26T03:00:00Z', skip_reason: '请假了' }),
        draftRow({ id: 'nd', student_id: 'd', kind: 'daily', period_start: '2026-10-20', period_end: '2026-10-20', status: 'snoozed', snooze_until: '2026-11-01', handled_at: '2026-10-20T03:00:00Z' }),
        draftRow({ id: 'ne', student_id: 'e', kind: 'weekly', period_start: '2026-10-12', period_end: '2026-10-18', status: 'sent', handled_at: '2026-10-26T03:00:00Z', meta: { nudge: true } }),
      ],
    });
    const out = await runTue(store, richGen());
    expect(out.nudge).toBe(2);
    expect(store.state.inserted.map((d) => d.student_id).sort()).toEqual(['b', 'f']);
  });

  test('间隔只管提醒，不管表扬：昨天刚发过提醒，今天照样出每日表扬', async () => {
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(5) }],
      records: [rec('s1', YESTERDAY)],
      drafts: [draftRow({ id: 'n', student_id: 's1', kind: 'nudge', period_start: '2026-10-24', period_end: '2026-10-24', status: 'sent', handled_at: '2026-10-25T03:00:00Z' })],
    });
    expect((await run(store, richGen())).daily).toBe(1);
  });

  test('手上已经有一条没处理的提醒 → 不再出第二条；前几天没处理的每日表扬会被今天的提醒顶掉', async () => {
    const store = fakeStore({
      students: [WEEKLY('hasNudge'), { id: 'hasDaily', created_at: signedUp(10) }],
      records: [rec('hasNudge', '2026-10-20'), rec('hasDaily', '2026-10-24')],
      drafts: [
        draftRow({ id: 'n1', student_id: 'hasNudge', kind: 'nudge', period_start: '2026-10-25', period_end: '2026-10-25', created_at: '2026-10-25T03:00:00Z' }),
        draftRow({ id: 'dd', student_id: 'hasDaily', kind: 'daily', period_start: '2026-10-24', period_end: '2026-10-24', created_at: '2026-10-25T03:00:00Z' }),
      ],
    });
    const out = await runTue(store, richGen());
    expect(out.nudge).toBe(1);
    expect(byId(store, 'n1').status).toBe('draft');
    expect(byId(store, 'dd')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_SUPERSEDED } });
    expect(openOf(store, 'hasDaily')[0].kind).toBe('nudge');
  });

  test('系统推送过（昨天或今天）→ meta.system_push_date + recommend_snooze 3；更早的推送不算', async () => {
    const store = fakeStore({
      students: [WEEKLY('p'), WEEKLY('q')],
      records: [rec('p', '2026-10-20'), rec('q', '2026-10-20')],
      pushes: [{ user_id: 'p', sent_date: '2026-10-26' }, { user_id: 'q', sent_date: '2026-10-24' }],
    });
    await runTue(store, richGen());
    const meta = (id) => store.state.inserted.find((d) => d.student_id === id).meta;
    expect(meta('p')).toMatchObject({ system_push_date: '2026-10-26', recommend_snooze: 3 });
    expect(meta('q')).not.toHaveProperty('system_push_date');
    expect(meta('q')).not.toHaveProperty('recommend_snooze');
  });

  test('meta 带上 why / facts / alts / lint；模型没返回这些字段时给默认值', async () => {
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }, { id: 's2', created_at: signedUp(5) }], records: [rec('s1', YESTERDAY), rec('s2', YESTERDAY)] });
    const gen = jest.fn()
      .mockResolvedValueOnce({ text: 'A', evidence: [1], alts: ['x', 'y'], facts: ['f'], why: '昨天记了 1 条', lint: ['小问题'] })
      .mockResolvedValueOnce({ text: 'B', evidence: [1] });
    await run(store, gen);
    expect(store.state.inserted[0].meta).toEqual({ why: '昨天记了 1 条', facts: ['f'], alts: ['x', 'y'], lint: ['小问题'] });
    expect(store.state.inserted[1].meta).toEqual({ why: '', facts: [], alts: [], lint: [] });
  });

  test('同一轮里前面写过的开头会传给后面的草稿（avoidOpenings）', async () => {
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(5) }, { id: 's2', created_at: signedUp(5) }], records: [rec('s1', YESTERDAY), rec('s2', YESTERDAY)] });
    const gen = jest.fn()
      .mockResolvedValueOnce({ text: '昨天物理记得很认真。', evidence: [1] })
      .mockResolvedValueOnce({ text: '另一句。', evidence: [1] });
    await run(store, gen);
    expect(gen.mock.calls[0][0].avoidOpenings).toEqual([]);
    expect(gen.mock.calls[1][0].avoidOpenings).toEqual(['昨天物理记得很认']); // 前 8 个字
  });

  test('一次运行的总上限对提醒同样有效；静默时段不跑', async () => {
    const students = Array.from({ length: 20 }, (_, i) => WEEKLY(`g${i}`));
    const store = fakeStore({ students, records: students.map((s) => rec(s.id, '2026-10-20')) });
    const first = await runTue(store, richGen());
    expect(first).toMatchObject({ nudge: 15, skipped: { cap: true } });
    expect((await runTue(store, richGen())).nudge).toBe(5);
    const quiet = richGen();
    const out = await runSupervisionJob({ store: fakeStore({ students, records: [] }), generate: quiet, env: ENV, now: new Date('2026-10-26T16:00:00Z') });
    expect(out.skipped).toEqual({ quiet: true });
    expect(quiet).not.toHaveBeenCalled();
  });

  test('给模型的输入带上 lastSent / styleRefs / rejected / exams，并且不含学生 id', async () => {
    const store = fakeStore({
      students: [{ id: 'sx', created_at: signedUp(5) }],
      records: [rec('sx', YESTERDAY)],
      exams: [{ student_id: 'sx', date: '2026-10-20', course: '数学', name: '月考', grade_label: 'B+', score: 88, notes: null }],
      drafts: [
        draftRow({ id: 'a', student_id: 'sx', kind: 'daily', period_start: '2026-10-20', period_end: '2026-10-20', status: 'sent', body: '原稿', edited_body: '导师改的', handled_at: '2026-10-21T03:00:00Z' }),
        draftRow({ id: 'b', student_id: 'sx', kind: 'daily', period_start: '2026-10-22', period_end: '2026-10-22', status: 'skipped', body: '不合适的稿', skip_reason: '这条写得不合适', handled_at: '2026-10-23T03:00:00Z' }),
      ],
    });
    const gen = richGen();
    await run(store, gen);
    const input = gen.mock.calls[0][0];
    expect(input).toMatchObject({
      lastSent: { text: '导师改的', date: '2026-10-21' },
      styleRefs: [{ before: '原稿', after: '导师改的' }],
      rejected: ['不合适的稿'],
      exams: [{ date: '2026-10-20', course: '数学', name: '月考', grade_label: 'B+', score: 88, notes: null }],
    });
    expect(JSON.stringify(input)).not.toContain('sx');
  });
});

describe('v2 · 自动撤下', () => {
  test('提醒发出后学生自己记了 → 撤下（含周小结里顺带提醒的、推迟中的）；没记的、不是提醒的不动', async () => {
    const nd = (id, sid, extra = {}) => draftRow({ id, student_id: sid, kind: 'nudge', period_start: '2026-10-23', period_end: '2026-10-23', created_at: '2026-10-23T02:00:00Z', ...extra });
    const store = fakeStore({
      students: [WEEKLY('a'), WEEKLY('b'), WEEKLY('c'), WEEKLY('d')],
      records: [rec('a', YESTERDAY), rec('b', '2026-10-10'), rec('c', YESTERDAY), rec('d', '2026-10-24')],
      drafts: [
        nd('na', 'a'),
        nd('nb', 'b'),
        draftRow({ id: 'wc', student_id: 'c', kind: 'weekly', period_start: WEEK.start, period_end: WEEK.end, created_at: '2026-10-23T02:00:00Z', meta: { nudge: true } }),
        nd('nd', 'd', { status: 'snoozed', snooze_until: '2026-11-01', handled_at: '2026-10-23T05:00:00Z' }),
      ],
    });
    const out = await run(store, richGen());
    for (const id of ['na', 'wc', 'nd']) {
      expect(byId(store, id)).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_RECORDED } });
    }
    expect(byId(store, 'nb').status).toBe('draft');
    expect(out.dropped).toBeGreaterThanOrEqual(3);
  });
});

describe('v2 · 隐藏 / 暂停学生', () => {
  test('隐藏 / 暂停中的学生本轮不出草稿；名下 draft / snoozed 草稿撤下（DROP_MUTED）', async () => {
    const store = fakeStore({
      students: [
        { id: 'hidden', created_at: signedUp(5) },
        { id: 'snoozed', created_at: signedUp(5) },
        { id: 'expired', created_at: signedUp(5) },
        { id: 'normal', created_at: signedUp(5) },
      ],
      records: ['hidden', 'snoozed', 'expired', 'normal'].map((id) => rec(id, YESTERDAY)),
      drafts: [
        draftRow({ id: 'dh', student_id: 'hidden', kind: 'daily', period_start: '2026-10-22', period_end: '2026-10-22' }),
        draftRow({
          id: 'ds', student_id: 'snoozed', kind: 'nudge', period_start: '2026-10-22', period_end: '2026-10-22',
          status: 'snoozed', snooze_until: TODAY, handled_at: '2026-10-22T03:00:00Z',
        }),
      ],
      mutes: [
        { student_id: 'hidden', mode: 'hidden', until: null },
        { student_id: 'snoozed', mode: 'snoozed', until: TODAY },  // 今天到期，仍生效
        { student_id: 'expired', mode: 'snoozed', until: '2026-10-25' }, // 已过期 → 回到主列表
      ],
    });
    const gen = richGen();
    const out = await run(store, gen);
    expect(store.state.inserted.map((d) => d.student_id).sort()).toEqual(['expired', 'normal']);
    expect(store.state.inserted.map((d) => d.kind)).toEqual(['daily', 'daily']);
    expect(gen.mock.calls.map(([i]) => i.kind)).toEqual(['daily', 'daily']);
    expect(byId(store, 'dh')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_MUTED } });
    expect(byId(store, 'ds')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_MUTED } });
    expect(out).toMatchObject({ created: 2, daily: 2, dropped: 2 });
  });

  test('暂停到期后（until < 今天）这位学生自动恢复生成；隐藏仍然永久生效', async () => {
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(5) }],
      records: [rec('s1', YESTERDAY)],
      mutes: [{ student_id: 's1', mode: 'snoozed', until: '2026-10-25' }],
    });
    const gen = richGen();
    expect((await run(store, gen)).daily).toBe(1);
    expect(gen).toHaveBeenCalledTimes(1);

    const stillHidden = fakeStore({
      students: [{ id: 's1', created_at: signedUp(5) }],
      records: [rec('s1', YESTERDAY)],
      mutes: [{ student_id: 's1', mode: 'hidden', until: null }],
    });
    const gen2 = richGen();
    expect((await run(stillHidden, gen2)).created).toBe(0);
    expect(gen2).not.toHaveBeenCalled();
  });
});

describe('v2 · 过几天再说到期', () => {
  const snoozed = (o) => draftRow({
    status: 'snoozed', snooze_until: TODAY, handled_by: 't1', handled_at: '2026-10-21T05:00:00Z',
    edited_body: '手改的', created_at: '2026-10-21T02:00:00Z', meta: { why: '旧理由', alts: ['旧备选'] }, ...o,
  });

  test('提醒到期、还是没记 → 原位重写：同一行回到 draft，period_end = 今天，清掉手改和处理痕迹', async () => {
    const store = fakeStore({
      students: [WEEKLY('b')],
      records: [rec('b', '2026-10-10')],
      drafts: [snoozed({ id: 'sn', student_id: 'b', kind: 'nudge', period_start: '2026-10-21', period_end: '2026-10-21' })],
    });
    const gen = richGen();
    const out = await run(store, gen);
    expect(out).toMatchObject({ returned: 1, created: 0, nudge: 0 });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen.mock.calls[0][0]).toMatchObject({ kind: 'nudge', records: [] });
    expect(store.state.drafts).toHaveLength(1);
    expect(byId(store, 'sn')).toMatchObject({
      status: 'draft', edited_body: null, handled_by: null, handled_at: null, snooze_until: null,
      period_start: '2026-10-21', period_end: TODAY,
      meta: { from_snooze: true, why: '理由-nudge', alts: ['备选一', '备选二'] },
    });
  });

  test('每日表扬到期、期间又记了 → 仍是每日：只夸推迟之后的记录，period_start 不变、period_end = 昨天', async () => {
    const store = fakeStore({
      students: [{ id: 's', created_at: signedUp(10) }],
      records: [rec('s', '2026-10-20'), rec('s', '2026-10-22'), rec('s', YESTERDAY)],
      drafts: [snoozed({ id: 'sd', student_id: 's', kind: 'daily', period_start: '2026-10-20', period_end: '2026-10-20' })],
    });
    const gen = richGen();
    await run(store, gen);
    expect(gen).toHaveBeenCalledTimes(1); // 每日步骤认得这条，不会再给昨天另写一条
    expect(gen.mock.calls[0][0].kind).toBe('daily');
    expect(gen.mock.calls[0][0].records.map((r) => r.session_date)).toEqual(['2026-10-22', YESTERDAY]);
    expect(store.state.drafts).toHaveLength(1);
    expect(byId(store, 'sd')).toMatchObject({
      status: 'draft', period_start: '2026-10-20', period_end: YESTERDAY, meta: { from_snooze: true, records_from: '2026-10-21' },
    });
    // 之后导师再「重新生成」，仍只用推迟之后的记录
    const again = richGen();
    await regenerateDraft({ store, draft: byId(store, 'sd'), generate: again, env: ENV, now: MON });
    expect(again.mock.calls[0][0].records.map((r) => r.session_date)).toEqual(['2026-10-22', YESTERDAY]);
  });

  test('每日表扬到期、期间一条没记 → 种类变了：旧的撤下，新插一条提醒（meta.from_snooze）', async () => {
    const store = fakeStore({
      students: [{ id: 's', created_at: signedUp(10) }],
      records: [rec('s', '2026-10-20')],
      drafts: [snoozed({ id: 'sd', student_id: 's', kind: 'daily', period_start: '2026-10-20', period_end: '2026-10-20' })],
    });
    const gen = richGen();
    const out = await run(store, gen);
    expect(out).toMatchObject({ created: 1, nudge: 1, returned: 0 });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(byId(store, 'sd')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_SUPERSEDED } });
    expect(openOf(store, 's')).toHaveLength(1);
    expect(openOf(store, 's')[0]).toMatchObject({ kind: 'nudge', period_start: TODAY, meta: { from_snooze: true } });
  });

  test('到期时只有今天的记录（没有可夸的昨天）→ 撤下，不调用模型', async () => {
    const store = fakeStore({
      students: [{ id: 's', created_at: signedUp(10) }],
      records: [rec('s', '2026-10-20'), rec('s', TODAY)],
      drafts: [snoozed({ id: 'sd', student_id: 's', kind: 'daily', period_start: '2026-10-20', period_end: '2026-10-20' })],
    });
    const gen = richGen();
    await run(store, gen);
    expect(byId(store, 'sd')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_RECORDED } });
    expect(gen).not.toHaveBeenCalled();
  });

  test('推迟期间已经有了更新的 draft → 到期的这条直接撤下；还没到期的不动', async () => {
    const store = fakeStore({
      students: [WEEKLY('b'), WEEKLY('c')],
      records: [rec('b', '2026-10-10'), rec('c', '2026-10-10')],
      drafts: [
        snoozed({ id: 'old', student_id: 'b', kind: 'nudge', period_start: '2026-10-21', period_end: '2026-10-21' }),
        draftRow({ id: 'newer', student_id: 'b', kind: 'nudge', period_start: '2026-10-25', period_end: '2026-10-25', created_at: '2026-10-25T03:00:00Z' }),
        snoozed({ id: 'later', student_id: 'c', kind: 'nudge', snooze_until: '2026-10-27', period_start: '2026-10-21', period_end: '2026-10-21' }),
      ],
    });
    const gen = richGen();
    await run(store, gen);
    expect(byId(store, 'old')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_SUPERSEDED } });
    expect(byId(store, 'newer').status).toBe('draft');
    expect(byId(store, 'later').status).toBe('snoozed');
    expect(gen).not.toHaveBeenCalled();
  });

  test('上上周的周小结到期（周一）→ 撤下，由本周一的周小结接上', async () => {
    const store = fakeStore({
      students: [WEEKLY('w')],
      records: [rec('w', '2026-10-20'), rec('w', YESTERDAY)],
      drafts: [snoozed({ id: 'ws', student_id: 'w', kind: 'weekly', period_start: '2026-10-12', period_end: '2026-10-18' })],
    });
    await run(store, richGen());
    expect(byId(store, 'ws').status).toBe('dropped');
    expect(openOf(store, 'w')).toHaveLength(1);
    expect(openOf(store, 'w')[0]).toMatchObject({ kind: 'weekly', period_start: WEEK.start });
  });
});

describe('v2 · 周一合并：一人一天一条', () => {
  test('周小结 + 已经 ≥3 天没记 → 一条合并消息（meta.nudge），不另出提醒', async () => {
    const store = fakeStore({
      students: [WEEKLY('w1')],
      records: [rec('w1', '2026-10-20'), rec('w1', '2026-10-22')], // 最后一次 10/22，今天 10/26，隔 4 天
    });
    const gen = richGen();
    const out = await run(store, gen);
    expect(out).toMatchObject({ created: 1, weekly: 1, nudge: 0 });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen.mock.calls[0][0]).toMatchObject({
      kind: 'weekly', combineNudge: true, nudge: { neverRecorded: false, phase: 'weekly' }, today: TODAY,
    });
    expect(store.state.inserted[0]).toMatchObject({ kind: 'weekly', meta: { nudge: true } });
  });

  test('隔得不够 3 天 / 3 天内刚提醒过 / 压着一条推迟 → 只出普通周小结', async () => {
    const store = fakeStore({
      students: [WEEKLY('recent'), WEEKLY('fresh'), WEEKLY('snz')],
      records: [rec('recent', '2026-10-20'), rec('recent', YESTERDAY), rec('fresh', '2026-10-20'), rec('fresh', '2026-10-22'), rec('snz', '2026-10-20'), rec('snz', '2026-10-22')],
      drafts: [
        draftRow({ id: 'n', student_id: 'fresh', kind: 'nudge', period_start: '2026-10-25', period_end: '2026-10-25', status: 'sent', handled_at: '2026-10-25T03:00:00Z' }),
        draftRow({ id: 's', student_id: 'snz', kind: 'daily', period_start: '2026-10-21', period_end: '2026-10-21', status: 'snoozed', snooze_until: '2026-11-02', handled_at: '2026-10-21T05:00:00Z' }),
      ],
    });
    const gen = richGen();
    await run(store, gen);
    const weeklies = store.state.inserted.filter((d) => d.kind === 'weekly');
    expect(weeklies).toHaveLength(3);
    expect(weeklies.every((d) => d.meta.nudge === undefined)).toBe(true);
    expect(gen.mock.calls.every(([i]) => i.combineNudge === false)).toBe(true);
  });
});

describe('v2 · regenerateDraft', () => {
  const base = { student_id: 's1', period_start: TODAY, period_end: TODAY, body: '旧', edited_body: '手改', status: 'sent', handled_by: 't1', handled_at: 'x', meta: { alts: ['旧备选'], why: '旧', system_push_date: '2026-10-25', recommend_snooze: 3 } };

  test('提醒：用今天为期、前 30 天为上下文，刷新 alts，保留推送标记，回到 draft', async () => {
    const draft = { id: 'n1', kind: 'nudge', ...base };
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(60) }],
      records: [rec('s1', '2026-10-20')],
      drafts: [{ ...draft, kind: 'nudge' }],
    });
    const gen = richGen();
    const out = await regenerateDraft({ store, draft: byId(store, 'n1'), generate: gen, env: ENV, now: MON });
    expect(gen.mock.calls[0][0]).toMatchObject({ kind: 'nudge', records: [], nudge: { neverRecorded: false, phase: 'weekly' } });
    expect(gen.mock.calls[0][0].context).toHaveLength(1);
    expect(out).toMatchObject({
      status: 'draft', edited_body: null, handled_by: null, snooze_until: null, skip_reason: null,
      meta: { alts: ['备选一', '备选二'], why: '理由-nudge', system_push_date: '2026-10-25', recommend_snooze: 3 },
    });
  });

  test('周小结 + 提醒：仍合并生成；别的未处理草稿被撤下', async () => {
    const draft = { id: 'w1', kind: 'weekly', ...base, period_start: WEEK.start, period_end: WEEK.end, meta: { nudge: true } };
    const store = fakeStore({
      students: [{ id: 's1', created_at: signedUp(60) }],
      records: [rec('s1', '2026-10-20')],
      drafts: [draft, draftRow({ id: 'other', student_id: 's1', kind: 'nudge', period_start: '2026-10-25', period_end: '2026-10-25' })],
    });
    const gen = richGen();
    const out = await regenerateDraft({ store, draft: byId(store, 'w1'), generate: gen, env: ENV, now: MON });
    expect(gen.mock.calls[0][0]).toMatchObject({ kind: 'weekly', combineNudge: true, nudge: { phase: 'weekly' } });
    expect(out.meta).toMatchObject({ nudge: true, alts: ['备选一', '备选二'] });
    expect(byId(store, 'other')).toMatchObject({ status: 'dropped', meta: { drop_reason: DROP_SUPERSEDED } });
  });

  test('已被撤下的草稿不能重新生成 → 409', async () => {
    const store = fakeStore({ students: [{ id: 's1', created_at: signedUp(60) }], drafts: [{ id: 'x', kind: 'nudge', ...base, status: 'dropped' }] });
    await expect(regenerateDraft({ store, draft: byId(store, 'x'), generate: richGen(), env: ENV, now: MON })).rejects.toMatchObject({ status: 409 });
  });
});

describe('v2 · Supabase REST store', () => {
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const make = (handler) => {
    const calls = [];
    const fetchImpl = jest.fn(async (url, init = {}) => {
      calls.push({ url: decodeURIComponent(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      return handler(url, init);
    });
    return { calls, store: createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl }) };
  };

  test('lastNudgeSentAt：只看提醒类（kind = nudge 或 meta.nudge）且 sent / snoozed / skipped，取每位学生最新的 handled_at', async () => {
    const { store, calls } = make(() => reply(200, [
      { student_id: 's1', handled_at: '2026-10-25T03:00:00Z' }, { student_id: 's1', handled_at: '2026-10-23T03:00:00Z' }, { student_id: 's2', handled_at: '2026-10-24T03:00:00Z' },
    ]));
    const m = await store.lastNudgeSentAt(['s1', 's2'], '2026-10-19');
    expect([...m]).toEqual([['s1', '2026-10-25T03:00:00Z'], ['s2', '2026-10-24T03:00:00Z']]);
    expect(calls[0].url).toContain('status=in.(sent,snoozed,skipped)');
    expect(calls[0].url).toContain('or=(kind.eq.nudge,meta->>nudge.eq.true)');
    expect(calls[0].url).toContain('handled_at=gte.2026-10-19');
  });

  test('recentInactivePush 读 push_deliveries 的 kind = inactive；listOpenDrafts 取 draft + snoozed；listDueSnoozed 按日期', async () => {
    const { store, calls } = make(() => reply(200, [{ user_id: 's1', sent_date: '2026-10-25' }]));
    expect([...await store.recentInactivePush(['s1'], '2026-10-25')]).toEqual([['s1', '2026-10-25']]);
    expect(calls[0].url).toMatch(/push_deliveries\?.*kind=eq\.inactive.*sent_date=gte\.2026-10-25/);
    await store.listOpenDrafts(['s1']);
    expect(calls[1].url).toContain('status=in.(draft,snoozed)');
    await store.listDueSnoozed('2026-10-26');
    expect(calls[2].url).toContain('status=eq.snoozed&snooze_until=lte.2026-10-26');
  });

  test('dropDrafts：只动 draft / snoozed 的行，meta 合并 drop_reason；原 meta 相同的合并成一次请求', async () => {
    const { store, calls } = make((url, init) => {
      if (init.method === 'PATCH') return reply(200, new Array(JSON.parse(init.body).meta.why ? 1 : 2).fill({}));
      return reply(200, [{ id: 'a', meta: {} }, { id: 'b', meta: {} }, { id: 'c', meta: { why: '理由' } }]);
    });
    const n = await store.dropDrafts(['a', 'b', 'c'], '有了更新的一条');
    expect(n).toBe(3);
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[0].url).toContain('status=in.(draft,snoozed)');
    expect(patches[0].body).toEqual({ status: 'dropped', meta: { drop_reason: '有了更新的一条' } });
    expect(patches[1].body.meta).toEqual({ why: '理由', drop_reason: '有了更新的一条' });
  });

  test('lastSent / rejected / loadExams / listDraftStudentIds 的形状', async () => {
    const { store, calls } = make((url) => {
      if (url.includes('exam_scores')) return reply(200, [{ student_id: 's1', exam_date: '2026-10-20', exam_name: '月考', score: '88.50', grade_label: null, notes: null, courses: { name: '数学' } }]);
      if (url.includes('status=eq.sent')) return reply(200, [{ body: '原', edited_body: '改', handled_at: '2026-10-25T17:00:00Z' }]);
      if (url.includes('status=eq.skipped')) return reply(200, [{ body: '不合适' }]);
      return reply(200, [{ student_id: 's1' }]);
    });
    expect(await store.lastSent('s1')).toEqual({ text: '改', date: '2026-10-26' }); // 上海时间已过零点
    expect(await store.rejected('s1')).toEqual(['不合适']);
    expect(calls[1].url).toContain('skip_reason=eq.这条写得不合适');
    expect(await store.loadExams(['s1'], '2026-09-01', '2026-10-26')).toEqual([
      { student_id: 's1', date: '2026-10-20', course: '数学', name: '月考', grade_label: null, score: 88.5, notes: null },
    ]);
    expect([...await store.listDraftStudentIds('daily', '2026-10-25', '2026-10-25')]).toEqual(['s1']);
    expect(calls[3].url).toContain('or=(period_start.eq.2026-10-25,period_end.eq.2026-10-25)');
  });

  test('listActiveMuteIds：hidden 永久生效，snoozed 只看 until >= 今天', async () => {
    const { store, calls } = make(() => reply(200, [
      { student_id: 'a', mode: 'hidden', until: null },
      { student_id: 'b', mode: 'snoozed', until: '2026-10-26' }, // 今天到期，仍生效
      { student_id: 'c', mode: 'snoozed', until: '2026-10-25' }, // 昨天到期
      { student_id: 'd', mode: 'snoozed', until: null },         // 坏数据：不生效
    ]));
    expect([...(await store.listActiveMuteIds('2026-10-26'))].sort()).toEqual(['a', 'b']);
    expect(calls[0].url).toContain('supervision_mutes?select=student_id,mode,until');
  });
});
