// 学生端提醒偏好（profiles.notification_prefs）的读写与「注册后前 30 天强制每日提醒」的判定。
// 服务端的同一套规则在 api-lib/notify.mjs（那边绝不进入前端 bundle，所以这里单独留一份纯函数）。
import { supabase } from './supabase';

export const DEFAULT_PREFS = {
  inactive_reminder: true,
  daily_reminder: false,
  daily_reminder_time: '21:00',
  invites: true,
  push_card_dismissed: false,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const FORCED_DAILY_DAYS = 30;
const CARD_DISMISSED_KEY = 'yb:push-card-dismissed';

export function normalizePrefs(raw) {
  const out = { ...DEFAULT_PREFS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULT_PREFS)) {
      if (typeof raw[k] === typeof DEFAULT_PREFS[k]) out[k] = raw[k];
    }
  }
  if (!TIME_RE.test(out.daily_reminder_time)) out.daily_reminder_time = DEFAULT_PREFS.daily_reminder_time;
  return out;
}

// 列不存在：Postgres 42703，PostgREST 会报 "column ... does not exist"
export function isMissingColumn(err) {
  if (!err) return false;
  return err.code === '42703' || err.code === 'PGRST204' || /notification_prefs|does not exist/i.test(err.message || '');
}

const pad2 = (n) => String(n).padStart(2, '0');
function ymd(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
/** 上海（UTC+8）的日历日，与服务端判定一致。 */
export function shanghaiDate(now = new Date()) {
  return ymd(new Date(new Date(now).getTime() + 8 * 3600 * 1000));
}

/**
 * 每日提醒的强制期：注册当天起 30 天（含注册当天），返回最后一个强制日 'YYYY-MM-DD'；缺注册时间返回 null。
 */
export function forcedDailyUntil(createdAt) {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return null;
  const [y, m, d] = shanghaiDate(new Date(t)).split('-').map(Number);
  return ymd(new Date(Date.UTC(y, m - 1, d + FORCED_DAILY_DAYS - 1)));
}

export function isDailyForced(createdAt, now = new Date()) {
  const until = forcedDailyUntil(createdAt);
  return until != null && shanghaiDate(now) <= until;
}

/** 'YYYY-MM-DD' → 「11月24日」。 */
export function fmtMonthDay(dateStr) {
  const [, m, d] = String(dateStr).split('-').map(Number);
  return `${m}月${d}日`;
}

/** @returns {Promise<{ prefs: object, createdAt: string|null, available: boolean }>} */
export async function loadPrefs(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('notification_prefs, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    return { prefs: normalizePrefs(null), createdAt: null, available: !isMissingColumn(error), error };
  }
  return { prefs: normalizePrefs(data?.notification_prefs), createdAt: data?.created_at || null, available: true };
}

/** @returns {Promise<{ ok: boolean, missingColumn?: boolean }>} */
export async function savePrefs(userId, prefs) {
  const { error } = await supabase.from('profiles').update({ notification_prefs: prefs }).eq('id', userId);
  if (error) return { ok: false, missingColumn: isMissingColumn(error) };
  return { ok: true };
}

export function isCardDismissedLocally() {
  try {
    return window.localStorage.getItem(CARD_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 「不用」：优先写 notification_prefs；列不存在或写失败时退到 localStorage。 */
export async function dismissPushCard(userId, currentPrefs) {
  const res = await savePrefs(userId, { ...normalizePrefs(currentPrefs), push_card_dismissed: true });
  if (res.ok) return;
  try {
    window.localStorage.setItem(CARD_DISMISSED_KEY, '1');
  } catch {
    // 无法持久化时，本次会话内仍然隐藏
  }
}
