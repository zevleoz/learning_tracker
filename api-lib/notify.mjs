// Web Push 通知的决策与投递逻辑（服务端使用，绝不进入前端 bundle）。
//
// 分层：
//   - 纯函数（时间、偏好、连续记录、到期判定）：selectDue / computeStreakState 等，可直接单测
//   - runTick / sendInvite：编排「读数据 → 判定 → 占位 → 推送 → 清理失效订阅」，
//     数据访问（store）与推送（sendPush）都由调用方注入，测试里用 mock 替换
//   - createSupabaseStore：用 service role 经 PostgREST 访问 Supabase 的 store 实现
//
// 规则（全部按 Asia/Shanghai 时间，UTC+8 无夏令时）：
//   - 每日提醒：到达学生设定的时间点，且当天没有任何记录
//   - 待补填摘要：昨天有「待补填」记录，次日 18:00 起提醒（数量含此前所有待补填）
//   - 连续记录提醒：20:30 起，今天还没记录、连续记录仍然有效、且本周 2 个休息日已用完
//   - 邀请：type='invite' 立即发送，不受每日上限与静默时段限制
//   - 每位学生每天最多 1 条非邀请推送（push_deliveries 的部分唯一索引兜底，并发安全）
//   - 静默时段 22:30–07:00 不发非邀请推送
//   - 推送返回 404/410 的订阅视为失效，立即删除
//   - 没有任何「分钟目标」概念

export const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

export const QUIET_START_MIN = 22 * 60 + 30; // 22:30
export const QUIET_END_MIN = 7 * 60; // 07:00
export const DIGEST_TIME_MIN = 18 * 60; // 18:00
export const STREAK_TIME_MIN = 20 * 60 + 30; // 20:30
export const REST_DAYS_PER_WEEK = 2;
// 连续记录只回看这么多天（够判定「连续是否有效」，避免全量拉取历史）
export const STREAK_LOOKBACK_DAYS = 120;

export const DEFAULT_PREFS = Object.freeze({
  daily_reminder: false,
  daily_reminder_time: '21:00',
  pending_digest: true,
  streak_reminder: true,
  invites: true,
  weekly_email: false,
});

// 非邀请推送的优先级：同一轮多条同时到期时只发第一条（每天仅 1 条）
export const KIND_PRIORITY = ['streak', 'daily', 'digest'];

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

