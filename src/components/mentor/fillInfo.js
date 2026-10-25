// 学生管理页的「填写情况」纯函数：阶段 / 需关注 / 最后记录 / 组内排序 / 组头统计 / 今日反馈文案。
// 规则本身来自 src/lib/supervision.js（新生 = 注册第 1–30 天；3 天以上没填），这里只做展示层组装。

import {
  fillSummary,
  dayNumber,
  attentionOf,
  addDays,
  lastWeekRange,
  GAP_ALERT_DAYS,
  NEW_STUDENT_DAYS,
} from '../../lib/supervision.js';
import { objectiveOf } from '../../lib/objective.js';
import { toLocalDateStr } from '../../lib/date.js';

export { GAP_ALERT_DAYS, NEW_STUDENT_DAYS };

const CATEGORY_LABEL = { 1: '学习', 2: '复习', 3: '练习' };

/** profiles.created_at → 本地日期 YYYY-MM-DD（注册当天 = 第 1 天） */
export function signupDay(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return String(createdAt).slice(0, 10) || null;
  return toLocalDateStr(d);
}

/** 'YYYY-MM-DD' → 'M/D' */
export function formatMD(iso) {
  if (!iso) return '';
  const [, m, d] = String(iso).slice(0, 10).split('-');
  if (!m || !d) return '';
  return `${Number(m)}/${Number(d)}`;
}

/** 距今天数文案：0 今天 / 1 昨天 / N 天前 */
export function gapLabel(gap) {
  if (gap == null) return '';
  if (gap <= 0) return '今天';
  if (gap === 1) return '昨天';
  return `${gap} 天前`;
}

/**
 * 一位学生的填写信息。
 * @param {{ student: object, connected: boolean, dates: string[]|undefined, todayIso: string|null, pending?: number|null }} p
 * connected=false 或还没算出今天 → 只返回 { connected: false }（界面画 —）
 */
export function buildFillInfo({ student, connected, dates, todayIso, pending = null }) {
  if (!connected || !todayIso) return { connected: false, pending };
  const signup = signupDay(student?.created_at);
  const summary = fillSummary(dates || [], todayIso);
  const day = signup ? dayNumber(signup, todayIso) : null;
  const isNew = day != null && day >= 1 && day <= NEW_STUDENT_DAYS;
  const attention = attentionOf({ signupIso: signup, summary, todayIso });

  let cell = null;
  if (isNew) {
    if (day >= 2) {
      cell = summary.yesterdayFilled
        ? { text: '昨天填了', tone: 'ok' }
        : { text: '昨天没填', tone: 'bad' };
    }
  } else if (summary.gap == null) {
    cell = { text: '还没有记录', tone: 'warn' };
  } else if (summary.gap >= GAP_ALERT_DAYS) {
    cell = { text: `${summary.gap} 天没填`, tone: 'warn' };
  }

  let lastText;
  if (summary.lastDate) lastText = `${formatMD(summary.lastDate)} · ${gapLabel(summary.gap)}`;
  else lastText = isNew ? '还没有记录' : '—';

  return {
    connected: true,
    todayIso,
    signup,
    day,
    isNew,
    summary,
    attention, // 'new-missed-yesterday' | 'gap' | null
    cell,      // 需关注列 { text, tone } | null
    stage: isNew ? `新生 · 第 ${day} 天` : '每周',
    lastText,
    pending,
  };
}

/** 卡片里新生的「昨天 / 今天」两段状态 */
export function newbieDayStatus(info) {
  if (!info?.connected || !info.isNew) return null;
  return {
    yesterday: info.day >= 2
      ? (info.summary.yesterdayFilled ? { text: '昨天已填', tone: 'ok' } : { text: '昨天未填', tone: 'bad' })
      : null,
    today: info.summary.todayFilled ? { text: '今天已填', tone: 'ok' } : { text: '今天还没填', tone: 'muted' },
  };
}

/**
 * 组内排序：已连接在前 → 新生在前 → 没填天数多的在前（从没记录 = 最多）→ 保持原顺序。
 * @param {Array} students 组内学生（已是当前顺序）
 * @param {(id: string) => object} infoOf
 */
export function sortGroupStudents(students, infoOf) {
  const key = (s) => {
    const info = infoOf(s.id) || {};
    return [
      info.connected ? 0 : 1,
      info.connected && info.isNew ? 0 : 1,
      info.connected ? (info.summary.gap == null ? -Infinity : -info.summary.gap) : 0,
    ];
  };
  return students
    .map((s, i) => ({ s, i, k: key(s) }))
    .sort((a, b) => {
      for (let n = 0; n < a.k.length; n++) {
        if (a.k[n] !== b.k[n]) return a.k[n] < b.k[n] ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map((x) => x.s);
}

/** 组头统计：{ total, newCount, newMissed, gapCount } */
export function groupCounts(students, infoOf) {
  const out = { total: students.length, newCount: 0, newMissed: 0, gapCount: 0 };
  for (const s of students) {
    const info = infoOf(s.id);
    if (!info?.connected) continue;
    if (info.isNew) out.newCount += 1;
    if (info.attention === 'new-missed-yesterday') out.newMissed += 1;
    if (info.attention === 'gap') out.gapCount += 1;
  }
  return out;
}

/** 草稿类型文案：每日 · 新生第 N 天 / 周报 · 上周 */
export function draftKindLabel(draft, info, todayIso) {
  if (draft.kind === 'weekly') {
    const last = todayIso ? lastWeekRange(todayIso) : null;
    if (last && draft.period_start === last.start && draft.period_end === last.end) return '周报 · 上周';
    return `周报 · ${formatMD(draft.period_start)}–${formatMD(draft.period_end)}`;
  }
  return info?.isNew ? `每日 · 新生第 ${info.day} 天` : '每日';
}

function dateWord(iso, todayIso) {
  if (!iso) return '';
  if (iso === todayIso) return '今天';
  if (todayIso && iso === addDays(todayIso, -1)) return '昨天';
  return formatMD(iso);
}

/** 「依据」一行：日期 + 课程 + 类别 + 客观等第，多条用 · 隔开 */
export function evidenceLine(evidence, sessionById, todayIso) {
  const ids = (Array.isArray(evidence) ? evidence : [])
    .map((e) => (e && typeof e === 'object' ? e.id : e))
    .filter(Boolean);
  const parts = [];
  for (const id of ids) {
    const s = sessionById?.[id];
    if (!s) continue;
    const obj = objectiveOf(s);
    const grade = obj && obj.kind !== 'na' ? obj.label : null;
    parts.push([
      dateWord(String(s.session_date || '').slice(0, 10), todayIso),
      s.course?.name || s.course?.subject || '',
      CATEGORY_LABEL[s.category] || '',
      grade,
    ].filter(Boolean).join(' '));
  }
  return parts.join(' · ');
}

/** 「复制名单」的纯文本 */
export function namesListText(title, items) {
  const lines = items.map((it) => [
    it.advisor ? `${it.name}（${it.advisor}）` : it.name,
    it.detail,
    it.lastText ? `最后记录 ${it.lastText}` : null,
  ].filter(Boolean).join(' · '));
  return `${title}（${items.length} 人）\n${lines.join('\n')}`;
}
