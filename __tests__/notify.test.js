import {
  addDays,
  buildPayload,
  computeStreakState,
  createSupabaseStore,
  deliver,
  dueKindFor,
  isQuietHours,
  normalizePrefs,
  parseTimeOfDay,
  runTick,
  selectDue,
  sendInvite,
  shanghaiClock,
  weekStart,
} from '../api-lib/notify.mjs';

// 2026-10-21 是周三。上海 = UTC+8，所以 UTC 的 HH:MM 要减 8 小时。
const at = (ymd, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + ((h - 8) * 60 + m) * 60000);
};
const TODAY = '2026-10-21';
const clockAt = (hhmm) => shanghaiClock(at(TODAY, hhmm));

describe('时间工具', () => {
  test('shanghaiClock 按 UTC+8 换算日期与分钟（跨日）', () => {
    expect(shanghaiClock(new Date('2026-10-20T16:30:00Z'))).toEqual({ date: '2026-10-21', minutes: 30 });
    expect(shanghaiClock(new Date('2026-10-21T15:59:00Z'))).toEqual({ date: '2026-10-21', minutes: 23 * 60 + 59 });
  });

  test('weekStart / addDays：周一至周日', () => {
    expect(weekStart('2026-10-21')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // 周日
    expect(weekStart('2026-10-26')).toBe('2026-10-26'); // 周一
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
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
    const students = [{ id: 'a', prefs: { daily_reminder: true, daily_reminder_time: '07:00' }, sessionDates: [] }];
    expect(selectDue({ students, clock: clockAt('23:00') })).toEqual([]);
    expect(selectDue({ students, clock: clockAt('03:00') })).toEqual([]);
  });
});

describe('normalizePrefs', () => {
  test('缺省值：每日提醒关、21:00、其余按计划', () => {
    expect(normalizePrefs(null)).toEqual({
      daily_reminder: false,
      daily_reminder_time: '21:00',
      pending_digest: true,
      streak_reminder: true,
      invites: true,
      weekly_email: false,
    });
  });
  test('脏数据回退默认', () => {
    const p = normalizePrefs({ daily_reminder: 'yes', daily_reminder_time: '99:99', pending_digest: false });
    expect(p.daily_reminder).toBe(false);
    expect(p.daily_reminder_time).toBe('21:00');
    expect(p.pending_digest).toBe(false);
  });
});

describe('computeStreakState', () => {
  test('无记录', () => {
    expect(computeStreakState([], TODAY)).toEqual({ current: 0, restDaysUsedThisWeek: 0 });
  });

  test('今天空着不打断：周一二有记录，周三(今天)空', () => {
    expect(computeStreakState(['2026-10-19', '2026-10-20'], TODAY)).toEqual({
      current: 2,
      restDaysUsedThisWeek: 0,
    });
  });

  test('本周休息日用完：周一记录，周二休，周三(今天)空 → 不算今天，休息日=1', () => {
    // 周一有记录、周二无 → 周二是第 1 个休息日
    expect(computeStreakState(['2026-10-19'], TODAY)).toEqual({ current: 1, restDaysUsedThisWeek: 1 });
  });

  test('本周 2 个休息日已用完（周五今天空）', () => {
    // 周一记录，周二休，周三休，周四记录，周五(今天)空
    expect(computeStreakState(['2026-10-19', '2026-10-22'], '2026-10-23')).toEqual({
      current: 2,
      restDaysUsedThisWeek: 2,
    });
  });

  test('第 3 个空日打断连续', () => {
    // 周一有记录；周二、周三、周四空；今天周五空 → 周四/周三用掉 2 个，周二打断
    const r = computeStreakState(['2026-10-19'], '2026-10-23');
    expect(r.current).toBe(0);
  });

  test('跨周：休息日额度按周重置', () => {
    // 上周：二三记录，四休，五记录，六休，日记录（2 个空日）；本周：周一记录，周二休，周三(今天)空
    const dates = ['2026-10-13', '2026-10-14', '2026-10-16', '2026-10-18', '2026-10-19'];
    expect(computeStreakState(dates, TODAY)).toEqual({ current: 5, restDaysUsedThisWeek: 1 });
    // 上周第 3 个空日（周三 10-14 之前再空一天）会打断
    expect(computeStreakState(['2026-10-13', '2026-10-18', '2026-10-19'], TODAY).current).toBe(2);
  });

  test('今天有记录则从今天算起', () => {
    expect(computeStreakState(['2026-10-21'], TODAY).current).toBe(1);
  });
});

const student = (over = {}) => ({
  id: 'u1',
  prefs: { daily_reminder: true, daily_reminder_time: '21:00' },
  sessionDates: [],
  pendingDates: [],
  ...over,
});

describe('到期判定：每日提醒', () => {
  test('到点且当天没记录 → 到期', () => {
    const hit = dueKindFor(student(), clockAt('21:00'));
    expect(hit.kind).toBe('daily');
    expect(hit.payload.url).toBe('/learning?log=1');
  });

  test('未到点 → 不提醒', () => {
    expect(dueKindFor(student(), clockAt('20:59'))).toBeNull();
  });

  test('当天已有记录 → 不提醒', () => {
    expect(dueKindFor(student({ sessionDates: [TODAY] }), clockAt('21:15'))).toBeNull();
  });

  test('默认偏好（每日提醒关）不提醒', () => {
    expect(dueKindFor(student({ prefs: {} }), clockAt('21:15'))).toBeNull();
  });

  test('学生自选时间 08:00', () => {
    const s = student({ prefs: { daily_reminder: true, daily_reminder_time: '08:00' } });
    expect(dueKindFor(s, clockAt('07:59'))).toBeNull();
    expect(dueKindFor(s, clockAt('08:00')).kind).toBe('daily');
  });
});

describe('到期判定：待补填摘要（次日 18:00）', () => {
  const base = { prefs: { pending_digest: true }, pendingDates: ['2026-10-20'] };

  test('昨天有待补填，18:00 起 → 到期，数量含更早的', () => {
    const s = student({ ...base, pendingDates: ['2026-10-20', '2026-10-18', TODAY] });
    const hit = dueKindFor(s, clockAt('18:00'));
    expect(hit.kind).toBe('digest');
    expect(hit.payload.body).toContain('2 条'); // 今天的不算
  });

  test('17:59 未到', () => {
    expect(dueKindFor(student(base), clockAt('17:59'))).toBeNull();
  });

  test('只有今天的待补填 → 还不提醒', () => {
    expect(dueKindFor(student({ ...base, pendingDates: [TODAY] }), clockAt('19:00'))).toBeNull();
  });

  test('关闭摘要偏好 → 不提醒', () => {
    expect(dueKindFor(student({ ...base, prefs: { pending_digest: false } }), clockAt('19:00'))).toBeNull();
  });

  test('今天已有记录也照样发摘要', () => {
    const s = student({ ...base, sessionDates: [TODAY] });
    expect(dueKindFor(s, clockAt('18:30')).kind).toBe('digest');
  });
});

describe('到期判定：连续记录提醒（20:30、休息日用完）', () => {
  // 周五 2026-10-23：本周一记录，周二/周三休，周四记录，周五(今天)空 → 休息日用完
  const TODAY_FRI = '2026-10-23';
  const sessionDates = ['2026-10-19', '2026-10-22', '2026-10-17'];
  const fri = (hhmm) => shanghaiClock(at(TODAY_FRI, hhmm));
  const s = student({ prefs: { streak_reminder: true }, sessionDates });

  test('20:30 起、休息日用完、今天空 → 到期', () => {
    const hit = dueKindFor(s, fri('20:30'));
    expect(hit.kind).toBe('streak');
    expect(hit.payload.body).toContain('连续记录');
  });

  test('20:29 未到', () => {
    expect(dueKindFor(s, fri('20:29'))).toBeNull();
  });

  test('休息日还没用完 → 不提醒', () => {
    const fewer = student({ prefs: { streak_reminder: true }, sessionDates: ['2026-10-19', '2026-10-20', '2026-10-22'] });
    // 周一二记录，周三休，周四记录 → 只用了 1 个休息日
    expect(dueKindFor(fewer, fri('20:45'))).toBeNull();
  });

  test('今天已记录 → 不提醒', () => {
    expect(dueKindFor({ ...s, sessionDates: [...sessionDates, TODAY_FRI] }, fri('20:45'))).toBeNull();
  });

  test('关闭偏好 → 不提醒', () => {
    expect(dueKindFor({ ...s, prefs: { streak_reminder: false } }, fri('20:45'))).toBeNull();
  });

  test('没有连续记录可保 → 不提醒', () => {
    expect(dueKindFor(student({ prefs: { streak_reminder: true }, sessionDates: [] }), fri('21:00'))).toBeNull();
  });

  test('提醒文案不含任何分钟目标', () => {
    const text = JSON.stringify([
      buildPayload('daily'),
      buildPayload('digest', { pendingCount: 3 }),
      buildPayload('streak', { streak: 5 }),
      buildPayload('invite', { teacherName: '王老师' }),
    ]);
    expect(text).not.toMatch(/目标|还差|分钟/);
  });
});

describe('每天至多一条非邀请推送', () => {
  test('同时到期时只返回一条（streak 优先于 daily 优先于 digest）', () => {
    const s = student({
      prefs: { daily_reminder: true, daily_reminder_time: '18:00', pending_digest: true, streak_reminder: true },
      sessionDates: ['2026-10-19', '2026-10-22', '2026-10-17'],
      pendingDates: ['2026-10-22'],
    });
    const clock = shanghaiClock(at('2026-10-23', '21:00'));
    const due = selectDue({ students: [s], clock });
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe('streak');
  });

  test('今天已发过的学生被跳过', () => {
    const due = selectDue({
      students: [student({ id: 'a' }), student({ id: 'b' })],
      clock: clockAt('21:30'),
      sentToday: new Set(['a']),
    });
    expect(due.map((d) => d.userId)).toEqual(['b']);
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
    loadSessionDates: async () => new Map(Object.entries(over.dates || {})),
    loadPendingDates: async () => new Map(Object.entries(over.pending || {})),
    loadSentToday: async () => new Set(over.sentToday || []),
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
const dailyProfile = (id) => ({ id, notification_prefs: { daily_reminder: true, daily_reminder_time: '21:00' } });

describe('runTick', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('到期学生收到推送，并写入占位与 last_used_at', async () => {
    const store = makeStore({ subs: [sub('a'), sub('a', 2), sub('b')], profiles: [dailyProfile('a'), dailyProfile('b')], dates: { b: [TODAY] } });
    const sendPush = jest.fn().mockResolvedValue({ statusCode: 201 });
    const res = await runTick({ store, sendPush, now: at(TODAY, '21:15') });

    expect(res).toMatchObject({ considered: 2, due: 1, sent: 2, removed: 0, failed: 0 });
    expect(store.calls.claim).toEqual([['a', TODAY, 'daily']]);
    expect(sendPush).toHaveBeenCalledTimes(2);
    const [subscription, body] = sendPush.mock.calls[0];
    expect(subscription).toEqual({ endpoint: 'https://push.example/a/1', keys: { p256dh: 'p', auth: 'a' } });
    expect(JSON.parse(body)).toMatchObject({ title: '一表人才', tag: 'yb-daily', url: '/learning?log=1' });
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
    const preSent = makeStore({ subs: [sub('a')], profiles: [dailyProfile('a')], sentToday: ['a'] });
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

  test('没有任何提醒开启的学生不会触发读记录', async () => {
    const store = makeStore({
      subs: [sub('a')],
      profiles: [{ id: 'a', notification_prefs: { daily_reminder: false, pending_digest: false, streak_reminder: false } }],
    });
    const spy = jest.spyOn(store, 'loadSessionDates');
    const res = await runTick({ store, sendPush: jest.fn(), now: at(TODAY, '21:15') });
    expect(res.considered).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  test('待补填摘要：次日 18:00 发送', async () => {
    const store = makeStore({
      subs: [sub('a')],
      profiles: [{ id: 'a', notification_prefs: {} }],
      pending: { a: ['2026-10-20'] },
    });
    const sendPush = jest.fn().mockResolvedValue({});
    await runTick({ store, sendPush, now: at(TODAY, '18:00') });
    expect(store.calls.claim).toEqual([['a', TODAY, 'digest']]);
    expect(JSON.parse(sendPush.mock.calls[0][1]).body).toContain('1 条');
  });
});

describe('邀请推送', () => {
  test('绕过每日上限与静默时段，立即发送', async () => {
    const store = makeStore({
      subs: [sub('a')],
      profiles: [dailyProfile('a')],
      sentToday: ['a'], // 今天已发过非邀请推送
      alreadyClaimed: ['a'],
    });
    const sendPush = jest.fn().mockResolvedValue({});
    const res = await sendInvite({ store, sendPush, studentId: 'a', teacherName: '王老师', now: at(TODAY, '23:30') });
    expect(res.sent).toBe(1);
    expect(store.calls.claim).toEqual([]); // 不占用每日名额
    expect(JSON.parse(sendPush.mock.calls[0][1])).toMatchObject({ tag: 'yb-invite', url: '/notifications' });
    expect(JSON.parse(sendPush.mock.calls[0][1]).body).toContain('王老师');
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

  test('loadPendingDates 使用 PLAN 的待补填规则', async () => {
    const f = fakeFetch(() => json(200, [{ student_id: 'u', session_date: '2026-10-20' }]));
    const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });
    const map = await store.loadPendingDates(['u']);
    expect(map.get('u')).toEqual(['2026-10-20']);
    const url = f.calls[0].url;
    for (const part of ['category=eq.3', 'grade_label=is.null', 'score=is.null', 'deleted_at=is.null']) {
      expect(url).toContain(part);
    }
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
