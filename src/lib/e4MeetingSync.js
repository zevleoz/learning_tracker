// 会前准备（prep）的会议日期 → 学生档案 next_meeting_* 的同步规则（纯函数，便于测试）。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 从报告表单中取「下次复盘日期」，按报告类型分派字段：
 *   first    报告 → form_data.section07.nextReviewDate（可为 'yyyy-MM-dd' 或 'yyyy-MM-dd~yyyy-MM-dd' 区间，取起始日）
 *   progress 报告 → form_data.p8.reviewDate（'yyyy-MM-dd'）
 * @returns {string|null} 'yyyy-MM-dd' 或 null
 */
export function extractNextReviewDate(reportType, formData) {
  const raw = reportType === 'progress'
    ? formData?.p8?.reviewDate
    : formData?.section07?.nextReviewDate;
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

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
