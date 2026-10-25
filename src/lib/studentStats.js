// 学生端统计纯函数库：只处理已加载的 learning_sessions 行，不访问 Supabase。
//
// 行字段（容错两种形态）：
//   日期     date（Review 页派生）或 session_date，取前 10 位 YYYY-MM-DD
//   课程名   subject（Review 页派生）或 course.name，再退到 course_id
//   category 1 学习 / 2 复习 / 3 练习；self_rating 20–100；
//   grade_label 字母等第、'N/A' 或 null；score；deleted_at（软删除的行一律忽略）
//
// 日期一律按「本地日历日」的 YYYY-MM-DD 字符串处理，周从周一开始。
// 没有任何分钟目标：周对比只和上周比。

import { toLocalDateStr } from './date.js';

// ── 日期工具（字符串 ↔ UTC 日历日，避免 DST / 时区偏移）──
const DAY_MS = 86400000;

function toDateStr(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return toLocalDateStr(d || new Date());
}
function toUtcMs(str) {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUtcMs(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function addDays(str, n) {
  return fromUtcMs(toUtcMs(str) + n * DAY_MS);
}
function diffDays(a, b) {
  return Math.round((toUtcMs(a) - toUtcMs(b)) / DAY_MS);
}
// 周一 = 0 … 周日 = 6
function mondayIndex(str) {
  return (new Date(toUtcMs(str)).getUTCDay() + 6) % 7;
}
function normRange(range) {
  return { start: toDateStr(range.start), end: toDateStr(range.end) };
}

// ── 行读取 ──
function rowDate(s) {
  const raw = s.date || s.session_date;
  return raw ? String(raw).slice(0, 10) : null;
}
function rowMinutes(s) {
  return Number(s.duration_minutes) || 0;
}
function rowCourse(s) {
  if (s.subject) return String(s.subject).trim();
  const c = Array.isArray(s.course) ? s.course[0] : s.course;
  if (c?.name) return String(c.name).trim();
  if (s.course_id) return `课程-${String(s.course_id).slice(0, 8)}`;
  return '未分类';
}
function live(sessions) {
  return (sessions || []).filter((s) => s && !s.deleted_at && rowDate(s));
}
function inRange(sessions, range) {
  const { start, end } = normRange(range);
  return live(sessions).filter((s) => {
    const d = rowDate(s);
    return d >= start && d <= end;
  });
}

// ── weekRange ──
/** 包含 date 的周一至周日：{ start, end }（YYYY-MM-DD）。date 可为 Date 或日期字符串，缺省为今天。 */
export function weekRange(date) {
  const day = toDateStr(date);
  const start = addDays(day, -mondayIndex(day));
  return { start, end: addDays(start, 6) };
}

// ── minutesByCategory ──
/** 区间内各类别分钟数 { study, review, practice, total }；total 含未知类别。 */
export function minutesByCategory(sessions, range) {
  const out = { study: 0, review: 0, practice: 0, total: 0 };
  for (const s of inRange(sessions, range)) {
    const m = rowMinutes(s);
    const cat = Number(s.category);
    if (cat === 1) out.study += m;
    else if (cat === 2) out.review += m;
    else if (cat === 3) out.practice += m;
    out.total += m;
  }
  return out;
}

// ── dailyMinutes ──
/** from..to（含）每天一项 [{ date, minutes }]，无记录的天为 0。 */
export function dailyMinutes(sessions, from, to) {
  const start = toDateStr(from);
  const end = toDateStr(to);
  const by = {};
  for (const s of inRange(sessions, { start, end })) {
    const d = rowDate(s);
    by[d] = (by[d] || 0) + rowMinutes(s);
  }
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, minutes: by[d] || 0 });
  return out;
}

// ── weekOverWeek ──
/**
 * 本周（周一至今天）与上周整周比较：
 * { thisWeek, lastWeek, diff, lastWeekToDate }。
 * diff = thisWeek - lastWeek；lastWeekToDate 是上周同一天为止的分钟数，用于周初公平对比。
 */
