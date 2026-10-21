// E4 待办事项的分组规则（纯函数，便于测试）。
// d = daysUntil(next_meeting_date)：null 表示未排期，负数表示日期已过。
// 产品语义：日期已过 ≈ 会议没开成、需要重新安排，与未排期同等对待，都归「待安排」。
export function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  return Math.round((d - today) / 86400000);
}

export const GROUPS = [
  { key: 'today', title: '今天', match: (d) => d === 0 },
  { key: 'week', title: '未来 7 天', match: (d) => d > 0 && d <= 7 },
  { key: 'later', title: '之后', match: (d) => d > 7 },
  { key: 'unscheduled', title: '待安排', match: (d) => d === null || d < 0 },
];

export function groupKeyFor(d) {
  return GROUPS.find((g) => g.match(d))?.key;
}
