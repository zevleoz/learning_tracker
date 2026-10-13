// 「连续 N 天未填写」判定（纯函数，零依赖，jest 直测）
//
// 口径：按学习日（learning_sessions.session_date）判定，与「本周活跃」一致。
// 以今天为 D0，窗口 D-7 ~ D0：
//   - 窗口内有记录，最后记录日 = D0 / D-1        → 不提醒
//   - 最后记录日 <= D-2                          → 「N 天未填写」（N = D0 - 最后记录日）
//   - 窗口内无记录 且 账号创建于窗口内（新账号）   → 不提醒
//   - 窗口内无记录 且 账号创建早于窗口/缺失       → 「7 天以上未填写」（无法精确区分「从未填写的老账号」与「断更超 7 天」）

import { stripToDate } from '../lib/date.js';

export const WINDOW_DAYS = 7;

// 按 UTC 解析定宽 YYYY-MM-DD，返回 b - a 的天数差，规避时区/DST 偏移
export function daysBetween(aIso, bIso) {
  const [ay, am, ad] = String(aIso).slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = String(bIso).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function shiftDate(iso, deltaDays) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * @param {Array<{student_id: string, session_date: string}>} sessions 已按 7 天窗口过滤的学习记录
 * @param {Array<{id: string, created_at?: string}>} students 目标学生元数据（created_at 用于新账号兜底）
 * @param {string} todayIso 今天，本地时区 YYYY-MM-DD
 * @param {{truncated?: boolean}} [opts] sessions 是否被 limit 截断（截断时保守处理未知项，避免假阳性）
 * @returns {{lastDateByStudent: Object, inactiveByStudent: Object, inactiveCount: number}}
 *   inactiveByStudent[studentId] = { days: number, capped: boolean }
 */
export function evaluateInactivity(sessions, students, todayIso, opts = {}) {
  const today = stripToDate(todayIso);
  const yesterday = shiftDate(today, -1);
  const windowStart = shiftDate(today, -WINDOW_DAYS);
  const truncated = opts.truncated === true;

  const lastDateByStudent = {};
  for (const s of sessions || []) {
    const sid = s?.student_id;
    const date = stripToDate(s?.session_date);
    if (!sid || !date) continue;
    if (!lastDateByStudent[sid] || date > lastDateByStudent[sid]) lastDateByStudent[sid] = date;
  }

  const inactiveByStudent = {};
  let inactiveCount = 0;
  for (const st of students || []) {
    const sid = st?.id;
    if (!sid) continue;
    const last = lastDateByStudent[sid];
    if (last) {
      if (last >= yesterday) continue; // 昨天或今天有记录
      inactiveByStudent[sid] = { days: daysBetween(last, today), capped: false };
    } else {
      const created = stripToDate(st.created_at);
      if (created && created >= windowStart) continue; // 新账号，尚未到该填写的程度
      if (truncated) continue; // 数据被截断时无法区分，保守不报
      inactiveByStudent[sid] = { days: WINDOW_DAYS, capped: true };
    }
    inactiveCount++;
  }

  return { lastDateByStudent, inactiveByStudent, inactiveCount };
}

export function formatInactivity({ days, capped } = {}) {
  if (capped) return `${WINDOW_DAYS} 天以上未填写`;
  return `${days} 天未填写`;
}