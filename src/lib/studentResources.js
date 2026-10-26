// 学生端各页共用的「资源」：缓存 key、取数函数、保存 / 删除 / 补填之后的缓存修补。
// 页面只管 useCached(userId, KEY, fetcher)；改动数据的地方调用这里的 afterXxx，
// 保证 今天 / 洞察 / 记录 / 我的 看到的永远是学生自己刚做完的结果。

import { supabase } from './supabase.js';
import { logger } from './logger.js';
import { toLocalDateStr } from './date.js';
import { pendingObjective } from './studentStats.js';
import { setAppBadge } from './push.js';
import { load, patch, invalidate, peek } from './studentCache.js';

export const KEYS = {
  student: 'student',         // 今天 / 洞察：近两年记录（分段）
  exams: 'exams',             // 考试成绩
  examCourses: 'examCourses', // 校内课程
  invites: 'inviteCount',     // 待处理导师邀请数
  recent: 'recent',           // 记录页：最近 30 条
  pending: 'pending',         // 记录页：待补填列表
  courseTree: 'courseTree',   // 记录页：课程 / 章节 / 单元
  forms: 'customForms',       // 自定义学习形式
  me: 'me',                   // 我的：资料 + 课程数
  prefs: 'prefs',             // 提醒偏好
  invitesList: 'invitesList', // 我的：导师邀请列表
  syllabus: 'syllabus',       // 我的课程：课程树 + 覆盖度
};

const HISTORY_DAYS = 730;     // 连续天数要看得足够远：至少 2 年
const RECENT_DAYS = 91;       // 先取最近一个季度（今天 / 本周 / 8 周热力图都在里面），其余历史后台补
const WINDOW_DAYS = 91;       // 历史分成一个季度一段并行取，避免撞到单次 1000 行上限
const WINDOW_LIMIT = 1000;

const SESSION_COLUMNS = 'id, session_date, start_time, duration_minutes, category, form, '
  + 'self_rating, grade_label, score, deleted_at, course_id, chapter_id, unit_id, '
  + 'course:courses(id, name, course_type)';

export function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toLocalDateStr(new Date(y, m - 1, d + n));
}

/** [from, to) 内未删除的记录，日期倒序。 */
async function fetchWindow(userId, from, to) {
  const { data, error } = await supabase
    .from('learning_sessions')
    .select(SESSION_COLUMNS)
    .eq('student_id', userId)
    .is('deleted_at', null)
    .gte('session_date', from)
    .lt('session_date', to)
    .order('session_date', { ascending: false })
    .limit(WINDOW_LIMIT);
  if (error) throw error;
  return data || [];
}

/** recentFrom 之前是否还有记录（决定要不要补历史）；查询失败当作有，宁可多补一次。 */
async function hasOlderRows(userId, recentFrom) {
  try {
    const { data, error } = await supabase
      .from('learning_sessions')
      .select('id')
      .eq('student_id', userId)
      .is('deleted_at', null)
      .lt('session_date', recentFrom)
      .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  } catch (e) {
    logger.warn('历史记录探测失败，按有历史处理', e);
    return true;
  }
}

function sortRows(rows) {
  return rows
    .filter((s) => s && !s.deleted_at)
    .sort((a, b) => {
      if (a.session_date !== b.session_date) return a.session_date < b.session_date ? 1 : -1;
      return String(b.start_time || '') < String(a.start_time || '') ? -1 : 1;
    });
}

/** 附加数据（考试、校内课程、邀请数）失败不影响主体：沿用缓存里的旧值或空值，并记录日志。 */
async function softLoad(userId, key, fetcher, fallback, label) {
  try {
    return await load(userId, key, fetcher);
  } catch (e) {
    logger.warn(`${label} 加载失败`, e);
    const kept = peek(userId, key);
    return kept === undefined ? fallback : kept;
  }
}

