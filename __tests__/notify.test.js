import {
  addDays,
  buildInactiveUrl,
  buildPayload,
  createSupabaseStore,
  deliver,
  diffDays,
  dueKindFor,
  forcedDailyUntil,
  inactiveStage,
  isDailyForced,
  isQuietHours,
  lastSession,
  normalizePrefs,
  parseTimeOfDay,
  runTick,
  selectDue,
  sendInvite,
  shanghaiClock,
  usualLogMinutes,
} from '../api-lib/notify.mjs';

// 2026-10-21 是周三。上海 = UTC+8，所以 UTC 的 HH:MM 要减 8 小时。
const at = (ymd, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + ((h - 8) * 60 + m) * 60000);
};
const TODAY = '2026-10-21';
const clockAt = (hhmm, ymd = TODAY) => shanghaiClock(at(ymd, hhmm));
const ago = (n) => addDays(TODAY, -n);

describe('时间工具', () => {
  test('shanghaiClock 按 UTC+8 换算日期与分钟（跨日）', () => {
    expect(shanghaiClock(new Date('2026-10-20T16:30:00Z'))).toEqual({ date: '2026-10-21', minutes: 30 });
    expect(shanghaiClock(new Date('2026-10-21T15:59:00Z'))).toEqual({ date: '2026-10-21', minutes: 23 * 60 + 59 });
  });

  test('addDays / diffDays', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(diffDays('2026-10-21', '2026-10-18')).toBe(3);
    expect(diffDays('2026-03-01', '2026-02-28')).toBe(1);
  });

  test('parseTimeOfDay', () => {
    expect(parseTimeOfDay('21:00')).toBe(1260);
    expect(parseTimeOfDay('7:05')).toBe(425);
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('abc')).toBeNull();
    expect(parseTimeOfDay(undefined)).toBeNull();
  });
});

describe('静默时段 22:30–07:00', () => {
  test.each([
    ['22:29', false],
    ['22:30', true],
    ['23:59', true],
    ['00:00', true],
    ['06:59', true],
    ['07:00', false],
    ['12:00', false],
  ])('%s → %s', (hhmm, quiet) => {
    expect(isQuietHours(clockAt(hhmm).minutes)).toBe(quiet);
  });

  test('静默时段内 selectDue 不返回任何提醒', () => {
    const students = [{ id: 'a', prefs: { daily_reminder: true, daily_reminder_time: '07:00' }, sessions: [] }];
    expect(selectDue({ students, clock: clockAt('23:00') })).toEqual([]);
    expect(selectDue({ students, clock: clockAt('03:00') })).toEqual([]);
  });

  test('每日提醒时间设在静默时段里：永远不会发出', () => {
    const s = { id: 'a', prefs: { daily_reminder: true, daily_reminder_time: '23:00' }, sessions: [] };
    for (const t of ['22:29', '22:30', '23:30', '02:00']) expect(dueKindFor(s, clockAt(t))).toBeNull();
  });
});

describe('normalizePrefs', () => {
  test('缺省值：几天没记录开、每日提醒关（21:00）、邀请开；旧字段不再存在', () => {
    expect(normalizePrefs(null)).toEqual({
      inactive_reminder: true,
      daily_reminder: false,
      daily_reminder_time: '21:00',
      invites: true,
    });
  });
  test('脏数据回退默认；旧版的字段被忽略', () => {
    const p = normalizePrefs({
      daily_reminder: 'yes', daily_reminder_time: '99:99', inactive_reminder: false,
      pending_digest: true, streak_reminder: true, weekly_email: true,
    });
    expect(p.daily_reminder).toBe(false);
    expect(p.daily_reminder_time).toBe('21:00');
    expect(p.inactive_reminder).toBe(false);
    expect(p).not.toHaveProperty('pending_digest');
    expect(p).not.toHaveProperty('streak_reminder');
    expect(p).not.toHaveProperty('weekly_email');
  });
});

// ---------------------------------------------------------------------------
// 记录分析
// ---------------------------------------------------------------------------

const sess = (date, startTime = '19:00:00', over = {}) => ({
  date, startTime, courseId: 'c1', category: 3, form: '自主练习', minutes: 45, ...over,
});