export function weekOverWeek(sessions, today = new Date()) {
  const t = toDateStr(today);
  const cur = weekRange(t);
  const lastStart = addDays(cur.start, -7);
  const thisWeek = minutesByCategory(sessions, { start: cur.start, end: t }).total;
  const lastWeek = minutesByCategory(sessions, { start: lastStart, end: addDays(lastStart, 6) }).total;
  const lastWeekToDate = minutesByCategory(sessions, { start: lastStart, end: addDays(t, -7) }).total;
  return { thisWeek, lastWeek, diff: thisWeek - lastWeek, lastWeekToDate };
}

// ── computeStreak ──
/**
 * 连续学习天数。规则：
 *  - 有记录的日子计 1 天；
 *  - 每个周一至周日的自然周内，最多 2 天无记录的「休息日」不会断开连续，也不计入天数；
 *  - 今天还没有记录不算断，也不消耗休息日（今天结束前还可以补记）；
 *  - 连续段之前（最早记录之前）的空白、以及连续段末端被断开处之前的休息日都不计。
 * 返回 { current, restDaysUsedThisWeek, restDaysLeftThisWeek, restDates, todayDone, atRisk }：
 *  restDates 是被用掉的休息日（升序）；todayDone 今天是否已有记录；
 *  atRisk = 今天还没记录、有连续在身，且本周休息日已用完（今天再空过就会断）。
 */
export function computeStreak(allSessions, today = new Date(), { restDaysPerWeek = 2 } = {}) {
  const t = toDateStr(today);
  const days = new Set();
  for (const s of live(allSessions)) {
    const d = rowDate(s);
    if (d <= t) days.add(d);
  }
  const todayDone = days.has(t);
  const empty = {
    current: 0, restDaysUsedThisWeek: 0, restDaysLeftThisWeek: restDaysPerWeek,
    restDates: [], todayDone, atRisk: false,
  };
  if (days.size === 0) return empty;

  const earliest = [...days].sort()[0];
  let current = 0;
  const restDates = [];
  let pending = [];            // 尚未被更早的记录「接住」的休息日
  const usedByWeek = {};       // 周一日期 → 已占用的休息日数（含 pending）

  for (let d = t; d >= earliest; d = addDays(d, -1)) {
    if (days.has(d)) {
      current += 1;
      restDates.push(...pending);
      pending = [];
    } else if (d === t) {
      continue;                // 今天空着：不断也不耗休息日
    } else {
      const wk = weekRange(d).start;
      if ((usedByWeek[wk] || 0) >= restDaysPerWeek) break;
      usedByWeek[wk] = (usedByWeek[wk] || 0) + 1;
      pending.push(d);
    }
  }

  restDates.sort();
  const thisWeekStart = weekRange(t).start;
  const used = restDates.filter((d) => d >= thisWeekStart).length;
  const left = current > 0 ? Math.max(0, restDaysPerWeek - used) : restDaysPerWeek;
  return {
    current,
    restDaysUsedThisWeek: used,
    restDaysLeftThisWeek: left,
    restDates,
    todayDone,
    atRisk: !todayDone && current > 0 && left === 0,
  };
}

// ── pendingObjective ──
/** 待补填：category = 3、grade_label 为空、score 为空、未删除（与 Learning 页查询一致；N/A 不算待补填）。 */
export function pendingObjective(sessions) {
  return (sessions || []).filter((s) =>
    s && Number(s.category) === 3
    && (s.grade_label === null || s.grade_label === undefined)
    && (s.score === null || s.score === undefined)
    && !s.deleted_at);
}

// ── subjectBreakdown ──
/** 区间内每门课的分钟数（按类别拆分）：[{ course, study, review, practice, total }]，按 total 降序。 */
export function subjectBreakdown(sessions, range) {
  const by = new Map();
  for (const s of inRange(sessions, range)) {
    const name = rowCourse(s);
    if (!by.has(name)) by.set(name, { course: name, study: 0, review: 0, practice: 0, total: 0 });
    const row = by.get(name);
    const m = rowMinutes(s);
    const cat = Number(s.category);
    if (cat === 1) row.study += m;
    else if (cat === 2) row.review += m;
    else if (cat === 3) row.practice += m;
    row.total += m;
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.course.localeCompare(b.course));
}