export async function fetchExams(userId) {
  const { data, error } = await supabase
    .from('exam_scores')
    .select('*')
    .eq('student_id', userId)
    .is('deleted_at', null)
    .order('exam_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchExamCourses(userId) {
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, subject, course_type')
    .eq('created_by', userId)
    .eq('course_type', 1)   // 仅校内课程
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchInviteCount(userId) {
  const { data, error } = await supabase
    .from('teacher_student_connections')
    .select('id')
    .eq('student_id', userId)
    .eq('status', 0);
  if (error) throw error;
  return (data || []).length;
}

/**
 * 今天 / 洞察用的主数据：先取最近 91 天（加上考试、课程、邀请数，一轮并行）就出结果，
 * 更早的历史（连续天数、学习日历要用）有的话再在后台并行补齐，不挡首屏。
 * 返回 { todayStr, sessions, historyReady, windowStart }。
 */
export async function fetchStudent(userId, todayStr, { publish }) {
  const end = addDaysStr(todayStr, 1);
  const recentFrom = addDaysStr(todayStr, -(RECENT_DAYS - 1));
  const first = addDaysStr(todayStr, -HISTORY_DAYS);

  const [recent, hasOlder] = await Promise.all([
    fetchWindow(userId, recentFrom, end),
    hasOlderRows(userId, recentFrom),
    softLoad(userId, KEYS.exams, () => fetchExams(userId), [], '考试成绩'),
    softLoad(userId, KEYS.examCourses, () => fetchExamCourses(userId), [], '校内课程'),
    softLoad(userId, KEYS.invites, () => fetchInviteCount(userId), 0, '导师邀请'),
  ]);

  const recentRows = sortRows(recent);
  if (!hasOlder) {
    setAppBadge(pendingObjective(recentRows).length); // 图标角标 = 待补填数量
    return { todayStr, sessions: recentRows, historyReady: true, windowStart: first };
  }
  publish({ todayStr, sessions: recentRows, historyReady: false, windowStart: recentFrom });

  const windows = [];
  for (let from = first; from < recentFrom; from = addDaysStr(from, WINDOW_DAYS)) {
    const to = addDaysStr(from, WINDOW_DAYS);
    windows.push([from, to < recentFrom ? to : recentFrom]);
  }
  const older = await Promise.all(windows.map(([from, to]) => fetchWindow(userId, from, to)));
  const all = sortRows([...recentRows, ...older.flat()]);
  setAppBadge(pendingObjective(all).length);
  return { todayStr, sessions: all, historyReady: true, windowStart: first };
}

/* ---------- 学生自己的操作之后：修补 / 失效缓存 ---------- */

// 记录页的行（带 chapter / unit 名称）→ 今天 / 洞察用的精简行
function toStudentRow(r) {
  return {
    id: r.id,
    session_date: r.session_date,
    start_time: r.start_time,
    duration_minutes: r.duration_minutes,
    category: r.category,
    form: r.form,
    self_rating: r.self_rating,
    grade_label: r.grade_label ?? null,
    score: r.score ?? null,
    deleted_at: r.deleted_at ?? null,
    course_id: r.course_id ?? r.course?.id ?? null,
    chapter_id: r.chapter_id ?? r.chapter?.id ?? null,
    unit_id: r.unit_id ?? r.unit?.id ?? null,
    course: r.course ? { id: r.course.id, name: r.course.name, course_type: r.course.course_type } : null,
  };
}

function patchStudentSessions(userId, fn) {
  patch(userId, KEYS.student, (v) => (v ? { ...v, sessions: sortRows(fn(v.sessions)) } : v));
}

/** 新增一条记录（插入成功之后）：立刻加进今天 / 洞察，并标记为后台刷新。 */
export function afterSessionAdded(userId, row) {
  if (row) patchStudentSessions(userId, (list) => [toStudentRow(row), ...list.filter((s) => s.id !== row.id)]);
  invalidate(userId, KEYS.student);
}

/** 编辑一条记录：替换该行；拿不到新行时丢弃缓存，下次读取等新数据。 */
export function afterSessionEdited(userId, row) {
  if (!row) { invalidate(userId, KEYS.student, { drop: true }); return; }
  patchStudentSessions(userId, (list) => [toStudentRow(row), ...list.filter((s) => s.id !== row.id)]);
  invalidate(userId, KEYS.student);
}

/** 删除（软删除）一条记录。 */
export function afterSessionDeleted(userId, id) {
  patchStudentSessions(userId, (list) => list.filter((s) => s.id !== id));
  invalidate(userId, KEYS.student);
}

/** 待补填里点了等第：该行变为已补填（grade_label 写入）。 */
export function afterSessionGraded(userId, id, payload) {
  patchStudentSessions(userId, (list) => list.map((s) => (s.id === id ? { ...s, ...payload } : s)));
  invalidate(userId, KEYS.student);
}

/** 考试成绩新增 / 修改 / 删除之后。 */
export function afterExamsChanged(userId) {
  invalidate(userId, KEYS.exams);
}

/** 课程树改动之后（我的课程里新增 / 改名 / 删除课程、章节、单元）。 */
export function afterCoursesChanged(userId) {
  invalidate(userId, KEYS.courseTree);
  invalidate(userId, KEYS.examCourses);
  invalidate(userId, KEYS.syllabus);
  invalidate(userId, KEYS.me);
}

/** 导师邀请有变化（接受 / 拒绝 / 断开 / 实时推送）。 */
export function afterInvitesChanged(userId) {
  invalidate(userId, KEYS.invites);
  invalidate(userId, KEYS.invitesList);
}