/** 'YYYY-MM-DD' 所在周的周一（周一至周日为一周）。 */
export function weekStart(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日
  return addDays(ymd, -((dow + 6) % 7));
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

/** 合并默认值；字段类型不对时回退默认，保证判定逻辑不会被脏数据带偏。 */
export function normalizePrefs(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULT_PREFS };
  for (const key of ['daily_reminder', 'pending_digest', 'streak_reminder', 'invites', 'weekly_email']) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  if (parseTimeOfDay(src.daily_reminder_time) != null) {
    out.daily_reminder_time = String(src.daily_reminder_time).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// 连续记录（与 PLAN 中 computeStreak 同一规则的服务端精简版）
// ---------------------------------------------------------------------------

/**
 * 有记录的日子计入连续；每个周一至周日的周内最多 2 个无记录日不打断连续
 * （也不增加连续天数）；今天尚无记录不打断。
 *
 * @param {Iterable<string>} sessionDates 有未删除记录的日期（'YYYY-MM-DD'）
 * @param {string} today 上海今天
 * @returns {{ current: number, restDaysUsedThisWeek: number }}
 */
export function computeStreakState(sessionDates, today, { restDaysPerWeek = REST_DAYS_PER_WEEK } = {}) {
  const dates = new Set(sessionDates);
  let earliest = null;
  for (const d of dates) if (earliest == null || d < earliest) earliest = d;
  if (earliest == null) return { current: 0, restDaysUsedThisWeek: 0 };

  const thisWeek = weekStart(today);
  const restByWeek = new Map();
  let current = 0;
  let restThisWeek = 0;
  let cursor = dates.has(today) ? today : addDays(today, -1);
  // 今天有记录：从今天算起；否则从昨天往回走（今天空着不打断）
  for (let guard = 0; guard < 4000 && cursor >= earliest; guard += 1) {
    if (dates.has(cursor)) {
      current += 1;
    } else {
      const wk = weekStart(cursor);
      const used = restByWeek.get(wk) || 0;
      if (used >= restDaysPerWeek) break;
      restByWeek.set(wk, used + 1);
      if (wk === thisWeek) restThisWeek += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return { current, restDaysUsedThisWeek: restThisWeek };
}

// ---------------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------------

export const APP_TITLE = '一表人才';

export function buildPayload(kind, ctx = {}) {
  switch (kind) {
    case 'daily':
      return {
        title: APP_TITLE,
        body: '今天还没有学习记录，花点时间记一笔吧。',
        url: '/learning?log=1',
        tag: 'yb-daily',
      };
    case 'digest':
      return {
        title: APP_TITLE,
        body: `有 ${ctx.pendingCount} 条练习的客观评价待补填。`,
        url: '/learning',
        tag: 'yb-digest',
      };
    case 'streak':
      return {
        title: APP_TITLE,
        body: `已连续记录 ${ctx.streak} 天，本周休息日已用完，今天记一笔就能保住连续。`,
        url: '/learning?log=1',
        tag: 'yb-streak',
      };
    case 'invite':
      return {
        title: APP_TITLE,
        body: ctx.teacherName ? `${ctx.teacherName} 邀请你建立导师连接。` : '你收到一条新的导师邀请。',
        url: '/notifications',
        tag: 'yb-invite',
      };
    default:
      throw new Error(`unknown notification kind: ${kind}`);
  }
}

// ---------------------------------------------------------------------------
// 到期判定（纯函数）
// ---------------------------------------------------------------------------

/**
 * @typedef {object} StudentCtx
 * @property {string} id
 * @property {object} [prefs]               profiles.notification_prefs（可缺省/脏数据）
 * @property {string[]} [sessionDates]      有未删除记录的日期
 * @property {string[]} [pendingDates]      「待补填」记录的 session_date
 *                                          （category=3、grade_label 为空、score 为空、未删除）
 *
 * 返回某个学生此刻应发的那一种（至多一种）非邀请提醒，没有则 null。
 * 不检查「今天是否已发过」——那由 selectDue 的 sentToday 与 store.claim 负责。
 */
export function dueKindFor(student, clock) {
  if (isQuietHours(clock.minutes)) return null;
  const prefs = normalizePrefs(student.prefs);
  const dates = new Set(student.sessionDates || []);
  const loggedToday = dates.has(clock.date);
  const due = {};

  if (!loggedToday) {
    if (prefs.daily_reminder) {
      const at = parseTimeOfDay(prefs.daily_reminder_time);
      if (at != null && clock.minutes >= at) due.daily = buildPayload('daily');
    }
    if (prefs.streak_reminder && clock.minutes >= STREAK_TIME_MIN) {
      const { current, restDaysUsedThisWeek } = computeStreakState(dates, clock.date);
      if (current > 0 && restDaysUsedThisWeek >= REST_DAYS_PER_WEEK) {
        due.streak = buildPayload('streak', { streak: current });
      }
    }
  }

  if (prefs.pending_digest && clock.minutes >= DIGEST_TIME_MIN) {
    const pending = student.pendingDates || [];
    const yesterday = addDays(clock.date, -1);
    // 次日 18:00 起提醒：昨天有待补填；数量含昨天及更早的所有待补填
    if (pending.includes(yesterday)) {
      const count = pending.filter((d) => d <= yesterday).length;
      due.digest = buildPayload('digest', { pendingCount: count });
    }
  }

  for (const kind of KIND_PRIORITY) {
    if (due[kind]) return { kind, payload: due[kind] };
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
    if (hit) out.push({ userId: student.id, kind: hit.kind, payload: hit.payload });
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
export async function runTick({ store, sendPush, now = new Date() }) {
  const summary = { considered: 0, due: 0, sent: 0, removed: 0, failed: 0 };
  const clock = shanghaiClock(now);
  if (isQuietHours(clock.minutes)) return { ...summary, skipped: 'quiet-hours' };

  const subs = await store.listSubscriptions();
  const subsByUser = groupByUser(subs);
  const userIds = [...subsByUser.keys()];
  if (userIds.length === 0) return summary;

  const profiles = await store.loadProfiles(userIds);
  // 只有至少开启一种非邀请提醒的学生才需要继续读记录
  const active = profiles.filter((p) => {
    const prefs = normalizePrefs(p.notification_prefs);
    return prefs.daily_reminder || prefs.pending_digest || prefs.streak_reminder;
  });
  summary.considered = active.length;
  if (active.length === 0) return summary;

  const ids = active.map((p) => p.id);
  const since = addDays(clock.date, -STREAK_LOOKBACK_DAYS);
  const [datesByUser, pendingByUser, sentToday] = await Promise.all([
    store.loadSessionDates(ids, since),
    store.loadPendingDates(ids),
    store.loadSentToday(ids, clock.date),
  ]);

  const students = active.map((p) => ({
    id: p.id,
    prefs: p.notification_prefs,
    sessionDates: datesByUser.get(p.id) || [],
    pendingDates: pendingByUser.get(p.id) || [],
  }));
  const due = selectDue({ students, clock, sentToday });
  summary.due = due.length;

  for (const item of due) {
    // 先占位再发送：部分唯一索引保证并发的两次轮询只有一次成功
    const claimed = await store.claimDaily(item.userId, clock.date, item.kind);
    if (!claimed) continue;
    const r = await deliver({
      subscriptions: subsByUser.get(item.userId) || [],
      payload: item.payload,
      sendPush,
      store,
    });
    summary.sent += r.sent;
    summary.removed += r.removed;
    summary.failed += r.failed;
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

  const r = await deliver({
    subscriptions,
    payload: buildPayload('invite', { teacherName }),
    sendPush,
    store,
  });
  // 审计记录（invite 不受唯一索引约束），失败不影响结果
  await store.logInvite?.(studentId, shanghaiClock(now).date).catch(() => {});
  return r;
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
        out.push(...(await getJson(`profiles?select=id,notification_prefs&id=${inList(part)}`)));
      }
      return out;
    },
    async loadSessionDates(ids, since) {
      const map = new Map();
      for (const part of chunk(ids, IN_CHUNK)) {
        const rows = await getAll(
          `learning_sessions?select=student_id,session_date&deleted_at=is.null`
            + `&session_date=gte.${since}&student_id=${inList(part)}&order=session_date.asc`,
        );
        for (const r of rows) {
          if (!map.has(r.student_id)) map.set(r.student_id, new Set());
          map.get(r.student_id).add(r.session_date);
        }
      }
      return new Map([...map].map(([k, v]) => [k, [...v]]));
    },
    async loadPendingDates(ids) {
      const map = new Map();
      for (const part of chunk(ids, IN_CHUNK)) {
        // 待补填：category=3、grade_label 为空、score 为空、未删除
        const rows = await getAll(
          `learning_sessions?select=student_id,session_date&category=eq.3`
            + `&grade_label=is.null&score=is.null&deleted_at=is.null&student_id=${inList(part)}`,
        );
        for (const r of rows) {
          if (!map.has(r.student_id)) map.set(r.student_id, []);
          map.get(r.student_id).push(r.session_date);
        }
      }
      return map;
    },
    async loadSentToday(ids, date) {
      const set = new Set();
      for (const part of chunk(ids, IN_CHUNK)) {
        const rows = await getAll(
          `push_deliveries?select=user_id&sent_date=eq.${date}&kind=neq.invite&user_id=${inList(part)}`,
        );
        for (const r of rows) set.add(r.user_id);
      }
      return set;
    },
    /** @returns {Promise<boolean>} true=占位成功；false=今天已发过（唯一索引冲突） */
    async claimDaily(userId, date, kind) {
      const res = await request('push_deliveries', {
        method: 'POST',
        body: { user_id: userId, sent_date: date, kind },
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
