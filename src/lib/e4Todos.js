// E4 待办事项的分组规则（纯函数，便于测试）。
// d = daysUntil(next_meeting_date)：null 表示未排期，负数表示日期已过。
export function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  return Math.round((d - today) / 86400000);
}

// 按日期天数的基础分组。日期已过但「之后已出过报告」的学生没有下一场会议，仍归「待安排」；
// 日期已过且还没出报告的学生由 groupKeyForStudent 提前归入「待写报告」。
export const GROUPS = [
  { key: 'today', title: '今天', match: (d) => d === 0 },
  { key: 'week', title: '未来 7 天', match: (d) => d > 0 && d <= 7 },
  { key: 'later', title: '之后', match: (d) => d > 7 },
  { key: 'unscheduled', title: '待安排', match: (d) => d === null || d < 0 },
];

export function groupKeyFor(d) {
  return GROUPS.find((g) => g.match(d))?.key;
}

// ---------------------------------------------------------------------------
// 待写报告：会议日期 ≤ 今天，且之后没有出过 first / progress 报告（两种会议类型同样适用）
// ---------------------------------------------------------------------------

// 把 created_at（ISO 时间戳或纯日期串）换算成本地 YYYY-MM-DD，便于和 next_meeting_date 比较
export function localIsoDate(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// student.latest_report_at：最新一份 first/progress 报告的 created_at（没有则为空）。
// 日期范围以起始日为准（next_meeting_date）；报告 created_at 落在起始日当天或之后即视为已写。
export function isReportDue(student) {
  const date = student?.next_meeting_date;
  if (!date) return false;
  const d = daysUntil(date);
  // 当天的会议可能还没开：从第二天起才提醒写报告，当天留在「今天」
  if (d === null || d >= 0) return false;
  const reportDay = localIsoDate(student.latest_report_at);
  return !(reportDay && reportDay >= date);
}

export const REPORT_GROUP = { key: 'report', title: '待写报告' };
// 展示顺序：待写报告 → 今天 → 未来 7 天 → 之后 → 待安排
export const GROUP_ORDER = [REPORT_GROUP, ...GROUPS];

export function groupKeyForStudent(student) {
  if (isReportDue(student)) return REPORT_GROUP.key;
  return groupKeyFor(daysUntil(student?.next_meeting_date));
}

export function groupStudents(items) {
  const rows = items || [];
  return GROUP_ORDER
    .map((g) => ({ key: g.key, title: g.title, rows: rows.filter((s) => groupKeyForStudent(s) === g.key) }))
    .filter((g) => g.rows.length > 0);
}

// 待写报告卡片的主操作：按会议类型给出按钮文案与跳转（已有同类草稿则回到草稿）
export function reportActionFor(student) {
  if (student?.next_meeting_type === 'progress') {
    return {
      label: '填写过程中报告',
      path: student.draft_progress_id
        ? `/e4/progress/${student.draft_progress_id}`
        : `/e4/students/${student.id}/new-progress`,
    };
  }
  return {
    label: '填写首次会议记录报告',
    path: student?.draft_first_id
      ? `/e4/reports/${student.draft_first_id}/build`
      : `/e4/students/${student?.id}/new-first`,
  };
}

// ---------------------------------------------------------------------------
// 我的 / 全部
// ---------------------------------------------------------------------------

export const SCOPE_KEY = 'e4.listScope';

export function filterByScope(rows, scope, userId) {
  const list = rows || [];
  if (scope === 'all') return list;
  if (!userId) return [];
  return list.filter((r) => r.advisor_id === userId);
}

// 默认「我的」；localStorage 在隐私模式 / 被禁用时可能抛错，一律降级为默认值
export function loadScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'mine';
  } catch {
    return 'mine';
  }
}

export function saveScope(scope) {
  try {
    localStorage.setItem(SCOPE_KEY, scope === 'all' ? 'all' : 'mine');
  } catch {}
}

// ---------------------------------------------------------------------------
// 日期展示
// ---------------------------------------------------------------------------

export function formatMeetingDate(iso) {
  if (!iso) return '待安排';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

// 范围结束日省略 weekday，控制宽度
function formatEnd(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

// 有结束日时显示「起始日 ~ 结束日」，否则仅起始日
export function formatMeetingRange(start, end) {
  if (!start) return '待安排';
  return end ? `${formatMeetingDate(start)} ~ ${formatEnd(end)}` : formatMeetingDate(start);
}

export function meetingTypeLabel(type) {
  return type === 'progress' ? '进程中' : '首次';
}

// 「今天」/「N 天后」/「N 天前」；无日期返回 null
export function relativeDayText(iso) {
  const d = daysUntil(iso);
  if (d === null) return null;
  if (d === 0) return '今天';
  return d > 0 ? `${d} 天后` : `${-d} 天前`;
}

// M/D（如 10/28）
function shortMD(value) {
  const s = localIsoDate(value);
  return s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '';
}

// 学生中心「下次会议」列。reportsKnown=false 表示报告信息没取到：不做「待写报告」判断。
export function meetingCell(student, reportsKnown = true) {
  const date = student?.next_meeting_date;
  if (!date) return { kind: 'none', text: '待安排', type: '' };
  const type = meetingTypeLabel(student.next_meeting_type);
  if (reportsKnown && isReportDue(student)) return { kind: 'due', text: '待写报告', type };
  if (daysUntil(date) === 0) return { kind: 'today', text: '今天', type };
  return { kind: 'date', text: shortMD(date), type };
}

// ---------------------------------------------------------------------------
// 学生详情「下一步」：由已有的会前准备 / 首次报告决定
// 无任何首次报告：有会前准备 → 首次报告，没有 → 会前准备；已有首次报告 → 过程报告
// ---------------------------------------------------------------------------

export function nextStepFor(student, reports) {
  const list = reports || [];
  const first = list.find((r) => r.report_type === 'first');
  if (first) {
    const since = shortMD(first.meeting_date || first.report_date || first.created_at);
    return {
      key: 'progress',
      label: '生成过程报告',
      reason: student?.tracker_profile_id
        ? `会后写过程中报告（基于一表人才${since ? ` ${since} 起` : ''}的记录）`
        : '过程中报告需要先关联一表人才学生',
    };
  }
  if (list.some((r) => r.report_type === 'prep')) {
    return { key: 'first', label: '生成首次报告', reason: '会前准备已有，会议后生成首次学习力分析报告' };
  }
  return { key: 'prep', label: '生成会前准备', reason: '会议前先结合 Y4 协议生成会前准备' };
}