// ── calibration ──
// 数据来源：src/pages/Learning.jsx 的 OBJECTIVE_STEPS / GRADE_RANGES（此处复制，勿改 Learning.jsx）。
export const OBJECTIVE_STEPS = [
  { value: 0, label: 'F' }, { value: 1, label: 'D-' }, { value: 2, label: 'D' },
  { value: 3, label: 'D+' }, { value: 4, label: 'C-' }, { value: 5, label: 'C' },
  { value: 6, label: 'C+' }, { value: 7, label: 'B-' }, { value: 8, label: 'B' },
  { value: 9, label: 'B+' }, { value: 10, label: 'A-' }, { value: 11, label: 'A' },
  { value: 12, label: 'A+' },
];
export const GRADE_RANGES = {
  'A+': '97–100', 'A': '93–96', 'A-': '90–92', 'B+': '87–89', 'B': '83–86', 'B-': '80–82',
  'C+': '77–79', 'C': '73–76', 'C-': '70–72', 'D+': '67–69', 'D': '63–66', 'D-': '60–62',
  'F': '0–59',
};

// 映射：把主观评价和客观评价放到同一条 0–1 的刻度上比较。
//   self_rating 20/40/60/80/100 → 0 / .25 / .5 / .75 / 1  ( (rating-20)/80 )
//   字母等第 F…A+ → OBJECTIVE_STEPS.value / 12            ( F=0, B+=.75, A+=1 )
// 该刻度与录入页默认值吻合：默认主观「基本掌握」80 ↔ 默认客观 B+，同为 .75。
// 差值 gap = 平均自评 − 平均等第：
//   gap >  CALIBRATION_TOLERANCE → 偏乐观（自评高于成绩）
//   gap < −CALIBRATION_TOLERANCE → 偏保守（自评低于成绩）
//   否则 一致。容差 0.15 ≈ 约两个等第档位（0.083 × 2）。
export const CALIBRATION_TOLERANCE = 0.15;
const GRADE_VALUE = Object.fromEntries(OBJECTIVE_STEPS.map((s) => [s.label, s.value]));

function selfToUnit(rating) {
  return Math.min(1, Math.max(0, (Number(rating) - 20) / 80));
}
function gradeToUnit(label) {
  return GRADE_VALUE[label] / 12;
}

/**
 * 每门课近 N 周（默认 4 周，含今天）的自评 vs 客观等第：
 * 只取练习（category 3）里同时有 self_rating 和字母等第的记录（N/A、空等第不算）。
 * 返回 [{ course, n, avgSelf, avgGrade, gap, verdict }]（avgSelf/avgGrade/gap 为 0–1 刻度），按 n 降序。
 */
export function calibration(sessions, { weeks = 4, today = new Date() } = {}) {
  const end = toDateStr(today);
  const start = addDays(end, -(weeks * 7 - 1));
  const by = new Map();
  for (const s of inRange(sessions, { start, end })) {
    if (Number(s.category) !== 3) continue;
    if (s.self_rating === null || s.self_rating === undefined || Number.isNaN(Number(s.self_rating))) continue;
    if (!(s.grade_label in GRADE_VALUE)) continue; // 排除 null / 'N/A' / 未知
    const name = rowCourse(s);
    if (!by.has(name)) by.set(name, { self: 0, grade: 0, n: 0 });
    const a = by.get(name);
    a.self += selfToUnit(s.self_rating);
    a.grade += gradeToUnit(s.grade_label);
    a.n += 1;
  }
  return [...by.entries()]
    .map(([course, a]) => {
      const avgSelf = a.self / a.n;
      const avgGrade = a.grade / a.n;
      const gap = avgSelf - avgGrade;
      const verdict = gap > CALIBRATION_TOLERANCE ? '偏乐观' : gap < -CALIBRATION_TOLERANCE ? '偏保守' : '一致';
      return { course, n: a.n, avgSelf, avgGrade, gap, verdict };
    })
    .sort((x, y) => y.n - x.n || x.course.localeCompare(y.course));
}

