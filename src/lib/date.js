export function todayISO(offsetDays = 0) {
  const d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function fmtMinutes(total) {
  if (!total || total < 60) return `${total || 0} 分钟`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function stripToDate(iso) {
  return iso && iso.length >= 10 ? iso.slice(0, 10) : iso;
}

// 最近 N 天（含今天）
export function lastNDays(n) {
  const arr = [];
  for (let i = n - 1; i >= 0; i--) arr.push(todayISO(-i));
  return arr;
}

// 按 ISO 日期字符串分桶，返回 { "YYYY-MM-DD": minutes }
export function bucketByDate(rows) {
  const by = {};
  for (const r of rows) {
    const d = stripToDate(typeof r.session_date === 'string' ? r.session_date : r.session_date);
    by[d] = (by[d] || 0) + (r.duration_minutes || 0);
  }
  return by;
}

// 判断 ISO 日期是工作日(周一到周五, true)还是周末(周六周日, false)
export function isWeekday(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

// 获取某个日期的周起始日(周一)
export function getWeekStart(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

// 获取某个日期的周结束日(周日)
export function getWeekEnd(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay();
  const offset = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// 获取最近 N 周的周起始日(从本周往前排)
export function lastNWeeks(n) {
  const weeks = [];
  const today = new Date();
  const day = today.getDay();
  const offset = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - offset);

  for (let i = n - 1; i >= 0; i--) {
    const monday = new Date(thisMonday);
    monday.setDate(thisMonday.getDate() - i * 7);
    weeks.push(monday.toISOString().slice(0, 10));
  }
  return weeks;
}

// 格式化为中文日期标签，如 "06/16" 或 "6月16日"
export function shortDate(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length < 3) return iso;
  return parts[1] + '/' + parts[2];
}

// 格式化为 "6月第2周" 这样的中文标签
export function weekLabel(weekStartIso) {
  if (!weekStartIso) return '';
  const parts = weekStartIso.split('-');
  if (parts.length < 3) return weekStartIso;
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  const weekOfMonth = Math.ceil(day / 7);
  return month + '月第' + weekOfMonth + '周';
}
