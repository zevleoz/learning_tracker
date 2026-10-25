// Web Push 通知的决策与投递逻辑（服务端使用，绝不进入前端 bundle）。
//
// 分层：
//   - 纯函数（时间、偏好、到期判定、文案）：dueKindFor / selectDue 等，可直接单测
//   - runTick / sendInvite：编排「读数据 → 判定 → 占位 → 推送 → 清理失效订阅」，
//     数据访问（store）与推送（sendPush）都由调用方注入，测试里用 mock 替换
//   - createSupabaseStore：用 service role 经 PostgREST 访问 Supabase 的 store 实现
//
// 推送只有三种（全部按 Asia/Shanghai 时间，UTC+8 无夏令时）：
//   - inactive 几天没记录：最后一条记录日期 = 今天 − 3 天时发一条；仍没记录、到 − 7 天时再发一条；
//     之后什么都不发，直到学生再记录（新记录让「最后记录日期」前移，循环自然重置）。
//     发送时刻 = 学生的惯用记录时间（最近 20 条记录开始时刻的中位数，夹在 08:00–21:30；少于 3 条用 19:30）。
//     已发过几条由 push_deliveries（kind='inactive'，sent_date 晚于最后记录日期）推算，不需要新表。
//   - daily 每日提醒：学生设定的时间（默认 21:00），当天没有任何记录才发；
//     注册后的前 30 天强制开启（不看偏好），之后按偏好（默认关）
//   - invite 导师邀请：立即发送，不受每日上限与静默时段限制
//   - 非邀请推送每位学生每天最多 1 条（push_deliveries 的部分唯一索引兜底，并发安全）；
//     同时到期时 inactive 优先于 daily（当天要发 inactive 时 daily 让位）
//   - 静默时段 22:30–07:00 不发非邀请推送
//   - 每条推送都带 badge = 学生的「待补填」数量；本身绝不会为待补填单独发推送
//   - 推送返回 404/410 的订阅视为失效，立即删除
//   - 邮件兜底（api-lib/notify-email.mjs）：只在第 3 天、且没有可用推送订阅（从没订阅，或订阅在本轮全部 404/410）时
//     发一封「三天没记录了」邮件；第 7 天绝不发邮件、有可用订阅的人也不发。记为 push_deliveries(kind='inactive', channel='email')，
//     所以第 3/7 天的次数统计与每日上限照常生效；SMTP 未配置则静默跳过。
//   - 「发送测试通知」（sendTest）：只发给本人订阅，不写 push_deliveries，每用户 60 秒一次（notification_prefs.last_test_at）
//   - 没有任何「分钟目标」概念

export const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

export const QUIET_START_MIN = 22 * 60 + 30; // 22:30
export const QUIET_END_MIN = 7 * 60; // 07:00

// 几天没记录：第一次 / 第二次提醒对应的「最后记录日期距今天数」
export const INACTIVE_FIRST_DAYS = 3;
export const INACTIVE_SECOND_DAYS = 7;
// 惯用记录时间：取最近 20 条记录；少于 3 条用默认值；结果夹在 [08:00, 21:30]
export const USUAL_SAMPLE_SIZE = 20;
export const USUAL_MIN_SAMPLES = 3;
export const USUAL_DEFAULT_MIN = 19 * 60 + 30; // 19:30
export const USUAL_CLAMP_MIN = 8 * 60; // 08:00
export const USUAL_CLAMP_MAX = 21 * 60 + 30; // 21:30
// 注册后的前 30 天（含注册当天）每日提醒强制开启
export const FORCED_DAILY_DAYS = 30;
// 只回看这么多天的记录（足够取最近 20 条与判断是否活跃，避免全量拉取历史）
export const SESSION_LOOKBACK_DAYS = 60;
export const DELIVERY_LOOKBACK_DAYS = 30;

export const DEFAULT_PREFS = Object.freeze({
  inactive_reminder: true,
  daily_reminder: false,
  daily_reminder_time: '21:00',
  invites: true,
  email_fallback: true,
});

// 测试通知：同一用户两次之间至少间隔这么久
export const TEST_COOLDOWN_MS = 60 * 1000;