describe('usualLogMinutes：最近 20 条开始时刻的中位数', () => {
  const many = (n, start, date = (i) => ago(i + 1)) => Array.from({ length: n }, (_, i) => sess(date(i), start));

  test('少于 3 条（有开始时刻的）→ 19:30', () => {
    expect(usualLogMinutes([], TODAY)).toBe(19 * 60 + 30);
    expect(usualLogMinutes(many(2, '10:00:00'), TODAY)).toBe(19 * 60 + 30);
    expect(usualLogMinutes([...many(2, '10:00:00'), sess(ago(9), null)], TODAY)).toBe(19 * 60 + 30);
  });

  test('取开始时刻所在整点的中位数', () => {
    const rows = [sess(ago(1), '17:40:00'), sess(ago(2), '18:10:00'), sess(ago(3), '20:55:00'), sess(ago(4), '18:59:00'), sess(ago(5), '22:00:00')];
    // 小时 17 18 20 18 22 → 排序 17 18 18 20 22 → 中位数 18
    expect(usualLogMinutes(rows, TODAY)).toBe(18 * 60);
  });

  test('偶数条取中间两个整点的平均，可落在半点', () => {
    const rows = [sess(ago(1), '16:00:00'), sess(ago(2), '16:30:00'), sess(ago(3), '17:00:00'), sess(ago(4), '17:20:00')];
    expect(usualLogMinutes(rows, TODAY)).toBe(16 * 60 + 30);
  });

  test('夹在 08:00–21:30', () => {
    expect(usualLogMinutes(many(5, '05:30:00'), TODAY)).toBe(8 * 60);
    expect(usualLogMinutes(many(5, '23:10:00'), TODAY)).toBe(21 * 60 + 30);
    expect(usualLogMinutes(many(5, '21:15:00'), TODAY)).toBe(21 * 60); // 21 点整点，未超上限
  });

  test('只看最近 20 条：更早的不影响', () => {
    const recent = many(20, '20:00:00');
    const old = Array.from({ length: 30 }, (_, i) => sess(ago(40 + i), '09:00:00'));
    expect(usualLogMinutes([...old, ...recent], TODAY)).toBe(20 * 60);
  });
});

