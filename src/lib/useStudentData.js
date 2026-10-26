// 学生端「今天」「洞察」共用的数据 hook：只读，不改任何记录。
// 统计口径全部来自 studentStats.js，这里只负责把行取回来。
//
// 数据放在按用户隔离的内存缓存里（studentCache.js，stale-while-revalidate）：
//  - 切回来时立即显示缓存，后台刷新，不再整页转圈；
//  - 首次先取最近 91 天就出结果，更早的历史在后台补齐（historyReady 为 false 期间只影响连续天数 / 学习日历）；
//  - 学生自己的保存 / 删除 / 补填会直接修补缓存（见 studentResources.js 的 afterXxx）。

import { useCallback, useEffect } from 'react';
import { useAuth } from './useAuth.js';
import { toLocalDateStr } from './date.js';
import { useCached } from './useCached.js';
import { invalidate } from './studentCache.js';
import {
  KEYS, fetchStudent, fetchExams, fetchExamCourses, fetchInviteCount,
} from './studentResources.js';

const NO_ROWS = [];

/**
 * @param {{ today?: Date }} [opts] today 仅供测试注入
 * @returns {{ loading, error, reload, today, profile, sessions, exams, examCourses, pendingInvites, historyReady, windowStart }}
 *  sessions       近 2 年未删除记录（倒序），每行带 course { id, name, course_type }
 *  exams          exam_scores（未删除，日期倒序）
 *  examCourses    校内课程（course_type = 1）
 *  pendingInvites 待处理导师邀请数（teacher_student_connections.status = 0，与 Layout 同一查询）
 *  historyReady   更早的历史是否已补齐（false 时 sessions 只含最近 91 天，windowStart 是已取到的最早日期）
 */
export function useStudentData({ today } = {}) {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const todayStr = toLocalDateStr(today || new Date());

  const main = useCached(userId, KEYS.student, (ctx) => fetchStudent(userId, todayStr, ctx));
  const examsRes = useCached(userId, KEYS.exams, () => fetchExams(userId));
  const coursesRes = useCached(userId, KEYS.examCourses, () => fetchExamCourses(userId));
  const invitesRes = useCached(userId, KEYS.invites, () => fetchInviteCount(userId));

  // 跨零点：缓存里是昨天算的窗口，丢掉重取
  const wrongDay = Boolean(main.data) && main.data.todayStr !== todayStr;
  useEffect(() => {
    if (wrongDay) {
      invalidate(userId, KEYS.student, { drop: true });
      main.refresh();
    }
  }, [wrongDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = wrongDay ? undefined : main.data;
  const reload = useCallback(() => { main.refresh(); }, [main.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    loading: !data && !main.error,
    error: data ? null : main.error,
    reload,
    today: today || new Date(),
    userId,
    profile,
    sessions: data ? data.sessions : NO_ROWS,
    exams: examsRes.data ?? NO_ROWS,
    examCourses: coursesRes.data ?? NO_ROWS,
    pendingInvites: invitesRes.data ?? 0,
    // 后台补历史失败时不再卡在「补齐中」：用已有数据照常显示
    historyReady: data ? (data.historyReady || Boolean(main.backgroundError)) : false,
    windowStart: data ? data.windowStart : null,
  };
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
