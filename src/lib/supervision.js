// AI 监督流程的共用规则（纯函数，浏览器 / 服务端 / 测试共用）
//
// 首月：注册当天算第 1 天，第 1–30 天每天看（daily）；第 31 天起每周看（weekly）。
// 「填了」：那一天至少有一条未删除的 learning_sessions（待补填的练习也算填了）。
// 日期一律用 'YYYY-MM-DD' 字符串，按 UTC 计算差值，避开时区和夏令时。

export const NEW_STUDENT_DAYS = 30;
export const GAP_ALERT_DAYS = 3;

// 消息草稿 v2（docs/mentor-landing/PLAN.md · C3）
export const SNOOZE_DAYS = [3, 5, 7];          // 「过几天再说」只给这三个选项
export const NUDGE_MIN_INTERVAL_DAYS = 3;     // 同一个学生两次提醒至少隔 3 天
export const NUDGE_GAP_FIRST_MONTH = 2;       // 首月：昨天和前天都没记
export const NUDGE_GAP_WEEKLY = GAP_ALERT_DAYS;
export const NUDGE_NEVER_FROM_DAY = 3;        // 首月从没记过：注册第 3 天起
export const SKIP_REASONS = ['当面说过了', '请假了', '这条写得不合适'];

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

function toUtc(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 上海时区的今天（服务端用；浏览器里用户本地日期即可） */
export function shanghaiToday(now = new Date()) {
  return fromUtc(new Date(now).getTime() + SHANGHAI_OFFSET_MS);
}

export function addDays(iso, n) {
  return fromUtc(toUtc(iso) + n * 86400000);
}

/** b - a 的天数 */
export function daysBetween(aIso, bIso) {
  return Math.round((toUtc(bIso) - toUtc(aIso)) / 86400000);
}

/** 注册第几天（注册当天 = 1）。signup 可以是 created_at 时间戳，取前 10 位。 */
export function dayNumber(signupIso, todayIso) {
  if (!signupIso) return null;
  return daysBetween(String(signupIso).slice(0, 10), todayIso) + 1;
}

export function isNewStudent(signupIso, todayIso) {
  const n = dayNumber(signupIso, todayIso);
  return n != null && n >= 1 && n <= NEW_STUDENT_DAYS;
}

export function phaseOf(signupIso, todayIso) {
  return isNewStudent(signupIso, todayIso) ? 'daily' : 'weekly';
}

/** 截至 today（含）的最近 n 天，从早到晚 */
export function lastNDays(todayIso, n = 7) {
  return Array.from({ length: n }, (_, i) => addDays(todayIso, i - (n - 1)));
}

/** 上一个完整周（周一到周日）。today 是周一时就是刚过去的那一周。 */
export function lastWeekRange(todayIso) {
  const dow = new Date(toUtc(todayIso)).getUTCDay(); // 0 = 周日
  const thisMonday = addDays(todayIso, -((dow + 6) % 7));
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}

/**
 * 一位学生的填写情况。
 * @param {Iterable<string>} sessionDates 该生记录的 session_date（可含重复、可含更早的日期）
 * @param {string} todayIso
 * @returns {{ days: Array<{date: string, filled: boolean}>, count: number,
 *   todayFilled: boolean, yesterdayFilled: boolean, lastDate: string|null, gap: number|null }}
 *   gap = today − 最后一次记录的日期（今天有记录为 0；从没记录为 null）
 */
export function fillSummary(sessionDates, todayIso) {
  const set = new Set();
  let lastDate = null;
  for (const d of sessionDates || []) {
    const iso = String(d || '').slice(0, 10);
    if (!iso || iso > todayIso) continue;
    set.add(iso);
    if (!lastDate || iso > lastDate) lastDate = iso;
  }
  const days = lastNDays(todayIso, 7).map((date) => ({ date, filled: set.has(date) }));
  return {
    days,
    count: days.filter((d) => d.filled).length,
    todayFilled: set.has(todayIso),
    yesterdayFilled: set.has(addDays(todayIso, -1)),
    lastDate,
    gap: lastDate ? daysBetween(lastDate, todayIso) : null,
  };
}

/**
 * 今日反馈里两份名单的归类（只看已连接的学生）。
 * @returns {'new-missed-yesterday' | 'gap' | null}
 *   new-missed-yesterday：首月，昨天没填（注册当天不算，第 2 天起才有「昨天」）
 *   gap：首月之后，连续 GAP_ALERT_DAYS 天以上没填（从没记录过的也算）
 */
export function attentionOf({ signupIso, summary, todayIso }) {
  const n = dayNumber(signupIso, todayIso);
  if (n != null && n >= 1 && n <= NEW_STUDENT_DAYS) {
    return n >= 2 && !summary.yesterdayFilled ? 'new-missed-yesterday' : null;
  }
  if (summary.gap == null || summary.gap >= GAP_ALERT_DAYS) return 'gap';
  return null;
}