describe('lastSession', () => {
  test('日期最晚、同日开始时刻最晚；忽略今天之后的记录', () => {
    const rows = [
      sess(ago(5), '08:00:00', { courseId: 'old' }),
      sess(ago(3), '09:00:00', { courseId: 'early' }),
      sess(ago(3), '20:00:00', { courseId: 'late' }),
      sess(addDays(TODAY, 2), '10:00:00', { courseId: 'future' }),
    ];
    expect(lastSession(rows, TODAY).courseId).toBe('late');
    expect(lastSession([], TODAY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 几天没记录：第 3 天一条、第 7 天一条，其余日子不发，新记录让循环重置
// ---------------------------------------------------------------------------

const student = (over = {}) => ({
  id: 'u1',
  prefs: {},
  createdAt: '2025-01-01T00:00:00Z',
  sessions: [],
  inactiveSentDates: [],
  pendingCount: 0,
  courseNames: { c1: 'AP 微积分 BC' },
  ...over,
});
// 最后一条记录在 n 天前；之前还有几条凑够「惯用时间」样本（19:00）
const lastLoggedAgo = (n, extra = {}) => student({
  sessions: [sess(ago(n), '19:00:00'), sess(ago(n + 1), '19:00:00'), sess(ago(n + 2), '19:00:00')],
  ...extra,
});

describe('几天没记录 · 第 3 天与第 7 天', () => {
  test('inactiveStage：只在第 3 天（未发过）与第 7 天（至多发过一次）', () => {
    const run = (n, sent = []) => inactiveStage({ last: sess(ago(n)), inactiveSentDates: sent, today: TODAY });
    for (const n of [0, 1, 2]) expect(run(n)).toBeNull();
    expect(run(3)).toBe(3);
    for (const n of [4, 5, 6]) expect(run(n, [ago(n - 3)])).toBeNull();
    expect(run(7, [ago(4)])).toBe(7);
    expect(run(7)).toBe(7); // 第一条因故没发出去，第 7 天仍发这一条
    for (const n of [8, 9, 14, 60]) expect(run(n, [ago(n - 3), ago(n - 7)])).toBeNull();
    expect(inactiveStage({ last: null, inactiveSentDates: [], today: TODAY })).toBeNull();
  });

  test('第 3 天：到了惯用时间就发，文案点名上次记的课程与类别，链接带预填参数', () => {
    const s = lastLoggedAgo(3);
    expect(dueKindFor(s, clockAt('18:59'))).toBeNull();
    const hit = dueKindFor(s, clockAt('19:00'));
    expect(hit.kind).toBe('inactive');
    expect(hit.payload.body).toBe('三天没记录了。上次是 AP 微积分 BC · 练习，点一下就能补上。');
    expect(hit.payload.tag).toBe('yb-inactive');
    const url = new URL(hit.payload.url, 'https://x.test');
    expect(url.pathname).toBe('/records');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      log: '1', course: 'c1', category: '3', form: '自主练习', minutes: '45',
    });
  });

  test('第 7 天（第一条已发）：「一周没记录了」', () => {
    const s = lastLoggedAgo(7, { inactiveSentDates: [ago(4)] });
    const hit = dueKindFor(s, clockAt('19:00'));
    expect(hit.kind).toBe('inactive');
    expect(hit.payload.body).toBe('一周没记录了。上次是 AP 微积分 BC · 练习，点一下就能补上。');
  });

  test.each([1, 2, 4, 5, 6, 8, 9, 10, 30])('最后记录在 %i 天前（已按规则发过）→ 不发', (n) => {
    const sent = [];
    if (n > 3) sent.push(ago(n - 3));
    if (n > 7) sent.push(ago(n - 7));
    expect(dueKindFor(lastLoggedAgo(n, { inactiveSentDates: sent }), clockAt('21:00'))).toBeNull();
  });

  test('两条都发过之后到再次记录之前，什么都不发', () => {
    const s = lastLoggedAgo(12, { inactiveSentDates: [ago(9), ago(5)] });
    expect(dueKindFor(s, clockAt('21:00'))).toBeNull();
  });

  test('从来没有记录的学生不发', () => {
    expect(dueKindFor(student(), clockAt('21:00'))).toBeNull();
  });

  test('新记录重置循环：之前的投递早于新的最后记录日期，不再计入', () => {
    // 10 天前发过 3 天 / 7 天提醒；学生在 3 天前又记了一条 → 现在又是新一轮的第 3 天
    const sent = [ago(17), ago(13)];
    const s = student({
      sessions: [sess(ago(3)), sess(ago(20)), sess(ago(21)), sess(ago(22))],
      inactiveSentDates: sent,
    });
    expect(dueKindFor(s, clockAt('19:30')).kind).toBe('inactive');
    // 同一天记了新记录 → 最后记录日期 = 今天，不提醒
    expect(dueKindFor({ ...s, sessions: [...s.sessions, sess(TODAY)] }, clockAt('21:00'))).toBeNull();
  });

  test('关闭「几天没记录」偏好 → 不发', () => {
    expect(dueKindFor(lastLoggedAgo(3, { prefs: { inactive_reminder: false } }), clockAt('21:00'))).toBeNull();
  });

  test('没有课程名时文案仍通顺', () => {
    const s = lastLoggedAgo(3, { courseNames: {} });
    expect(dueKindFor(s, clockAt('19:00')).payload.body).toBe('三天没记录了，点一下就能补上。');
  });

  test('发送时刻 = 惯用记录时间：早起型 08:00、晚归型夹到 21:30、样本不足 19:30', () => {
    const morning = student({ sessions: [sess(ago(3), '06:10:00'), sess(ago(4), '06:30:00'), sess(ago(5), '07:00:00')] });
    expect(dueKindFor(morning, clockAt('07:59'))).toBeNull();
    expect(dueKindFor(morning, clockAt('08:00')).kind).toBe('inactive');

    const night = student({ sessions: [sess(ago(3), '23:00:00'), sess(ago(4), '23:20:00'), sess(ago(5), '22:40:00')] });
    expect(dueKindFor(night, clockAt('21:29'))).toBeNull();
    expect(dueKindFor(night, clockAt('21:30')).kind).toBe('inactive');

    const few = student({ sessions: [sess(ago(3), '10:00:00'), sess(ago(4), '10:00:00')] });
    expect(dueKindFor(few, clockAt('19:29'))).toBeNull();
    expect(dueKindFor(few, clockAt('19:30')).kind).toBe('inactive');
  });
});

describe('buildInactiveUrl', () => {
  test('带课程、类别、形式、时长；缺的参数不出现；形式做 URL 编码', () => {
    expect(buildInactiveUrl(sess(ago(3), '19:00:00', { form: '学校 作业&测验' }))).toBe(
      '/records?log=1&course=c1&category=3&form=%E5%AD%A6%E6%A0%A1+%E4%BD%9C%E4%B8%9A%26%E6%B5%8B%E9%AA%8C&minutes=45',
    );
    expect(buildInactiveUrl({ courseId: 'c9' })).toBe('/records?log=1&course=c9');
    expect(buildInactiveUrl(null)).toBe('/records?log=1');
    expect(buildInactiveUrl({ category: 7, minutes: 0 })).toBe('/records?log=1');
  });
});

// ---------------------------------------------------------------------------
// 每日提醒：默认关，注册后前 30 天强制
// ---------------------------------------------------------------------------

describe('每日提醒', () => {
  const daily = (over = {}) => student({ prefs: { daily_reminder: true }, ...over });

  test('到点且当天没记录 → 到期，链接 /records?log=1', () => {
    const hit = dueKindFor(daily(), clockAt('21:00'));
    expect(hit.kind).toBe('daily');
    expect(hit.payload.url).toBe('/records?log=1');
  });

  test('未到点 / 当天已有记录 → 不提醒', () => {
    expect(dueKindFor(daily(), clockAt('20:59'))).toBeNull();
    expect(dueKindFor(daily({ sessions: [sess(TODAY)] }), clockAt('21:15'))).toBeNull();
  });

  test('学生自选时间 08:00', () => {
    const s = daily({ prefs: { daily_reminder: true, daily_reminder_time: '08:00' } });
    expect(dueKindFor(s, clockAt('07:59'))).toBeNull();
    expect(dueKindFor(s, clockAt('08:00')).kind).toBe('daily');
  });

  test('一个月之后默认关：不提醒', () => {
    expect(dueKindFor(student({ createdAt: '2025-01-01T00:00:00Z' }), clockAt('21:15'))).toBeNull();
  });

  test('注册后第一个月强制开启：偏好关也提醒，默认 21:00', () => {
    const s = student({ createdAt: `${ago(10)}T08:00:00+08:00`, prefs: { daily_reminder: false } });
    expect(dueKindFor(s, clockAt('20:59'))).toBeNull();
    expect(dueKindFor(s, clockAt('21:00')).kind).toBe('daily');
    // 强制期内同样尊重学生选的时间、以及「当天已记录就不提醒」
    expect(dueKindFor({ ...s, prefs: { daily_reminder_time: '12:00' } }, clockAt('12:00')).kind).toBe('daily');
    expect(dueKindFor({ ...s, sessions: [sess(TODAY)] }, clockAt('21:30'))).toBeNull();
  });

  test('强制期边界：注册当天起 30 天（含注册当天，上海日期）', () => {
    expect(forcedDailyUntil('2026-09-22T00:30:00+08:00')).toBe('2026-10-21');
    expect(isDailyForced('2026-09-22T00:30:00+08:00', TODAY)).toBe(true);
    expect(isDailyForced('2026-09-21T23:30:00+08:00', TODAY)).toBe(false);
    // UTC 时间 2026-09-21 16:30 = 上海 09-22 00:30
    expect(forcedDailyUntil('2026-09-21T16:30:00Z')).toBe('2026-10-21');
    expect(isDailyForced(null, TODAY)).toBe(false);
    expect(isDailyForced('garbage', TODAY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 优先级 / 每天至多一条 / badge
// ---------------------------------------------------------------------------

describe('优先级与每天至多一条', () => {
  const both = (over = {}) => lastLoggedAgo(3, { prefs: { daily_reminder: true, daily_reminder_time: '19:00' }, ...over });

  test('inactive 与 daily 同时到期：只返回 inactive', () => {
    const due = selectDue({ students: [both()], clock: clockAt('21:00') });
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe('inactive');
  });

  test('当天要发 inactive 时，更早到点的每日提醒让位', () => {
    const s = both({ prefs: { daily_reminder: true, daily_reminder_time: '08:00' } });
    expect(dueKindFor(s, clockAt('08:00'))).toBeNull();     // 还没到 inactive 的时间，daily 不抢先
    expect(dueKindFor(s, clockAt('19:00')).kind).toBe('inactive');
  });

  test('没有 inactive 的日子，daily 照常发', () => {
    const s = lastLoggedAgo(5, { inactiveSentDates: [ago(2)], prefs: { daily_reminder: true } });
    expect(dueKindFor(s, clockAt('21:00')).kind).toBe('daily');
  });

  test('今天已发过非邀请推送的学生被跳过', () => {
    const due = selectDue({
      students: [student({ id: 'a', prefs: { daily_reminder: true } }), student({ id: 'b', prefs: { daily_reminder: true } })],
      clock: clockAt('21:30'),
      sentToday: new Set(['a']),
    });
    expect(due.map((d) => d.userId)).toEqual(['b']);
  });
});

describe('推送载荷', () => {
  test('每条推送都带 badge = 待补填数量，缺省为 0', () => {
    const s = lastLoggedAgo(3, { pendingCount: 4 });
    expect(dueKindFor(s, clockAt('19:00')).payload.badge).toBe(4);
    const d = student({ prefs: { daily_reminder: true }, pendingCount: 2 });
    expect(dueKindFor(d, clockAt('21:00')).payload.badge).toBe(2);
    expect(buildPayload('daily').badge).toBe(0);
    expect(buildPayload('invite', { teacherName: '王老师', badge: 3 }).badge).toBe(3);
    expect(buildPayload('daily', { badge: -5 }).badge).toBe(0);
  });

  test('待补填本身不会触发任何推送', () => {
    const s = student({ pendingCount: 9, sessions: [sess(ago(1))], prefs: {} });
    expect(dueKindFor(s, clockAt('21:00'))).toBeNull();
  });

  test('文案不含分钟目标，也不提休息日额度', () => {
    const text = JSON.stringify([
      buildPayload('daily'),
      buildPayload('inactive', { stage: 3, last: sess(ago(3)), courseName: 'AP 微积分 BC' }),
      buildPayload('inactive', { stage: 7, last: sess(ago(7)), courseName: 'AP 微积分 BC' }),
      buildPayload('invite', { teacherName: '王老师' }),
    ]);
    expect(text).not.toMatch(/目标|还差|休息/);
  });

  test('已移除的推送类型不再存在', () => {
    for (const kind of ['digest', 'streak']) expect(() => buildPayload(kind)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 编排：mock store 与 web-push
// ---------------------------------------------------------------------------

function makeStore(over = {}) {
  const calls = { claim: [], release: [], deleted: [], touched: [], inviteLog: [] };
  const claimed = new Set(over.alreadyClaimed || []);
  const store = {
    calls,
    listSubscriptions: async () => over.subs || [],
    listSubscriptionsFor: async (id) => (over.subs || []).filter((s) => s.user_id === id),
    loadProfiles: async (ids) => (over.profiles || []).filter((p) => ids.includes(p.id)),
    loadSessions: async () => new Map(Object.entries(over.sessions || {})),
    loadPendingCounts: async () => new Map(Object.entries(over.pending || {})),
    loadCourseNames: async () => over.courses || {},
    loadDeliveries: async () => over.deliveries || [],
    claimDaily: async (uid, date, kind) => {
      calls.claim.push([uid, date, kind]);
      if (claimed.has(uid)) return false;
      claimed.add(uid);
      return true;
    },
    releaseDaily: async (uid) => { calls.release.push(uid); claimed.delete(uid); },
    deleteSubscription: async (ep) => { calls.deleted.push(ep); },
    touchSubscriptions: async (eps) => { calls.touched.push(...eps); },
    logInvite: async (uid) => { calls.inviteLog.push(uid); },
  };
  return store;
}

const sub = (uid, n = 1) => ({ user_id: uid, endpoint: `https://push.example/${uid}/${n}`, p256dh: 'p', auth: 'a' });
const dailyProfile = (id) => ({ id, created_at: '2025-01-01T00:00:00Z', notification_prefs: { inactive_reminder: false, daily_reminder: true, daily_reminder_time: '21:00' } });

describe('runTick', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('到期学生收到推送，并写入占位与 last_used_at', async () => {
    const store = makeStore({ subs: [sub('a'), sub('a', 2), sub('b')], profiles: [dailyProfile('a'), dailyProfile('b')], sessions: { b: [sess(TODAY)] }, pending: { a: 3 } });
    const sendPush = jest.fn().mockResolvedValue({ statusCode: 201 });
    const res = await runTick({ store, sendPush, now: at(TODAY, '21:15') });

    expect(res).toMatchObject({ considered: 2, due: 1, sent: 2, removed: 0, failed: 0 });
    expect(store.calls.claim).toEqual([['a', TODAY, 'daily']]);
    expect(sendPush).toHaveBeenCalledTimes(2);
    const [subscription, body] = sendPush.mock.calls[0];
    expect(subscription).toEqual({ endpoint: 'https://push.example/a/1', keys: { p256dh: 'p', auth: 'a' } });
    expect(JSON.parse(body)).toMatchObject({ title: '一表人才', tag: 'yb-daily', url: '/records?log=1', badge: 3 });
    expect(store.calls.touched).toHaveLength(2);
  });

  test('静默时段不读库、不推送', async () => {
    const store = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')] });
    const listSpy = jest.spyOn(store, 'listSubscriptions');
    const sendPush = jest.fn();
    const res = await runTick({ store, sendPush, now: at(TODAY, '22:30') });
    expect(res.skipped).toBe('quiet-hours');
    expect(listSpy).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  test('每日上限：库里已有当天占位（并发/重复轮询）→ 不再发送', async () => {
    const preSent = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')], deliveries: [{ user_id: 'a', sent_date: TODAY, kind: 'daily' }] });
    const send1 = jest.fn();
    await runTick({ store: preSent, sendPush: send1, now: at(TODAY, '21:15') });
    expect(send1).not.toHaveBeenCalled();
    expect(preSent.calls.claim).toEqual([]);

    // 读到时尚未发送，但占位时唯一索引冲突（另一轮抢先）
    const racing = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')], alreadyClaimed: ['a'] });
    const send2 = jest.fn();
    const res = await runTick({ store: racing, sendPush: send2, now: at(TODAY, '21:15') });
    expect(res.sent).toBe(0);
    expect(send2).not.toHaveBeenCalled();
  });

  test('连续两次轮询同一天只发一次', async () => {
    const store = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')] });
    const sendPush = jest.fn().mockResolvedValue({});
    await runTick({ store, sendPush, now: at(TODAY, '21:00') });
    await runTick({ store, sendPush, now: at(TODAY, '21:15') });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  test('410 / 404 的订阅被删除，其余订阅照常发送', async () => {
    const store = makeStore({ subs: [sub('a', 1), sub('a', 2), sub('a', 3)], profiles: [dailyProfile('a')] });
    const sendPush = jest.fn(async (s) => {
      if (s.endpoint.endsWith('/1')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('not found'), { statusCode: 404 });
      return {};
    });
    const res = await runTick({ store, sendPush, now: at(TODAY, '21:15') });
    expect(res).toMatchObject({ sent: 1, removed: 2, failed: 0 });
    expect(store.calls.deleted.sort()).toEqual(['https://push.example/a/1', 'https://push.example/a/2']);
    expect(store.calls.release).toEqual([]); // 有一条送达，占位保留
  });

  test('临时故障(500)不删订阅；全部失败则释放占位以便下一轮重试', async () => {
    const store = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')] });
    const sendPush = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    const res = await runTick({ store, sendPush, now: at(TODAY, '21:15') });
    expect(res).toMatchObject({ sent: 0, removed: 0, failed: 1 });
    expect(store.calls.deleted).toEqual([]);
    expect(store.calls.release).toEqual(['a']);
  });

  test('订阅全部失效(410)时占位保留，不会反复重试', async () => {
    const store = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')] });
    const sendPush = jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    await runTick({ store, sendPush, now: at(TODAY, '21:15') });
    expect(store.calls.deleted).toHaveLength(1);
    expect(store.calls.release).toEqual([]);
  });

  test('没有任何提醒开启（且已过 30 天）的学生不会触发读记录', async () => {
    const store = makeStore({
      subs: [sub('a')],
      profiles: [{ id: 'a', created_at: '2025-01-01T00:00:00Z', notification_prefs: { inactive_reminder: false, daily_reminder: false } }],
    });
    const spy = jest.spyOn(store, 'loadSessions');
    const res = await runTick({ store, sendPush: jest.fn(), now: at(TODAY, '21:15') });
    expect(res.considered).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  test('注册第一个月：偏好全关也会被纳入（每日提醒强制）', async () => {
    const store = makeStore({
      subs: [sub('a')],
      profiles: [{ id: 'a', created_at: at(ago(5), '09:00').toISOString(), notification_prefs: { inactive_reminder: false, daily_reminder: false } }],
    });
    const sendPush = jest.fn().mockResolvedValue({});
    await runTick({ store, sendPush, now: at(TODAY, '21:00') });
    expect(store.calls.claim).toEqual([['a', TODAY, 'daily']]);
  });

  describe('几天没记录', () => {
    const inactiveProfile = { id: 'a', created_at: '2025-01-01T00:00:00Z', notification_prefs: {} };
    const rows = (n) => [sess(ago(n)), sess(ago(n + 1)), sess(ago(n + 2))];
    const base = (over = {}) => makeStore({
      subs: [sub('a')], profiles: [inactiveProfile], courses: { c1: 'AP 微积分 BC' }, pending: { a: 2 }, ...over,
    });

    test('第 3 天：到惯用时间发一条，正文与链接带上次记录，badge = 待补填数', async () => {
      const store = base({ sessions: { a: rows(3) } });
      const sendPush = jest.fn().mockResolvedValue({});
      const early = await runTick({ store, sendPush, now: at(TODAY, '18:45') });
      expect(early.sent).toBe(0);
      await runTick({ store, sendPush, now: at(TODAY, '19:00') });
      expect(store.calls.claim).toEqual([['a', TODAY, 'inactive']]);
      const payload = JSON.parse(sendPush.mock.calls[0][1]);
      expect(payload.body).toBe('三天没记录了。上次是 AP 微积分 BC · 练习，点一下就能补上。');
      expect(payload.url).toBe(`/records?log=1&course=c1&category=3&form=${encodeURIComponent('自主练习').replace(/%20/g, '+')}&minutes=45`);
      expect(payload.badge).toBe(2);
    });

    test('第 7 天再发一条；第 4–6 天与第 8 天起不发', async () => {
      const sentRows = [{ user_id: 'a', sent_date: ago(4), kind: 'inactive' }];
      const day7 = base({ sessions: { a: rows(7) }, deliveries: sentRows });
      const send7 = jest.fn().mockResolvedValue({});
      await runTick({ store: day7, sendPush: send7, now: at(TODAY, '19:00') });
      expect(JSON.parse(send7.mock.calls[0][1]).body).toContain('一周没记录了');

      for (const n of [4, 5, 6, 8, 9, 20]) {
        const store = base({ sessions: { a: rows(n) }, deliveries: [{ user_id: 'a', sent_date: ago(n - 3), kind: 'inactive' }, ...(n > 7 ? [{ user_id: 'a', sent_date: ago(n - 7), kind: 'inactive' }] : [])] });
        const send = jest.fn().mockResolvedValue({});
        await runTick({ store, sendPush: send, now: at(TODAY, '21:00') });
        expect(send).not.toHaveBeenCalled();
      }
    });

    test('新记录之后重新开始：旧投递早于最后记录日期不计', async () => {
      const store = base({
        sessions: { a: rows(3) },
        deliveries: [{ user_id: 'a', sent_date: ago(12), kind: 'inactive' }, { user_id: 'a', sent_date: ago(8), kind: 'inactive' }],
      });
      const sendPush = jest.fn().mockResolvedValue({});
      await runTick({ store, sendPush, now: at(TODAY, '19:00') });
      expect(sendPush).toHaveBeenCalledTimes(1);
    });

    test('同一天 inactive 与 daily 都到期：只发 inactive，且当天不再发第二条', async () => {
      const store = makeStore({
        subs: [sub('a')],
        profiles: [{ ...inactiveProfile, notification_prefs: { daily_reminder: true, daily_reminder_time: '19:00' } }],
        sessions: { a: rows(3) },
      });
      const sendPush = jest.fn().mockResolvedValue({});
      await runTick({ store, sendPush, now: at(TODAY, '19:00') });
      await runTick({ store, sendPush, now: at(TODAY, '21:00') });
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(store.calls.claim[0][2]).toBe('inactive');
    });

    test('静默时段不发（即使惯用时间被夹到 21:30 之后也不会进入 22:30）', async () => {
      const store = base({ sessions: { a: [sess(ago(3), '23:30:00'), sess(ago(4), '23:40:00'), sess(ago(5), '23:50:00')] } });
      const sendPush = jest.fn().mockResolvedValue({});
      await runTick({ store, sendPush, now: at(TODAY, '22:30') });
      expect(sendPush).not.toHaveBeenCalled();
      await runTick({ store, sendPush, now: at(TODAY, '21:30') });
      expect(sendPush).toHaveBeenCalledTimes(1);
    });
  });
});

describe('邀请推送', () => {
  test('绕过每日上限与静默时段，立即发送', async () => {
    const store = makeStore({
      subs: [sub('a')],
      profiles: [dailyProfile('a')],
      deliveries: [{ user_id: 'a', sent_date: TODAY, kind: 'inactive' }], // 今天已发过非邀请推送
      pending: { a: 5 },
      alreadyClaimed: ['a'],
    });
    const sendPush = jest.fn().mockResolvedValue({});
    const res = await sendInvite({ store, sendPush, studentId: 'a', teacherName: '王老师', now: at(TODAY, '23:30') });
    expect(res.sent).toBe(1);
    expect(store.calls.claim).toEqual([]); // 不占用每日名额
    expect(JSON.parse(sendPush.mock.calls[0][1])).toMatchObject({ tag: 'yb-invite', url: '/notifications' });
    expect(JSON.parse(sendPush.mock.calls[0][1]).body).toContain('王老师');
    expect(JSON.parse(sendPush.mock.calls[0][1]).badge).toBe(5);
  });

  test('学生关闭邀请通知 → 跳过', async () => {
    const store = makeStore({ subs: [sub('a')], profiles: [{ id: 'a', notification_prefs: { invites: false } }] });
    const sendPush = jest.fn();
    const res = await sendInvite({ store, sendPush, studentId: 'a' });
    expect(res.skipped).toBe('invites-off');
    expect(sendPush).not.toHaveBeenCalled();
  });

  test('没有订阅 → 跳过；学生不存在 → 跳过', async () => {
    const store = makeStore({ profiles: [dailyProfile('a')] });
    expect((await sendInvite({ store, sendPush: jest.fn(), studentId: 'a' })).skipped).toBe('no-subscription');
    expect((await sendInvite({ store, sendPush: jest.fn(), studentId: 'zzz' })).skipped).toBe('no-student');
  });

  test('邀请推送遇到 410 同样清理订阅', async () => {
    const store = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')] });
    const sendPush = jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    const res = await sendInvite({ store, sendPush, studentId: 'a' });
    expect(res.removed).toBe(1);
    expect(store.calls.deleted).toEqual(['https://push.example/a/1']);
  });
});

describe('deliver', () => {
  test('error.status 也能识别 410', async () => {
    const store = makeStore();
    const sendPush = jest.fn().mockRejectedValue({ status: 410 });
    const r = await deliver({ subscriptions: [sub('a')], payload: {}, sendPush, store });
    expect(r.removed).toBe(1);
  });
});

describe('createSupabaseStore（mock fetch）', () => {
  function fakeFetch(handler) {
    const calls = [];
    const fn = jest.fn(async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    });
    fn.calls = calls;
    return fn;
  }
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  test('claimDaily：201 → true；409(唯一索引冲突) → false；其它状态抛错', async () => {
    let status = 201;
    const f = fakeFetch(() => json(status, null));
    const store = createSupabaseStore({ url: 'https://p.supabase.co/', serviceKey: 'svc', fetchImpl: f });
    expect(await store.claimDaily('u', TODAY, 'daily')).toBe(true);
    status = 409;
    expect(await store.claimDaily('u', TODAY, 'daily')).toBe(false);
    status = 500;
    await expect(store.claimDaily('u', TODAY, 'daily')).rejects.toThrow();
    expect(f.calls[0].url).toBe('https://p.supabase.co/rest/v1/push_deliveries');
    expect(f.calls[0].init.headers.apikey).toBe('svc');
    expect(JSON.parse(f.calls[0].init.body)).toEqual({ user_id: 'u', sent_date: TODAY, kind: 'daily' });
  });

  test('deleteSubscription 按 endpoint 删除', async () => {
    const f = fakeFetch(() => json(204, null));
    const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });
    await store.deleteSubscription('https://push.example/a?x=1');
    expect(f.calls[0].init.method).toBe('DELETE');
    expect(f.calls[0].url).toContain('push_subscriptions?endpoint=eq.https%3A%2F%2Fpush.example%2Fa%3Fx%3D1');
  });

  test('loadPendingCounts 使用 PLAN 的待补填规则，返回每人数量', async () => {
    const f = fakeFetch(() => json(200, [{ student_id: 'u' }, { student_id: 'u' }, { student_id: 'v' }]));
    const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });
    const map = await store.loadPendingCounts(['u', 'v']);
    expect(map.get('u')).toBe(2);
    expect(map.get('v')).toBe(1);
    const url = f.calls[0].url;
    for (const part of ['category=eq.3', 'grade_label=is.null', 'score=is.null', 'deleted_at=is.null']) {
      expect(url).toContain(part);
    }
  });

  test('loadSessions 只取未删除记录并转成精简结构；loadDeliveries 排除邀请', async () => {
    const f = fakeFetch((url) => (url.includes('learning_sessions')
      ? json(200, [{ student_id: 'u', session_date: '2026-10-18', start_time: '19:00:00', course_id: 'c1', category: 3, form: '自主练习', duration_minutes: 45 }])
      : json(200, [{ user_id: 'u', sent_date: '2026-10-20', kind: 'inactive' }])));
    const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });
    const map = await store.loadSessions(['u'], '2026-08-22');
    expect(map.get('u')).toEqual([sess('2026-10-18')]);
    expect(f.calls[0].url).toContain('deleted_at=is.null');
    expect(f.calls[0].url).toContain('session_date=gte.2026-08-22');
    const rows = await store.loadDeliveries(['u'], '2026-09-21');
    expect(rows).toHaveLength(1);
    expect(f.calls[1].url).toContain('kind=neq.invite');
  });

  test('listSubscriptions 自动翻页', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => sub('u', i));
    let n = 0;
    const f = fakeFetch(() => json(200, n++ === 0 ? page : [sub('u', 'last')]));
    const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });
    expect(await store.listSubscriptions()).toHaveLength(1001);
    expect(f.calls[1].url).toContain('offset=1000');
  });
});
