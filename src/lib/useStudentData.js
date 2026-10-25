// 学生端「今天」「洞察」共用的数据 hook：只读，不改任何记录。
// 统计口径全部来自 studentStats.js，这里只负责把行取回来。

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { useAuth } from './useAuth.js';
import { logger } from './logger.js';
import { toLocalDateStr } from './date.js';

const HISTORY_DAYS = 730;     // 连续天数要看得足够远：至少 2 年
const WINDOW_DAYS = 91;       // 分成一个季度一段并行取，避免撞到单次 1000 行上限
const WINDOW_LIMIT = 1000;

const SESSION_COLUMNS = 'id, session_date, start_time, duration_minutes, category, form, '
  + 'self_rating, grade_label, score, deleted_at, course_id, chapter_id, unit_id, '
  + 'course:courses(id, name, course_type)';

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toLocalDateStr(new Date(y, m - 1, d + n));
}

/** 最近一个周期内的 learning_sessions（未删除），按日期、开始时间倒序。 */
async function fetchSessions(userId, todayStr) {
  const first = addDaysStr(todayStr, -HISTORY_DAYS);
  const end = addDaysStr(todayStr, 1);
  const windows = [];
  for (let from = first; from < end; from = addDaysStr(from, WINDOW_DAYS)) {
    const to = addDaysStr(from, WINDOW_DAYS);
    windows.push([from, to < end ? to : end]);
  }
  const results = await Promise.all(windows.map(([from, to]) => supabase
    .from('learning_sessions')
    .select(SESSION_COLUMNS)
    .eq('student_id', userId)
    .is('deleted_at', null)
    .gte('session_date', from)
    .lt('session_date', to)
    .order('session_date', { ascending: false })
    .limit(WINDOW_LIMIT)));
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
  return results
    .flatMap((r) => r.data || [])
    .filter((s) => s && !s.deleted_at)
    .sort((a, b) => {
      if (a.session_date !== b.session_date) return a.session_date < b.session_date ? 1 : -1;
      return String(b.start_time || '') < String(a.start_time || '') ? -1 : 1;
    });
}

/** 附加数据（考试、校内课程、邀请数）失败不影响主体：返回 fallback 并记录日志。 */
async function soft(promise, fallback, label) {
  try {
    const res = await promise;
    if (res.error) { logger.warn(`${label} 加载失败`, res.error); return fallback; }
    return res.data ?? fallback;
  } catch (e) {
    logger.warn(`${label} 加载失败`, e);
    return fallback;
  }
}

/**
 * @param {{ today?: Date }} [opts] today 仅供测试注入
 * @returns {{ loading, error, reload, today, profile, sessions, exams, examCourses, pendingInvites }}
 *  sessions       近 2 年未删除记录（倒序），每行带 course { id, name, course_type }
 *  exams          exam_scores（未删除，日期倒序）
 *  examCourses    校内课程（course_type = 1）
 *  pendingInvites 待处理导师邀请数（teacher_student_connections.status = 0，与 Layout 同一查询）
 */
export function useStudentData({ today } = {}) {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState({
    loading: true, error: null, sessions: [], exams: [], examCourses: [], pendingInvites: 0,
  });
  const [nonce, setNonce] = useState(0);
  const todayStr = toLocalDateStr(today || new Date());

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const [sessions, exams, examCourses, invites] = await Promise.all([
          fetchSessions(userId, todayStr),
          soft(supabase.from('exam_scores').select('*').eq('student_id', userId)
            .is('deleted_at', null).order('exam_date', { ascending: false }), [], '考试成绩'),
          soft(supabase.from('courses').select('id, name, subject, course_type')
            .eq('created_by', userId).eq('course_type', 1).is('deleted_at', null), [], '校内课程'),
          soft(supabase.from('teacher_student_connections').select('id')
            .eq('student_id', userId).eq('status', 0), [], '导师邀请'),
        ]);
        if (!alive) return;
        setState({
          loading: false, error: null, sessions, exams, examCourses, pendingInvites: invites.length,
        });
      } catch (e) {
        if (!alive) return;
        logger.error('学生数据加载失败', e);
        setState((s) => ({ ...s, loading: false, error: e }));
      }
    })();
    return () => { alive = false; };
  }, [userId, todayStr, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload, today: today || new Date(), userId, profile };
}

/**
 * 打开记一笔 sheet。sheet 目前只挂在记录页：
 *  - 已在记录页：直接派发 yb:open-log；
 *  - 在其它页面：先跳到 /records?log=1，页面挂好后再补发一次，让预设（课程 / 类别 / 形式 / 时长）生效。
 * detail 与 LogSheet 的事件约定一致：{ courseId?, category?, form?, durationMinutes?, chapterId?, unitId? }。
 */
export function openLogSheet(navigate, detail, pathname = '') {
  const fire = () => window.dispatchEvent(new CustomEvent('yb:open-log', { detail }));
  if (/^\/(records|learning)(\/|$)/.test(pathname)) { fire(); return; }
  navigate('/records?log=1');
  setTimeout(fire, 150);
}

// ── 两个页面共用的小格式化 ──
export const CATEGORY_LABEL = { 1: '学习', 2: '复习', 3: '练习' };

/** 分钟 → h:mm（环中央的大数字）。 */
export function fmtHM(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** 分钟 → 「1 小时 07 分」「45 分钟」。 */
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小时 ${String(r).padStart(2, '0')} 分` : `${h} 小时`;
}

export function courseName(row) {
  const c = Array.isArray(row?.course) ? row.course[0] : row?.course;
  return c?.name || '未分类';
}