const CATEGORY_LABEL = { 1: '学习', 2: '复习', 3: '练习' };

// ---------------------------------------------------------------------------
// 时间
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

function ymdFromUtcDate(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 把 'YYYY-MM-DD' 加减若干天（纯日历运算，与时区无关）。 */
export function addDays(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  return ymdFromUtcDate(new Date(Date.UTC(y, m - 1, d + delta)));
}

/** 两个 'YYYY-MM-DD' 相差的天数（a − b）。 */
export function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/** @returns {{ date: string, minutes: number }} 上海当前日期与当天分钟数 */
export function shanghaiClock(now = new Date()) {
  const shifted = new Date(new Date(now).getTime() + SHANGHAI_OFFSET_MS);
  return {
    date: ymdFromUtcDate(shifted),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function isQuietHours(minutes) {
  return minutes >= QUIET_START_MIN || minutes < QUIET_END_MIN;
}

/** 'HH:MM' → 分钟数；非法返回 null。 */
export function parseTimeOfDay(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// ---------------------------------------------------------------------------
// 偏好
// ---------------------------------------------------------------------------

/** 合并默认值；字段类型不对时回退默认，保证判定逻辑不会被脏数据带偏。旧版的多余字段直接忽略。 */
export function normalizePrefs(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULT_PREFS };
  for (const key of ['inactive_reminder', 'daily_reminder', 'invites', 'email_fallback']) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  if (parseTimeOfDay(src.daily_reminder_time) != null) {
    out.daily_reminder_time = String(src.daily_reminder_time).trim();
  }
  return out;
}

/**
 * 注册后前 30 天（含注册当天）每日提醒强制开启：返回最后一个强制日（上海日期），缺注册时间返回 null。
 * @param {string|Date|null|undefined} createdAt profiles.created_at
 */
export function forcedDailyUntil(createdAt) {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return null;
  return addDays(shanghaiClock(new Date(t)).date, FORCED_DAILY_DAYS - 1);
}

export function isDailyForced(createdAt, today) {
  const until = forcedDailyUntil(createdAt);
  return until != null && today <= until;
}

// ---------------------------------------------------------------------------
// 记录分析（纯函数）
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SessionLite
 * @property {string} date            session_date（YYYY-MM-DD）
 * @property {string} [startTime]     start_time（'HH:MM[:SS]'）
 * @property {string} [courseId]
 * @property {number} [category]      1 学习 / 2 复习 / 3 练习
 * @property {string} [form]
 * @property {number} [minutes]
 */

function startMinutes(s) {
  return parseTimeOfDay(String(s.startTime ?? '').slice(0, 5));
}

function byRecency(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const x = startMinutes(a) ?? -1;
  const y = startMinutes(b) ?? -1;
  return y - x;
}

/** 最后一条记录（日期最晚，同日取开始时刻最晚）；忽略今天之后的日期。没有则 null。 */
export function lastSession(sessions, today) {
  const rows = (sessions || []).filter((s) => s?.date && s.date <= today);
  if (rows.length === 0) return null;
  return [...rows].sort(byRecency)[0];
}

/**
 * 学生惯用的记录时间（分钟）：最近 20 条记录开始时刻（小时，含分钟的小数）的中位数，
 * 夹在 08:00–21:30。有开始时刻的记录少于 3 条时用 19:30。
 */
export function usualLogMinutes(sessions, today) {
  const recent = (sessions || [])
    .filter((s) => s?.date && s.date <= today && startMinutes(s) != null)
    .sort(byRecency)
    .slice(0, USUAL_SAMPLE_SIZE);
  if (recent.length < USUAL_MIN_SAMPLES) return USUAL_DEFAULT_MIN;
  // 按「开始时刻所在的整点」取中位数（偶数条时取中间两个整点的平均，可落在半点）
  const hours = recent.map((s) => Math.floor(startMinutes(s) / 60)).sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  const medianHour = hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
  return Math.min(USUAL_CLAMP_MAX, Math.max(USUAL_CLAMP_MIN, Math.round(medianHour * 60)));
}

/**
 * 今天该不该走「几天没记录」：返回 3（第一次）、7（第二次）或 null。
 *  - 最后记录日期 = 今天 − 3：还没发过 → 第一次
 *  - 最后记录日期 = 今天 − 7：之前至多发过一次 → 第二次
 *  - 其它天（含 4–6 天、8 天以上）一律不发；从没有过记录的学生也不发
 * 已发次数 = push_deliveries 里 kind='inactive' 且 sent_date 晚于最后记录日期的行数；
 * 学生再记录后最后记录日期前移，旧的投递记录自然不再计入。
 */
export function inactiveStage({ last, inactiveSentDates = [], today }) {
  if (!last) return null;
  const gap = diffDays(today, last.date);
  const sent = inactiveSentDates.filter((d) => d > last.date).length;
  if (gap === INACTIVE_FIRST_DAYS && sent === 0) return INACTIVE_FIRST_DAYS;
  if (gap === INACTIVE_SECOND_DAYS && sent <= 1) return INACTIVE_SECOND_DAYS;
  return null;
}

// ---------------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------------

export const APP_TITLE = '一表人才';

/** 「几天没记录」点开后直接带着上次的课程 / 类别 / 形式 / 时长打开记一笔。 */
export function buildInactiveUrl(last) {
  const q = new URLSearchParams({ log: '1' });
  if (last?.courseId) q.set('course', String(last.courseId));
  if ([1, 2, 3].includes(Number(last?.category))) q.set('category', String(Number(last.category)));
  if (last?.form) q.set('form', String(last.form));
  if (Number(last?.minutes) > 0) q.set('minutes', String(Math.round(Number(last.minutes))));
  return `/records?${q.toString()}`;
}

/**
 * @param {'inactive'|'daily'|'invite'|'test'} kind
 * @param {{ badge?: number, stage?: 3|7, last?: SessionLite, courseName?: string, teacherName?: string }} ctx
 *   badge = 学生的「待补填」数量，每条推送都带（图标角标，不为它单独推送）
 */
export function buildPayload(kind, ctx = {}) {
  const badge = Number.isFinite(Number(ctx.badge)) ? Math.max(0, Math.floor(Number(ctx.badge))) : 0;
  switch (kind) {
    case 'inactive': {
      const span = ctx.stage === INACTIVE_SECOND_DAYS ? '一周' : '三天';
      const label = CATEGORY_LABEL[Number(ctx.last?.category)];
      const what = ctx.courseName ? `${ctx.courseName}${label ? ` · ${label}` : ''}` : '';
      return {
        title: APP_TITLE,
        body: what
          ? `${span}没记录了。上次是 ${what}，点一下就能补上。`
          : `${span}没记录了，点一下就能补上。`,
        url: buildInactiveUrl(ctx.last),
        tag: 'yb-inactive',
        badge,
      };
    }
    case 'daily':
      return {
        title: APP_TITLE,
        body: '今天还没有学习记录，花点时间记一笔吧。',
        url: '/records?log=1',
        tag: 'yb-daily',
        badge,
      };
    case 'invite':
      return {
        title: APP_TITLE,
        body: ctx.teacherName ? `${ctx.teacherName} 邀请你建立导师连接。` : '你收到一条新的导师邀请。',
        url: '/notifications',
        tag: 'yb-invite',
        badge,
      };
    case 'test':
      return {
        title: APP_TITLE,
        body: '测试通知：提醒已经开启。',
        url: '/me/reminders',
        tag: 'yb-test',
        badge,
      };
    default:
      throw new Error(`unknown notification kind: ${kind}`);
  }
}

// ---------------------------------------------------------------------------
// 到期判定（纯函数）
// ---------------------------------------------------------------------------

// 非邀请推送的优先级：同一轮多条同时到期时只发第一条（每天仅 1 条）
export const KIND_PRIORITY = ['inactive', 'daily'];

/**
 * @typedef {object} StudentCtx
 * @property {string} id
 * @property {object} [prefs]               profiles.notification_prefs（可缺省/脏数据）
 * @property {string|Date} [createdAt]      profiles.created_at（决定前 30 天强制每日提醒）
 * @property {SessionLite[]} [sessions]     最近一段时间内未删除的记录
 * @property {string[]} [inactiveSentDates] 已发过的 inactive 推送的 sent_date
 * @property {number} [pendingCount]        「待补填」数量（category=3、grade_label 为空、score 为空、未删除）
 * @property {Record<string,string>} [courseNames]  课程 id → 名称（至少含最后一条记录的课程）
 *
 * 返回某个学生此刻应发的那一种（至多一种）非邀请提醒，没有则 null。
 * 不检查「今天是否已发过」——那由 selectDue 的 sentToday 与 store.claim 负责。
 */
export function dueKindFor(student, clock) {
  if (isQuietHours(clock.minutes)) return null;
  const prefs = normalizePrefs(student.prefs);
  const sessions = student.sessions || [];
  const loggedToday = sessions.some((s) => s?.date === clock.date);
  const badge = student.pendingCount || 0;
  const due = {};

  const last = lastSession(sessions, clock.date);
  const stage = prefs.inactive_reminder
    ? inactiveStage({ last, inactiveSentDates: student.inactiveSentDates, today: clock.date })
    : null;
  if (stage && clock.minutes >= usualLogMinutes(sessions, clock.date)) {
    due.inactive = buildPayload('inactive', {
      badge, stage, last, courseName: student.courseNames?.[last.courseId],
    });
  }

  // 今天要发「几天没记录」时，每日提醒让位（即使每日提醒的时间更早）
  if (!stage && !loggedToday && (prefs.daily_reminder || isDailyForced(student.createdAt, clock.date))) {
    const at = parseTimeOfDay(prefs.daily_reminder_time);
    if (at != null && clock.minutes >= at) due.daily = buildPayload('daily', { badge });
  }

  for (const kind of KIND_PRIORITY) {
    if (due[kind]) return { kind, payload: due[kind], stage: kind === 'inactive' ? stage : null };
  }
  return null;
}

/**
 * @param {{ students: StudentCtx[], clock: {date:string, minutes:number}, sentToday?: Set<string> }} args
 * @returns {{ userId: string, kind: string, payload: object }[]}
 */
export function selectDue({ students, clock, sentToday = new Set() }) {
  if (isQuietHours(clock.minutes)) return [];
  const out = [];
  for (const student of students) {
    if (sentToday.has(student.id)) continue; // 每天最多 1 条非邀请推送
    const hit = dueKindFor(student, clock);
    if (hit) out.push({ userId: student.id, kind: hit.kind, payload: hit.payload, stage: hit.stage });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 投递
// ---------------------------------------------------------------------------

export function isGoneStatus(err) {
  const code = err?.statusCode ?? err?.status;
  return code === 404 || code === 410;
}

/**
 * 向一个用户的所有订阅推送同一条消息；404/410 的订阅从库里删除。
 * 其它错误只计数，不删订阅（可能是临时故障）。
 */
export async function deliver({ subscriptions, payload, sendPush, store }) {
  const result = { sent: 0, removed: 0, failed: 0 };
  const body = JSON.stringify(payload);
  for (const sub of subscriptions) {
    try {
      await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      result.sent += 1;
    } catch (err) {
      if (isGoneStatus(err)) {
        result.removed += 1;
        try {
          await store.deleteSubscription(sub.endpoint);
        } catch (delErr) {
          console.warn('[notify] 删除失效订阅失败', delErr?.message);
        }
      } else {
        result.failed += 1;
        console.warn('[notify] 推送失败', err?.statusCode ?? '', err?.message);
      }
    }
  }
  if (result.sent > 0) {
    try {
      await store.touchSubscriptions(
        subscriptions.map((s) => s.endpoint),
      );
    } catch {
      // last_used_at 只是辅助信息，失败不影响结果
    }
  }
  return result;
}

function groupByUser(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(row);
  }
  return map;
}

/**
 * 定时轮询入口（约每 15 分钟一次）。
 * @returns {Promise<{ skipped?: string, considered: number, due: number, sent: number, removed: number, failed: number }>}
 */
export async function runTick({ store, sendPush, mailer = null, now = new Date() }) {
  const summary = { considered: 0, due: 0, sent: 0, removed: 0, failed: 0, emailed: 0 };
  const clock = shanghaiClock(now);
  if (isQuietHours(clock.minutes)) return { ...summary, skipped: 'quiet-hours' };

  const subs = await store.listSubscriptions();
  const subsByUser = groupByUser(subs);
  const pushUserIds = [...subsByUser.keys()];

  // 邮件兜底的候选：恰好在 3 天前记过最后一条、且没有任何订阅的学生（没配置发信器就不查）
  let emailCandidateIds = [];
  if (mailer && store.listLoggedOn) {
    try {
      const logged = await store.listLoggedOn(addDays(clock.date, -INACTIVE_FIRST_DAYS));
      emailCandidateIds = logged.filter((id) => !subsByUser.has(id));
    } catch (err) {
      console.warn('[notify] 读取邮件兜底候选失败', err?.message);
    }
  }
  const userIds = [...pushUserIds, ...emailCandidateIds];
  if (userIds.length === 0) return summary;

  const profiles = await store.loadProfiles(userIds);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  // 只有至少会收到一种非邀请提醒的学生才需要继续读记录（前 30 天每日提醒强制开启）；
  // 没有订阅的学生只可能走邮件兜底，需要同时开着「几天没记录」与「邮件兜底」
  const active = profiles.filter((p) => {
    const prefs = normalizePrefs(p.notification_prefs);
    if (!subsByUser.has(p.id)) return prefs.inactive_reminder && prefs.email_fallback;
    return prefs.inactive_reminder || prefs.daily_reminder || isDailyForced(p.created_at, clock.date);
  });
  summary.considered = active.length;
  if (active.length === 0) return summary;

  const ids = active.map((p) => p.id);
  const [sessionsByUser, deliveries, pendingByUser] = await Promise.all([
    store.loadSessions(ids, addDays(clock.date, -SESSION_LOOKBACK_DAYS)),
    store.loadDeliveries(ids, addDays(clock.date, -DELIVERY_LOOKBACK_DAYS)),
    store.loadPendingCounts(ids),
  ]);

  const sentToday = new Set();
  const inactiveSent = new Map();
  for (const d of deliveries) {
    if (d.sent_date === clock.date) sentToday.add(d.user_id);
    if (d.kind === 'inactive') {
      if (!inactiveSent.has(d.user_id)) inactiveSent.set(d.user_id, []);
      inactiveSent.get(d.user_id).push(d.sent_date);
    }
  }

  // 推送正文要写上「上次记了什么」：只查最后一条记录的课程名
  const lastByUser = new Map(active.map((p) => [p.id, lastSession(sessionsByUser.get(p.id) || [], clock.date)]));
  const courseIds = [...new Set([...lastByUser.values()].map((l) => l?.courseId).filter(Boolean))];
  const courseNames = courseIds.length ? await store.loadCourseNames(courseIds) : {};

  const students = active.map((p) => ({
    id: p.id,
    prefs: p.notification_prefs,
    createdAt: p.created_at,
    sessions: sessionsByUser.get(p.id) || [],
    inactiveSentDates: inactiveSent.get(p.id) || [],
    pendingCount: pendingByUser.get(p.id) || 0,
    courseNames,
  }));
  const due = selectDue({ students, clock, sentToday });
  summary.due = due.length;

  const emailAllowed = (item) => Boolean(
    mailer
    && item.kind === 'inactive'
    && item.stage === INACTIVE_FIRST_DAYS // 第 7 天绝不发邮件
    && normalizePrefs(profileById.get(item.userId)?.notification_prefs).email_fallback,
  );

  /** 发一封「三天没记录」邮件；已占位（push 订阅刚全部失效）时只在成功后把渠道改成 email。 */
  async function emailInstead(item, { alreadyClaimed }) {
    try {
      if (!alreadyClaimed && !(await store.claimDaily(item.userId, clock.date, 'inactive', 'email'))) return false;
      const to = await store.loadUserEmail(item.userId);
      if (!to) throw new Error('no email address');
      await mailer.sendInactive({ to, userId: item.userId, payload: item.payload });
      if (alreadyClaimed) await store.setDeliveryChannel?.(item.userId, clock.date, 'email').catch(() => {});
      summary.emailed += 1;
      return true;
    } catch (err) {
      console.warn('[notify] 邮件兜底失败', err?.message);
      if (!alreadyClaimed) await store.releaseDaily(item.userId, clock.date).catch(() => {});
      return false;
    }
  }

  for (const item of due) {
    const subscriptions = subsByUser.get(item.userId) || [];
    if (subscriptions.length === 0) {
      // 没有订阅：只有第 3 天的「几天没记录」可以走邮件，其余一律不发
      if (emailAllowed(item)) await emailInstead(item, { alreadyClaimed: false });
      continue;
    }
    // 先占位再发送：部分唯一索引保证并发的两次轮询只有一次成功
    const claimed = await store.claimDaily(item.userId, clock.date, item.kind);
    if (!claimed) continue;
    const r = await deliver({
      subscriptions,
      payload: item.payload,
      sendPush,
      store,
    });
    summary.sent += r.sent;
    summary.removed += r.removed;
    summary.failed += r.failed;
    // 所有订阅都刚被删掉（404/410）且没有临时失败 → 第 3 天改发邮件
    if (r.sent === 0 && r.removed > 0 && r.failed === 0 && emailAllowed(item)) {
      await emailInstead(item, { alreadyClaimed: true });
      continue;
    }
    // 一条都没送达且不是因为订阅失效 → 释放占位，下一轮可重试
    if (r.sent === 0 && r.failed > 0) {
      await store.releaseDaily(item.userId, clock.date).catch(() => {});
    }
  }
  return summary;
}

/**
 * 邀请推送：立即发送，绕过每日上限与静默时段；仅尊重学生关闭「邀请通知」的偏好。
 * 若要让邀请也遵守静默时段，只需在这里加 isQuietHours 判断。
 */
export async function sendInvite({ store, sendPush, studentId, teacherName, now = new Date() }) {
  const [profile] = await store.loadProfiles([studentId]);
  if (!profile) return { skipped: 'no-student', sent: 0, removed: 0, failed: 0 };
  if (!normalizePrefs(profile.notification_prefs).invites) {
    return { skipped: 'invites-off', sent: 0, removed: 0, failed: 0 };
  }
  const subscriptions = await store.listSubscriptionsFor(studentId);
  if (subscriptions.length === 0) return { skipped: 'no-subscription', sent: 0, removed: 0, failed: 0 };
  const badge = (await store.loadPendingCounts([studentId]).catch(() => new Map())).get(studentId) || 0;

  const r = await deliver({
    subscriptions,
    payload: buildPayload('invite', { teacherName, badge }),
    sendPush,
    store,
  });
  // 审计记录（invite 不受唯一索引约束），失败不影响结果
  await store.logInvite?.(studentId, shanghaiClock(now).date).catch(() => {});
  return r;
}

/**
 * 「发送测试通知」：只发给该用户自己的订阅；不写 push_deliveries（不占每日额度）。
 * 用 notification_prefs.last_test_at 做每用户 60 秒限流（条件更新，并发安全）。
 * @returns {Promise<{ sent: number, removed: number, failed: number, skipped?: string, rateLimited?: boolean, retryAfter?: number, message?: string }>}
 */
export async function sendTest({ store, sendPush, userId, now = new Date() }) {
  const none = { sent: 0, removed: 0, failed: 0 };
  const subscriptions = await store.listSubscriptionsFor(userId);
  if (subscriptions.length === 0) {
    return { ...none, skipped: 'no-subscription', message: '这台设备还没开启通知' };
  }
  const [profile] = await store.loadProfiles([userId]);
  const raw = profile?.notification_prefs && typeof profile.notification_prefs === 'object'
    ? profile.notification_prefs : {};
  const last = Date.parse(raw.last_test_at);
  const waitMs = Number.isNaN(last) ? 0 : last + TEST_COOLDOWN_MS - now.getTime();
  const limited = (retryAfter) => ({
    ...none, rateLimited: true, retryAfter, message: `刚发过，请 ${retryAfter} 秒后再试`,
  });
  if (waitMs > 0) return limited(Math.ceil(waitMs / 1000));
  const cutoff = new Date(now.getTime() - TEST_COOLDOWN_MS).toISOString();
  if (!(await store.claimTest(userId, raw, now.toISOString(), cutoff))) {
    return limited(Math.ceil(TEST_COOLDOWN_MS / 1000));
  }
  const badge = (await store.loadPendingCounts([userId]).catch(() => new Map())).get(userId) || 0;
  const r = await deliver({ subscriptions, payload: buildPayload('test', { badge }), sendPush, store });
  return r.sent > 0 ? r : { ...r, message: '没能送达，请稍后再试' };
}

/** 邮件里的一键退订：把 email_fallback 置为 false。 */
export async function unsubscribeEmail({ store, userId }) {
  await store.mergePrefs(userId, { email_fallback: false });
}

// ---------------------------------------------------------------------------
// Supabase store（service role，经 PostgREST）
// ---------------------------------------------------------------------------

const PAGE = 1000;
const IN_CHUNK = 100;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const inList = (ids) => `in.(${ids.map((i) => encodeURIComponent(i)).join(',')})`;

export function createSupabaseStore({ url, serviceKey, fetchImpl = fetch }) {
  const base = String(url || '').replace(/\/$/, '');
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  async function request(path, { method = 'GET', body, prefer, extraHeaders } = {}) {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}), ...(extraHeaders || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  }

  async function getJson(path) {
    const res = await request(path);
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${path.split('?')[0]}`);
    return res.json();
  }

  /** 分页读取（PostgREST 默认单次最多 1000 行）。 */
  async function getAll(path) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const sep = path.includes('?') ? '&' : '?';
      const page = await getJson(`${path}${sep}limit=${PAGE}&offset=${offset}`);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  return {
    listSubscriptions() {
      return getAll('push_subscriptions?select=user_id,endpoint,p256dh,auth&order=created_at.asc');
    },
    listSubscriptionsFor(userId) {
      return getAll(
        `push_subscriptions?select=user_id,endpoint,p256dh,auth&user_id=eq.${encodeURIComponent(userId)}`,
      );
    },
    async loadProfiles(ids) {
      const out = [];
      for (const part of chunk(ids, IN_CHUNK)) {
        out.push(...(await getJson(`profiles?select=id,notification_prefs,created_at&id=${inList(part)}`)));
      }
      return out;
    },
    /** 每位学生 since 之后未删除的记录（用于最后一条记录、惯用时间、今天是否已记录）。 @returns {Promise<Map<string, SessionLite[]>>} */
    async loadSessions(ids, since) {
      const map = new Map();
      for (const part of chunk(ids, IN_CHUNK)) {
        const rows = await getAll(
          `learning_sessions?select=student_id,session_date,start_time,course_id,category,form,duration_minutes`
            + `&deleted_at=is.null&session_date=gte.${since}&student_id=${inList(part)}`
            + `&order=session_date.desc,start_time.desc`,
        );
        for (const r of rows) {
          if (!map.has(r.student_id)) map.set(r.student_id, []);
          map.get(r.student_id).push({
            date: String(r.session_date).slice(0, 10),
            startTime: r.start_time,
            courseId: r.course_id,
            category: r.category,
            form: r.form,
            minutes: r.duration_minutes,
          });
        }
      }
      return map;
    },
    /** 待补填数量：category=3、grade_label 为空、score 为空、未删除。 @returns {Promise<Map<string, number>>} */
    async loadPendingCounts(ids) {
      const map = new Map();
      for (const part of chunk(ids, IN_CHUNK)) {
        const rows = await getAll(
          `learning_sessions?select=student_id&category=eq.3`
            + `&grade_label=is.null&score=is.null&deleted_at=is.null&student_id=${inList(part)}`,
        );
        for (const r of rows) map.set(r.student_id, (map.get(r.student_id) || 0) + 1);
      }
      return map;
    },
    async loadCourseNames(courseIds) {
      const out = {};
      for (const part of chunk(courseIds, IN_CHUNK)) {
        const rows = await getJson(`courses?select=id,name&id=${inList(part)}`);
        for (const r of rows) out[r.id] = r.name;
      }
      return out;
    },
    /** since 之后的非邀请投递记录（今天是否已发过 + inactive 已发次数）。 */
    async loadDeliveries(ids, since) {
      const out = [];
      for (const part of chunk(ids, IN_CHUNK)) {
        out.push(...(await getAll(
          `push_deliveries?select=user_id,sent_date,kind&sent_date=gte.${since}&kind=neq.invite&user_id=${inList(part)}`,
        )));
      }
      return out;
    },
    /** 某天有（未删除）记录的学生 id（邮件兜底候选）。 */
    async listLoggedOn(date) {
      const rows = await getAll(`learning_sessions?select=student_id&deleted_at=is.null&session_date=eq.${date}`);
      return [...new Set(rows.map((r) => r.student_id))];
    },
    /** 学生邮箱：GoTrue admin API（service role）。 */
    async loadUserEmail(userId) {
      const res = await fetchImpl(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
      if (!res.ok) throw new Error(`Supabase auth admin ${res.status}`);
      const user = await res.json();
      return user?.email || '';
    },
    /** 条件更新 last_test_at：只有从没发过或早于 cutoff 才成功。 @returns {Promise<boolean>} */
    async claimTest(userId, rawPrefs, nowIso, cutoffIso) {
      const cond = encodeURIComponent(
        `(notification_prefs->>last_test_at.is.null,notification_prefs->>last_test_at.lt.${cutoffIso})`,
      );
      const res = await request(`profiles?id=eq.${encodeURIComponent(userId)}&or=${cond}&select=id`, {
        method: 'PATCH',
        body: { notification_prefs: { ...(rawPrefs || {}), last_test_at: nowIso } },
        prefer: 'return=representation',
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: profiles test claim`);
      const rows = await res.json();
      return Array.isArray(rows) && rows.length > 0;
    },
    async mergePrefs(userId, patch) {
      const [row] = await getJson(`profiles?select=notification_prefs&id=eq.${encodeURIComponent(userId)}`);
      if (!row) throw new Error('profile not found');
      const res = await request(`profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: { notification_prefs: { ...(row.notification_prefs || {}), ...patch } },
        prefer: 'return=minimal',
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: profiles prefs update`);
    },
    async setDeliveryChannel(userId, date, channel) {
      await request(
        `push_deliveries?user_id=eq.${encodeURIComponent(userId)}&sent_date=eq.${date}&kind=eq.inactive`,
        { method: 'PATCH', body: { channel }, prefer: 'return=minimal' },
      );
    },
    /** @returns {Promise<boolean>} true=占位成功；false=今天已发过（唯一索引冲突） */
    async claimDaily(userId, date, kind, channel) {
      const res = await request('push_deliveries', {
        method: 'POST',
        body: { user_id: userId, sent_date: date, kind, ...(channel ? { channel } : {}) },
        prefer: 'return=minimal',
      });
      if (res.ok) return true;
      if (res.status === 409) return false;
      throw new Error(`Supabase ${res.status}: push_deliveries insert`);
    },
    async releaseDaily(userId, date) {
      await request(
        `push_deliveries?user_id=eq.${encodeURIComponent(userId)}&sent_date=eq.${date}&kind=neq.invite`,
        { method: 'DELETE' },
      );
    },
    async logInvite(userId, date) {
      await request('push_deliveries', {
        method: 'POST',
        body: { user_id: userId, sent_date: date, kind: 'invite' },
        prefer: 'return=minimal',
      });
    },
    async deleteSubscription(endpoint) {
      const res = await request(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: push_subscriptions delete`);
    },
    async touchSubscriptions(endpoints) {
      for (const part of chunk(endpoints, IN_CHUNK)) {
        const list = part.map((e) => `"${e.replace(/"/g, '\\"')}"`).join(',');
        await request(`push_subscriptions?endpoint=in.(${encodeURIComponent(list)})`, {
          method: 'PATCH',
          body: { last_used_at: new Date().toISOString() },
          prefer: 'return=minimal',
        });
      }
    },
    async loadProfileName(id) {
      const [row] = await getJson(`profiles?select=full_name&id=eq.${encodeURIComponent(id)}`);
      return row?.full_name || '';
    },
  };
}
