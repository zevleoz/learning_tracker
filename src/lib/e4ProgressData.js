// E4《阶段学习力复盘报告》一表人才数据聚合。
// 从 learning_sessions（联表 courses 取学科）计算 8 页中需要的量化指标。
// 量化字段可自动预填；定性字段（观察/判断/情绪/方案）留给导师填写。
import { supabase } from './supabase.js';
import { stripToDate, isWeekday } from './date.js';

export class ProgressDataError extends Error {}

const AUTONOMOUS_RE = /^自主/;

function daysBetween(startISO, endISO) {
  const s = new Date(`${startISO}T00:00:00`);
  const e = new Date(`${endISO}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

// 从 PostgREST 嵌入结果里兜底读取 course（可能是对象或数组）
function pickCourse(row) {
  return Array.isArray(row.course) ? row.course[0] : row.course;
}

// 拉取学生的 syllabus 课程名（course.name，去重，按最近出现排序）。
// 课程来自该学生全部学习记录（不限于复盘周期），保证分学科各表完整覆盖。
export async function fetchProgressSyllabus(trackerProfileId) {
  if (!trackerProfileId) return [];
  const { data, error } = await supabase
    .from('learning_sessions')
    .select('session_date, course:course_id(name)')
    .eq('student_id', trackerProfileId)
    .is('deleted_at', null)
    .order('session_date', { ascending: false })
    .limit(1000);
  if (error) throw new ProgressDataError(`读取课程（syllabus）失败：${error.message}`);
  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    const s = String(pickCourse(row)?.name || '').trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

// 拉取 [start, end] 内学生（tracker_profile_id）的全部学习记录，联表课程拿学科名
export async function fetchProgressSessions(trackerProfileId, startDate, endDate) {
  if (!trackerProfileId) throw new ProgressDataError('尚未关联一表人才学生');
  const { data, error } = await supabase
    .from('learning_sessions')
    .select(
      'session_date, duration_minutes, category, form, eval_type, self_rating, grade_label, score, course:course_id(name)'
    )
    .eq('student_id', trackerProfileId)
    .gte('session_date', startDate)
    .lte('session_date', endDate)
    .is('deleted_at', null)
    .order('session_date', { ascending: true });
  if (error) throw new ProgressDataError(`读取学习记录失败：${error.message}`);
  return data || [];
}

// 时长 → "X 小时 Y 分钟"（对齐模板「X 小时 X 分钟」占位）
export function hoursMinutes(mins) {
  const m = Math.round(mins || 0);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} 分钟`;
  if (!r) return `${h} 小时`;
  return `${h} 小时 ${r} 分钟`;
}

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// 主观自评 20/40/60/80/100 → 标签
const RATING_LABEL = { 100: '完全掌握', 80: '基本掌握', 60: '大致掌握', 40: '掌握不足', 20: '几乎未掌握' };

// 组装「练习质量」的客观/主观评价一句（仅由已记录数据生成，供导师改写）
function evalText(stats) {
  const parts = [];
  if (stats.objectiveCount > 0) {
    const mean = Math.round(stats.objectiveSum / stats.objectiveCount);
    parts.push(`客观 ${stats.objectiveCount} 次（均分 ${mean}）`);
  }
  if (stats.subjectiveCount > 0) {
    const mean = Math.round(stats.subjectiveSum / stats.subjectiveCount);
    parts.push(`主观 ${stats.subjectiveCount} 次（均 ${RATING_LABEL[mean] || mean}）`);
  }
  return parts.join('；');
}

/**
 * 聚合学习记录为报告各页所需的结构化数据。
 * @param {Array} rows   fetchProgressSessions 返回
 * @param {String} startDate
 * @param {String} endDate
 * @param {Array} syllabus 学生 syllabus 学科名列表（无会话记录的学科也会补成一行）
 */
export function aggregateProgress(rows, startDate, endDate, syllabus = []) {
  const totalDays = daysBetween(startDate, endDate);
  const calendar = {}; // "YYYY-MM-DD" -> 分钟
  const recordedDays = new Set();
  const weekdayMins = [];
  const weekendMins = [];
  let totalMinutes = 0;
  const bySubject = new Map();

  for (const r of rows) {
    const d = stripToDate(r.session_date);
    const mins = r.duration_minutes || 0;
    recordedDays.add(d);
    totalMinutes += mins;
    calendar[d] = (calendar[d] || 0) + mins;
    (isWeekday(d) ? weekdayMins : weekendMins).push(mins);

    const subject = String(pickCourse(r)?.name || '').trim() || '未分类';
    let s = bySubject.get(subject);
    if (!s) {
      s = {
        subject,
        minutes: 0,
        learn: 0,
        review: 0,
        practice: 0,
        reviewMins: 0,
        practiceCount: 0,
        autonomousMins: 0,
        objectiveCount: 0,
        objectiveSum: 0,
        subjectiveCount: 0,
        subjectiveSum: 0,
      };
      bySubject.set(subject, s);
    }
    s.minutes += mins;
    if (r.category === 1) s.learn += mins;
    else if (r.category === 2) { s.review += mins; s.reviewMins += mins; }
    else if (r.category === 3) { s.practice += mins; s.practiceCount += 1; }

    if (AUTONOMOUS_RE.test(String(r.form || ''))) s.autonomousMins += mins;

    if (r.eval_type === 1) {
      if (r.self_rating != null) { s.subjectiveCount += 1; s.subjectiveSum += r.self_rating; }
    } else {
      if (r.score != null) { s.objectiveCount += 1; s.objectiveSum += r.score; }
    }
  }

  const toSubject = (s) => {
    const sharePct = totalMinutes ? Math.round((s.minutes / totalMinutes) * 100) : 0;
    const learnPct = s.minutes ? Math.round((s.learn / s.minutes) * 100) : 0;
    const reviewPct = s.minutes ? Math.round((s.review / s.minutes) * 100) : 0;
    const practicePct = s.minutes ? Math.round((s.practice / s.minutes) * 100) : 0;
    const autonomousPct = s.minutes ? Math.round((s.autonomousMins / s.minutes) * 100) : 0;
    return {
      subject: s.subject,
      minutes: s.minutes,
      sharePct,
      learnPct,
      reviewPct,
      practicePct,
      reviewMins: s.reviewMins,
      practiceCount: s.practiceCount,
      evalText: evalText(s),
      autonomousPct,
      // 定性字段留空，供导师填写
      experience: '',
      emotion: '',
      finding: '',
    };
  };

  // 有会话记录的学科，按时长降序（最多 8 个）
  const subjects = [...bySubject.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 8).map(toSubject);

  // 补入 syllabus 中存在、但本期没有会话记录的学科，保证分学科各表完整覆盖
  const subjectSet = new Set(subjects.map((x) => x.subject));
  for (const name of syllabus) {
    if (subjectSet.has(name) || subjects.length >= 8) continue;
    subjects.push(toSubject({
      subject: name, minutes: 0, learn: 0, review: 0, practice: 0, reviewMins: 0, practiceCount: 0,
      autonomousMins: 0, objectiveCount: 0, objectiveSum: 0, subjectiveCount: 0, subjectiveSum: 0,
    }));
    subjectSet.add(name);
  }

  return {
    period: { start: startDate, end: endDate, totalDays },
    summary: {
      recordDays: recordedDays.size,
      totalMinutes,
      weekdayAvgMins: avg(weekdayMins),
      weekendAvgMins: avg(weekendMins),
    },
    calendar,
    subjects,
  };
}