// 学生管理页的「填写情况」纯函数：阶段 / 需关注 / 最后记录 / 组内排序 / 组头统计 / 消息类型 / 这周谁记了。
// 规则本身来自 src/lib/supervision.js（首月 = 注册第 1–30 天；3 天以上没记录），这里只做展示层组装。

import {
  fillSummary,
  dayNumber,
  attentionOf,
  addDays,
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
    stage: isNew ? `首月 · 第 ${day} 天` : '每周看',
    lastText,
    pending,
  };
}

/** 卡片里首月学生的「昨天 / 今天」两段状态 */
export function firstMonthDayStatus(info) {
  if (!info?.connected || !info.isNew) return null;
  return {
    yesterday: info.day >= 2
      ? (info.summary.yesterdayFilled ? { text: '昨天已填', tone: 'ok' } : { text: '昨天未填', tone: 'bad' })
      : null,
    today: info.summary.todayFilled ? { text: '今天已填', tone: 'ok' } : { text: '今天还没填', tone: 'muted' },
  };
}

/**
 * 组内排序：已连接在前 → 首月在前 → 没填天数多的在前（从没记录 = 最多）→ 保持原顺序。
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

/** 消息类型：每日表扬 / 周小结 / 周小结 + 提醒 / 提醒 */
export function draftKindLabel(draft) {
  if (!draft || draft.kind === 'daily') return '每日表扬';
  if (draft.kind === 'weekly') return draft.meta?.nudge ? '周小结 + 提醒' : '周小结';
  if (draft.kind === 'nudge') return '提醒';
  return '每日表扬';
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

/**
 * 「这周谁记了」的一行（C4）。
 * @param {object} student 学生（name / full_name / school_name / created_at / mentorName 可选）
 * @param {object} info buildFillInfo 的结果
 * @param {object|null} draft 这位学生今天待发 / 已处理的消息
 * @param {string} todayIso
 * @returns {{ id, name, stageText, firstMonthDay, yesterday, school, mentorName, days, stateText, warn, subText, lastText, draft }}
 */
export function weekBoardRow(student, info, draft, todayIso) {
  const signup = signupDay(student?.created_at);
  const day = signup && todayIso ? dayNumber(signup, todayIso) : null;
  const isFirstMonth = day != null && day >= 1 && day <= NEW_STUDENT_DAYS;
  const summary = info?.connected ? info.summary : fillSummary([], todayIso);

  const days = (summary.days || []).map((d) => {
    let state = 'e';
    if (signup && d.date < signup) state = 'n';
    else if (d.filled) state = 'f';
    else if (d.date === todayIso) state = 't';
    return { date: d.date, state };
  });

  let stateText = '正常';
  if (summary.gap == null) stateText = '还没开始记';
  else if (summary.count === 7) stateText = '每天都记';
  else if (summary.gap >= GAP_ALERT_DAYS) stateText = `${summary.gap} 天没记`;

  const pending = info?.pending || 0;
  let subText = '';
  if (!info?.connected) subText = '';
  else if (pending > 0) subText = `实测待补 ${pending} 条`;
  else if (summary.gap == null) subText = '注册后一条都没有';
  else if (summary.todayFilled) subText = '今天已经记了';
  else subText = '今天还没记';

  // 「今天」按昨天分组：f = 昨天记了，e = 昨天没记，n = 昨天还没注册
  const yesterdayIso = todayIso ? addDays(todayIso, -1) : null;
  const yesterday = days.find((d) => d.date === yesterdayIso)?.state || 'e';

  return {
    id: student?.id,
    name: student?.name || student?.full_name || '(未命名)',
    stageText: isFirstMonth ? `首月 · 第 ${day} 天` : '每周看',
    firstMonthDay: isFirstMonth ? day : null,
    yesterday,
    school: student?.school_name || student?.school || '',
    mentorName: student?.mentorName || '',
    days,
    stateText,
    warn: !!info?.attention,
    subText,
    lastText: info?.connected ? info.lastText : '—',
    draft: draft || null,
  };
}