// ── headlineInsight ──
function fmtMins(m) {
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小时 ${r} 分钟` : `${h} 小时`;
}

/**
 * 首页一句话洞察 { title, detail, action }，按优先级取第一条命中的简单规则（无任何目标类规则）：
 *  1. 连续记录有断档风险（连续 ≥ 3 天、今天还没记、本周休息日已用完）
 *  2. 本周复习占比远低于前 4 周平均（低于一半且差 ≥ 10 个百分点）
 *  3. 前 4 周学过、本周（周三起）一条记录都没有的课程
 *  4. 兜底：本周时长与上周同期对比 / 还没有记录
 * action 为 { label, log } 或 null；log 与 `yb:open-log` 事件的 detail 同形（courseId?、category?）。
 */
export function headlineInsight(sessions, today = new Date()) {
  const t = toDateStr(today);
  const rows = live(sessions);
  if (rows.length === 0) {
    return { title: '还没有学习记录', detail: '记下第一次学习，这里就会出现你的节奏。', action: { label: '记一次', log: {} } };
  }

  const streak = computeStreak(rows, t);
  if (streak.current >= 3 && streak.atRisk) {
    return {
      title: `连续 ${streak.current} 天，今天还没有记录`,
      detail: '本周的休息日已经用完，今天记一条就能接上。',
      action: { label: '记一次', log: {} },
    };
  }

  const cur = weekRange(t);
  const prevStart = addDays(cur.start, -28);
  const prevEnd = addDays(cur.start, -1);
  const week = minutesByCategory(rows, { start: cur.start, end: t });
  const prev = minutesByCategory(rows, { start: prevStart, end: prevEnd });

  if (prev.total >= 120 && week.total >= 60) {
    const prevShare = prev.review / prev.total;
    const weekShare = week.review / week.total;
    if (weekShare < prevShare * 0.5 && prevShare - weekShare >= 0.1) {
      return {
        title: '本周复习偏少',
        detail: `复习占 ${Math.round(weekShare * 100)}%，前 4 周平均是 ${Math.round(prevShare * 100)}%。`,
        action: { label: '记一次复习', log: { category: 2 } },
      };
    }
  }

  if (mondayIndex(t) >= 2) {
    const thisCourses = new Set(inRange(rows, { start: cur.start, end: t }).map(rowCourse));
    const prevByCourse = new Map();
    for (const s of inRange(rows, { start: prevStart, end: prevEnd })) {
      const name = rowCourse(s);
      const cur2 = prevByCourse.get(name) || { minutes: 0, courseId: s.course_id };
      cur2.minutes += rowMinutes(s);
      prevByCourse.set(name, cur2);
    }
    const missing = [...prevByCourse.entries()]
      .filter(([name, v]) => !thisCourses.has(name) && v.minutes > 0)
      .sort((a, b) => b[1].minutes - a[1].minutes || a[0].localeCompare(b[0]))[0];
    if (missing) {
      const [name, v] = missing;
      return {
        title: `${name} 本周还没有记录`,
        detail: `前 4 周你在这门课上学了 ${fmtMins(v.minutes)}。`,
        action: { label: `记一次${name}`, log: v.courseId ? { courseId: v.courseId } : {} },
      };
    }
  }

  const wow = weekOverWeek(rows, t);
  const sameDay = wow.thisWeek - wow.lastWeekToDate;
  let detail;
  if (wow.lastWeek === 0) detail = '上周没有记录，从这周开始积累。';
  else if (sameDay === 0) detail = '和上周同期持平。';
  else detail = `比上周同期${sameDay > 0 ? '多' : '少'} ${fmtMins(Math.abs(sameDay))}。`;
  return {
    title: wow.thisWeek > 0 ? `本周已记录 ${fmtMins(wow.thisWeek)}` : '本周还没有记录',
    detail,
    action: { label: '记一次', log: {} },
  };
}
