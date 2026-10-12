// 统计落在所选时段之外的学习记录。
// sessions 元素的日期字段为已映射的 s.date（"YYYY-MM-DD"，可能带时间后缀）。
// 返回 { total, earliest }：时段外记录总数与其中最早的日期；无时段外记录时 earliest 为 null。
export function outsideRangeStats(sessions, startStr, endStr) {
  let total = 0;
  let earliest = null;
  for (const s of sessions || []) {
    const d = s?.date?.split('T')[0];
    if (!d) continue;
    if (d < startStr || d > endStr) {
      total += 1;
      if (!earliest || d < earliest) earliest = d;
    }
  }
  return { total, earliest };
}
