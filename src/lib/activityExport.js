const PAGE_SIZE = 500;
const CATEGORY_NAMES = { 1: '学习', 2: '复习', 3: '练习' };

export async function fetchActivityRecords(client, studentId, start, end) {
  const records = [];
  for (;;) {
    const offset = records.length;
    const { data, error } = await client
      .from('learning_sessions')
      .select(`
        session_date, duration_minutes, category, form, notes,
        course:course_id(name, subject),
        chapter:chapter_id(name, deleted_at), unit:unit_id(name, deleted_at)
      `)
      .eq('student_id', studentId)
      .is('deleted_at', null)
      .gte('session_date', start)
      .lte('session_date', end)
      .order('session_date')
      .order('start_time')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) return records;
    records.push(...data);
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  // Keep spreadsheet apps from interpreting student-entered text as a formula.
  const literal = /^(?:\s*[=+\-@＝＋－＠]|[\t\r\n])/.test(text) ? "'" + text : text;
  return '"' + literal.replace(/"/g, '""') + '"';
}

export function activityRecordsCsv(records) {
  const rows = records.map(record => {
    const project = record.course?.name || record.course?.subject || '未分类';
    const chapter = record.chapter?.deleted_at ? null : record.chapter?.name;
    const unit = record.unit?.deleted_at ? null : record.unit?.name;
    const description = [record.form, chapter, unit, record.notes].filter(Boolean).join(' · ');
    return [
      record.session_date,
      project,
      description || CATEGORY_NAMES[record.category] || '',
      record.duration_minutes,
    ];
  });
  return '\uFEFF' + [['日期', '项目', '具体事项', '时长（分钟）'], ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');
}

export function downloadActivityRecords(records, studentName, start, end) {
  const csv = new Blob([activityRecordsCsv(records)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(csv);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${studentName}_学习记录_${start}_${end}.csv`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
