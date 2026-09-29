// 会前准备（prep）的会议日期 → 学生档案 next_meeting_* 的同步规则（纯函数，便于测试）。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function extractPrepMeetingDate(formData) {
  const raw = formData?.prepCover?.meetingDate;
  return raw && DATE_RE.test(raw) ? raw : null;
}

// 根据 prep 表单与学生当前阶段计算应写入 e4_students 的 patch。
// 返回 null 表示无需更新：
// - 学生已进入 progress 阶段（首次报告已推进），会前日期不得覆盖；
// - 会议日期与档案一致。
// 日期被清空时回归待安排（next_meeting_date = null）。
export function prepMeetingPatch(formData, student) {
  if (!student || student.next_meeting_type === 'progress') return null;
  const date = extractPrepMeetingDate(formData);
  const current = student.next_meeting_date || null;
  if (date === current) return null;
  return { next_meeting_date: date, next_meeting_type: 'first' };
}
