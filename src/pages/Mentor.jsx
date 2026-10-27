import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { supabase, timeoutSignal, getAccessToken } from '../lib/supabase.js';
import { updateWorkspace } from '../lib/e4Store.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import MentorLayout from '../components/MentorLayout.jsx';
import ProfileEditor from '../components/ProfileEditor.jsx';
import WorkspacePreference from '../components/WorkspacePreference.jsx';
import WeekReviewDashboard from '../components/WeekReviewDashboard.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { Button } from '../components/ui/button.jsx';
import { consultantColor, consultantKey, groupByConsultant, parseConsultant } from '../utils/consultant.js';
import { evaluateInactivity, formatInactivity } from '../utils/inactivity.js';
import { toLocalDateStr, todayISO } from '../lib/date.js';
import { useAuth } from '../lib/useAuth.js';
import { applyPendingFilter } from '../lib/sessionRules.js';
import { rememberWorkspacePath } from '../lib/workspaceNav.js';
import StudentTable from '../components/mentor/StudentTable.jsx';
import StudentCards from '../components/mentor/StudentCards.jsx';
import MessageQueue from '../components/mentor/MessageQueue.jsx';
import WeekBoard from '../components/mentor/WeekBoard.jsx';
import StudentMessagesPanel from '../components/mentor/StudentMessagesPanel.jsx';
import { AttentionText, FillStrip, StageTag, StudentLink } from '../components/mentor/FillStrip.jsx';
import { useDrafts } from '../components/mentor/useDrafts.js';
import {
  buildFillInfo, sortGroupStudents, weekBoardRow,
} from '../components/mentor/fillInfo.js';

const VIEWS = ['students', 'analytics', 'syllabus', 'settings'];
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

/** 今天 tab 的日期行：10 月 26 日 周一 */
function dateLineCN(iso) {
  const d = new Date(`${String(iso || '').slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${WEEK_LABEL[d.getDay()]}`;
}

const TAB_BTN = {
  appearance: 'none',
  border: 0,
  background: 'none',
  padding: '9px 14px 10px',
  fontFamily: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
};

const STATUS_META = {
  1: { key: 'connected', label: '已连接' },
  0: { key: 'invited', label: '邀请中' },
  2: { key: 'rejected', label: '已拒绝' },
  '-1': { key: 'uninvited', label: '未邀请' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META['-1'];
}

// RPC 不存在（数据库补丁还没执行）
function isMissingFunction(error) {
  return error?.code === 'PGRST202' || error?.code === '42883'
    || /could not find the function|function .* does not exist/i.test(error?.message || '');
}

const VIEW_MODE_KEY = 'mentor.students.view';

function readViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'cards' ? 'cards' : 'list';
  } catch (_) {
    return 'list';
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

export default function Mentor() {
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // 角色与账号信息统一来自 useAuth（数据库 profile 为权威来源），
  // 不在本页重复实现认证，避免与 ProtectedRoute 逻辑漂移（MEN-2）
  const { user: authUser, profile: authProfile, loading: authLoading } = useAuth();
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const bootstrappedRef = useRef(false);
  const [students, setStudents] = useState([]);
  const [connections, setConnections] = useState([]);
  const [teacherNames, setTeacherNames] = useState({}); // 导师 id → 姓名（管理员看「导师」列）
  const [sessions, setSessions] = useState([]);
  const [sessionsTruncated, setSessionsTruncated] = useState(false); // 命中 2000 条上限时提示
  const [busy, setBusy] = useState(false);
  const [deployCheck, setDeployCheck] = useState({ ok: true, message: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSchool, setFilterSchool] = useState('all');
  const [filterConsultant, setFilterConsultant] = useState('all'); // 顾问筛选：'all' | consultantKey
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set()); // 折叠的顾问分区
  const [syllabusCourses, setSyllabusCourses] = useState([]);
  const [syllabusLoading, setSyllabusLoading] = useState(false);
  const [studentScores, setStudentScores] = useState([]);
  const [studentScoresLoading, setStudentScoresLoading] = useState(false);
  const [inviteNotes, setInviteNotes] = useState({});
  const [schools, setSchools] = useState([]);
  const [classStats, setClassStats] = useState({});
  const [editingSchoolId, setEditingSchoolId] = useState(null);
  const [editingSchoolValue, setEditingSchoolValue] = useState('');
  const [editingAliasId, setEditingAliasId] = useState(null);
  const [editingAliasValue, setEditingAliasValue] = useState('');
  const [deleteBusyId, setDeleteBusyId] = useState(null);  // 永久删除 per-student busy
  const [inviteBusyId, setInviteBusyId] = useState(null);  // 发送/撤回邀请 per-student busy
  const [isMobile, setIsMobile] = useState(false);
  // 填写情况：近 7 天（+ 窗口外最后一条）的 session_date、待补填数量；today 为加载时的本地日期
  const [fill, setFill] = useState({ loaded: false, today: null, datesByStudent: {}, pendingByStudent: null });
  const [viewMode, setViewMode] = useState(readViewMode); // 'list' | 'cards'
  const [selectedId, setSelectedId] = useState(null);      // 键盘游标 / 当前高亮学生
  const searchRef = useRef(null);
  const statsArgsRef = useRef(null);
  const statsAtRef = useRef(0);
  // 确认对话框状态（替代原生 confirm()）
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', confirmLabel: '确认', variant: 'danger', onConfirm: null });

  // ── URL 是页面状态的唯一来源（decision 10）──
  // ?view=students|analytics|syllabus|settings（默认 students）
  // &tab=today|all（只对 students 有效，默认 today）
  // &student=<id>（数据分析 / 课表选中的学生）
  const viewParam = searchParams.get('view');
  const activeView = VIEWS.includes(viewParam) ? viewParam : 'students';
  const tab = activeView === 'students' && searchParams.get('tab') === 'all' ? 'all' : 'today';
  const studentParam = searchParams.get('student') || '';
  // 选中的学生由 URL 决定；对象引用保持稳定，下面的拉记录 effect 才不会反复重跑
  const picked = useMemo(
    () => (studentParam ? students.find((s) => s.id === studentParam) || null : null),
    [students, studentParam],
  );

  const buildParams = (next) => {
    const p = new URLSearchParams();
    const view = next.view || 'students';
    if (view !== 'students') p.set('view', view);
    if (view === 'students' && next.tab === 'all') p.set('tab', 'all');
    if (next.student && (view === 'analytics' || view === 'syllabus')) p.set('student', next.student);
    return p;
  };

  /** 同一个 URL 不重复入栈；点击入栈，选择 / 筛选只替换当前这条 */
  const goUrl = (next, { replace = false } = {}) => {
    const params = buildParams(next);
    if (params.toString() === searchParams.toString()) return;
    setSearchParams(params, { replace });
  };

  const setActiveView = (view, { replace = false } = {}) => {
    if (!VIEWS.includes(view)) return;
    const keepStudent = view === 'analytics' || view === 'syllabus' ? studentParam || null : null;
    goUrl({ view, tab, student: keepStudent }, { replace });
  };

  function goTab(nextTab) {
    goUrl({ view: 'students', tab: nextTab });
  }

  function pickStudent(id) {
    goUrl({ view: activeView === 'syllabus' ? 'syllabus' : 'analytics', student: id || null }, { replace: true });
  }

  // /mentor?student=<id>（E4 详情、旧的 FillStrip 链接）：没有 view 时落到数据分析。
  // 用 replace，别让这条修正本身多占一格历史。
  useEffect(() => {
    if (!searchParams.get('student') || searchParams.get('view')) return;
    goUrl({ view: 'analytics', student: searchParams.get('student') }, { replace: true });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // 记住本平台最后停留的页面，切去 E4 再回来时原样返回。
  useEffect(() => {
    rememberWorkspacePath('tracker', location.pathname + location.search);
  }, [location.pathname, location.search]);

  useEffect(() => {
    // 导师端：仅真实手机（触屏 + 无 hover + ≤480px）才走移动版
    // 桌面窗口无论多窄、iPad 等大屏一律走桌面版
    const mq = window.matchMedia('(pointer: coarse) and (hover: none) and (max-width: 480px)');
    const handler = (e) => setIsMobile(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 师生连接状态实时刷新：学生接受邀请/断开连接后自动重拉 connections（无需手动刷新页面）
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const channel = supabase
      .channel('mentor-connections')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'teacher_student_connections',
        filter: `teacher_id=eq.${user.id}`,
      }, async (payload) => {
        if (cancelled) return;
        logger.log('[realtime] mentor connections event:', payload.eventType, payload);
        // 收到变更即完整重拉一遍 students/connections，状态立即生效
        try {
          await loadData(user.id, isAdmin);
        } catch (e) {
          logger.error('[realtime] loadData failed:', e);
        }
      })
      .subscribe((status, err) => {
        if (err) {
          logger.error('[realtime] mentor-connections subscribe error:', err);
          console.warn(
            '%c[Realtime 未启用]%c 需要在 Supabase Dashboard → Database → Replication 启用 public.teacher_student_connections 表的 realtime，否则学生接受邀请后需手动刷新页面才能看到状态变更。',
            'color:#b45309;font-weight:700;', ''
          );
        } else {
          logger.log('[realtime] mentor-connections channel status:', status);
        }
      });
    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (authLoading || !authUser || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    (async () => {
      try {
        const role = Number(authProfile?.role || 1);
        if (role < 2) {
          toast('仅老师账号可访问导师页面', { kind: 'error' });
          nav('/', { replace: true });
          return;
        }
        setUser(authUser);
        // 记住上次打开的工作区：下次登录直接落到一表人才
        if (authProfile?.default_workspace !== 'tracker') {
          updateWorkspace(authUser.id, 'tracker').catch(() => {});
        }
        const admin = role >= 3;
        setIsAdmin(admin);
        setTeacherNames({ [authUser.id]: authProfile?.full_name || '老师' });
        await loadData(authUser.id, admin);
      } catch (err) {
        logger.error('Mentor init failed:', err);
        toast('加载失败，请刷新重试', { kind: 'error' });
      }
    })();
  }, [authLoading, authUser, authProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData(teacherId, admin = isAdmin) {
    logger.log('===== 老师端加载数据 =====');
    logger.log('teacherId:', teacherId, 'isAdmin:', admin);

    // 管理员看全部学生的连接（「导师」列要显示实际归属人）；导师只看自己的连接
    let connQuery = supabase
      .from('teacher_student_connections')
      .select('id, student_id, teacher_id, status, note, mentor_alias, created_at, updated_at');
    if (!admin) connQuery = connQuery.eq('teacher_id', teacherId);

    const [pRes, cRes, sRes, tRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, role, full_name, school_name, created_at')
        .in('role', [1])
        .order('created_at', { ascending: false })
        .limit(500),
      connQuery,
      supabase
        .from('profiles')
        .select('school_name')
        .in('role', [1])
        .not('school_name', 'is', null)
        .not('school_name', 'eq', ''),
      admin
        ? supabase.from('profiles').select('id, full_name').in('role', [2, 3])
        : Promise.resolve({ data: null, error: null }),
    ]);

    logger.log('profiles 查询结果:', pRes);
    logger.log('connections 查询结果:', cRes);
    logger.log('schools 查询结果:', sRes);

    if (pRes.error) {
      logger.error('profiles 查询错误:', pRes.error);
      setDeployCheck({ ok: false, message: `无法获取学生列表：${pRes.error.message}` });
    }

    if (cRes && cRes.error) {
      const code = cRes.error.code || '';
      const hint = code === '42P01' || /relation.*does not exist/i.test(cRes.error.message)
        ? '需要在 Supabase SQL Editor 运行 schema.patch-invites.sql 创建邀请表。'
        : '请检查数据库表和 RLS 策略是否已部署。';
      setDeployCheck({ ok: false, message: `邀请系统未就绪（${cRes.error.code || 'error'}: ${cRes.error.message}）— ${hint}` });
    } else if (teacherId) {
      const pRes2 = await supabase
        .from('profiles')
        .select('id, role, full_name')
        .eq('id', teacherId)
        .single();
      logger.log('老师身份查询结果:', pRes2);
      if (pRes2.error) {
        setDeployCheck({ ok: false, message: `无法读取你的老师身份（${pRes2.error.code}: ${pRes2.error.message}）` });
      } else if (Number(pRes2.data.role) < 2) {
        setDeployCheck({ ok: false, message: `当前账号 role=${pRes2.data.role}，老师端需要 role>=2。` });
      }
    }

    setStudents(pRes.data || []);
    if (tRes?.data) {
      setTeacherNames(Object.fromEntries(tRes.data.map((t) => [t.id, t.full_name || ''])));
    }
    const map = {};
    const rank = { 1: 0, 0: 1, 2: 2 };
    for (const c of (cRes.data || [])) {
      const cur = map[c.student_id];
      if (!cur || (rank[c.status] ?? 9) <= (rank[cur.status] ?? 9)) map[c.student_id] = c;
    }

    // admin 自动与所有未连接学生建立真实连接（status=1），跳过邀请流程
    if (admin) {
      const needConnect = (pRes.data || []).filter((s) => !map[s.id] && s.id !== teacherId);
      if (needConnect.length > 0) {
        const rows = needConnect.map((s) => ({
          teacher_id: teacherId,
          student_id: s.id,
          status: 1,
          note: 'auto-admin',
        }));
        const { error: insErr } = await supabase
          .from('teacher_student_connections')
          .insert(rows);
        if (!insErr) {
          for (const s of needConnect) {
            map[s.id] = { student_id: s.id, teacher_id: teacherId, status: 1, note: 'auto-admin' };
          }
        } else {
          // 插入失败时退回虚拟连接，保证前端仍可显示学生列表。
          // 注意：虚拟连接不满足 learning_sessions 的 RLS（需要真实 status=1 连接行），
          // 这些学生的记录会读不到——必须显式告警，不能静默。
          for (const s of needConnect) {
            map[s.id] = { student_id: s.id, teacher_id: teacherId, status: 1, note: 'admin', virtual: true };
          }
          setDeployCheck({
            ok: false,
            message: `自动建立师生连接失败（${insErr.message}）。${needConnect.length} 名学生仍显示在列表中，但他们的学习记录暂时读不到。请刷新重试；若持续出现，需检查 teacher_student_connections 的写入策略。`,
          });
        }
      }
    }
    setConnections(map);

    const schoolSet = new Set((sRes.data || []).map((p) => p.school_name).filter(Boolean));
    setSchools(Array.from(schoolSet).sort());

    await loadClassStats(map, pRes.data || [], admin);
  }

  async function loadClassStats(connectionsMap, allStudents, admin) {
    // admin 看全部学生；普通导师只看已连接（status === 1）的学生。
    // 虚拟连接（admin 自动建连失败时的占位）读不到学习记录，参与判定会全量误报，先排除。
    const rawTargets = admin
      ? (allStudents || []).map((s) => s.id)
      : Object.values(connectionsMap || {})
          .filter((c) => c.status === 1)
          .map((c) => c.student_id);
    const targetStudents = rawTargets.filter((id) => !connectionsMap?.[id]?.virtual);
    statsArgsRef.current = [connectionsMap, allStudents, admin];
    statsAtRef.current = Date.now();

    if (targetStudents.length === 0) {
      setFill({ loaded: true, today: toLocalDateStr(new Date()), datesByStudent: {}, pendingByStudent: {} });
      setClassStats({
        totalStudents: 0,
        avgDailyMinutes: 0,
        avgScore: 0,
        activeStudents: 0,
        inactiveCount: 0,
        inactiveByStudent: {},
      });
      return;
    }

    const { data: sessionData, error } = await supabase
      .from('learning_sessions')
      .select('student_id, session_date, duration_minutes, eval_type, score')
      .in('student_id', targetStudents)
      .is('deleted_at', null)
      .gte('session_date', toLocalDateStr(new Date(Date.now() - 7 * 24 * 3600 * 1000)))
      .limit(20000) // 防御：admin 可能覆盖数百名学生，避免无上限全量拉取
      .abortSignal(timeoutSignal(30000)); // 聚合查询放宽到 30s

    if (error) {
      logger.error('loadClassStats error:', error);
      return;
    }

    const studentMins = {};
    let totalScore = 0;
    let scoreCount = 0;

    for (const s of sessionData || []) {
      const sid = s.student_id;
      studentMins[sid] = (studentMins[sid] || 0) + (s.duration_minutes || 0);
      if (Number(s.eval_type) === 2 && s.score != null) {
        totalScore += Number(s.score);
        scoreCount++;
      }
    }

    const totalMins = Object.values(studentMins).reduce((a, b) => a + b, 0);
    const activeStudents = Object.keys(studentMins).length;

    // 连续两天未填写：复用同一批记录判定（学习日粒度，与「本周活跃」同口径）
    const targetSet = new Set(targetStudents);
    const targetMetas = (allStudents || []).filter((s) => targetSet.has(s.id));
    const { inactiveByStudent, inactiveCount } = evaluateInactivity(
      sessionData || [],
      targetMetas,
      toLocalDateStr(new Date()),
      { truncated: (sessionData || []).length >= 20000 },
    );

    setClassStats({
      totalStudents: targetStudents.length,
      avgDailyMinutes: targetStudents.length > 0 ? Math.round(totalMins / targetStudents.length / 7) : 0,
      avgScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      activeStudents,
      inactiveCount,
      inactiveByStudent,
    });

    // —— 填写情况：沿用上面这批 session_date，再补两条轻量查询 ——
    const todayIso = toLocalDateStr(new Date());
    const datesByStudent = {};
    for (const r of sessionData || []) {
      const d = String(r.session_date || '').slice(0, 10);
      if (!d) continue;
      (datesByStudent[r.student_id] ||= []).push(d);
    }
    // 近 7 天一条都没有的学生：补查最后一条记录（用于「最后记录 / N 天没填」，否则 8 天前的记录会被误判成「从没记录」）
    const quiet = targetStudents.filter((id) => !datesByStudent[id]);
    const [olderRes, pendingRes] = await Promise.all([
      quiet.length > 0
        ? supabase
            .from('learning_sessions')
            .select('student_id, session_date')
            .in('student_id', quiet)
            .is('deleted_at', null)
            .order('session_date', { ascending: false })
            .limit(Math.min(5000, quiet.length * 40 + 200))
            .abortSignal(timeoutSignal(30000))
        : Promise.resolve({ data: [], error: null }),
      // 待补填：练习 + 没有等第 + 没有分数（与学生端、数据分析同一口径）
      applyPendingFilter(
        supabase.from('learning_sessions').select('student_id').in('student_id', targetStudents).limit(5000)
      ).abortSignal(timeoutSignal(30000)),
    ]);
    if (olderRes.error) logger.warn('last-record lookup failed:', olderRes.error);
    for (const r of olderRes.data || []) {
      const d = String(r.session_date || '').slice(0, 10);
      if (!d || datesByStudent[r.student_id]) continue; // 每人只取最新一条
      datesByStudent[r.student_id] = [d];
    }
    let pendingByStudent = null;
    if (pendingRes.error) {
      logger.warn('pending count failed:', pendingRes.error);
    } else {
      pendingByStudent = {};
      for (const r of pendingRes.data || []) pendingByStudent[r.student_id] = (pendingByStudent[r.student_id] || 0) + 1;
    }
    setFill({ loaded: true, today: todayIso, datesByStudent, pendingByStudent });
  }

  const pickedIdRef = useRef(null);

  async function fetchPickedSessions(studentId, { silent = false } = {}) {
    if (!silent) setBusy(true);
    const { data, error } = await supabase
      .from('learning_sessions')
      .select(`
        id, session_date, start_time, end_time, duration_minutes, category, form, eval_type,
        score, self_rating, grade_label, notes, course_id, created_at,
        course:course_id(name, subject),
        chapter:chapter_id(name, deleted_at), unit:unit_id(name, deleted_at)
      `)
      .eq('student_id', studentId)
      .is('deleted_at', null)
      .order('session_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000);
    // 请求在飞行途中用户可能已切换到另一个学生，过期响应直接丢弃
    if (pickedIdRef.current !== studentId) return;
    if (error) {
      logger.error('mentor load sessions', error);
      if (!silent) {
        toast('加载学生学习记录失败：' + error.message, { kind: 'error' });
        setSessions([]);
      }
    } else {
      setSessions(
        (data || []).map((s) => ({
          ...s,
          date: String(s.session_date || '').slice(0, 10),
          time: s.start_time ? String(s.start_time).slice(0, 5) : null,
          subject: s.course?.name || s.course?.subject || '未分类',
        }))
      );
      setSessionsTruncated((data || []).length >= 2000);
    }
    if (!silent) setBusy(false);
  }

  useEffect(() => {
    pickedIdRef.current = picked ? picked.id : null;
    if (!picked) return setSessions([]);
    fetchPickedSessions(picked.id);

    // 页面重新可见/聚焦时静默刷新，保证学生新提交的记录能及时出现
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      fetchPickedSessions(picked.id, { silent: true });
      fetchPickedScores(picked.id, { silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    // 轮询兜底：即使 visibility/focus 事件不触发（PWA、嵌入式 webview 等），
    // 也能在 60 秒内自动拿到学生的新提交
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchPickedSessions(picked.id, { silent: true });
      }
    }, 60000);

    // realtime：学生提交/修改/删除记录时即刻刷新（需生产库启用 learning_sessions 的 replication，
    // 见 supabase/migrations/004-enable-realtime-sessions.sql；未启用时退化为 focus 刷新）
    const channel = supabase
      .channel(`mentor_sessions_${picked.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'learning_sessions',
        filter: `student_id=eq.${picked.id}`,
      }, () => {
        fetchPickedSessions(picked.id, { silent: true });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          logger.warn('[Realtime] learning_sessions 订阅失败，已退化为页面聚焦时刷新');
        }
      });

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(poll);
      channel.unsubscribe();
    };
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载选中学学生的 syllabus（课程→章节→单元）
  useEffect(() => {
    if (!picked) { setSyllabusCourses([]); return; }
    let cancelled = false;
    setSyllabusLoading(true);
    supabase
      .from('courses')
      .select(`
        id, name, subject, source, course_type, created_by,
        chapters:chapters(id, name, order_idx, deleted_at, units:units(id, name, order_idx, deleted_at))
      `)
      .is('deleted_at', null)
      .eq('created_by', picked.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          logger.error('mentor load syllabus', error);
          setSyllabusCourses([]);
        } else {
          const sorted = (data || []).map(c => ({
            ...c,
            chapters: (c.chapters || [])
              .filter(ch => !ch.deleted_at)
              .slice()
              .sort((a, b) => (a.order_idx || 0) - (b.order_idx || 0))
              .map(ch => ({
                ...ch,
                units: (ch.units || [])
                  .filter(u => !u.deleted_at)
                  .slice()
                  .sort((a, b) => (a.order_idx || 0) - (b.order_idx || 0))
              }))
          }));
          setSyllabusCourses(sorted);
        }
        setSyllabusLoading(false);
      });
    return () => { cancelled = true; };
  }, [picked]);

  // 加载选中学生的校内课程考试成绩（exam_scores join courses）
  async function fetchPickedScores(studentId, { silent = false } = {}) {
    if (!silent) setStudentScoresLoading(true);
    const { data, error } = await supabase
      .from('exam_scores')
      .select(`
        *,
        course:courses(id, name, course_type)
      `)
      .eq('student_id', studentId)
      .is('deleted_at', null)
      .order('exam_date', { ascending: false })
      .order('created_at', { ascending: false });
    // 过期响应直接丢弃（用户可能已切换到另一个学生）
    if (pickedIdRef.current !== studentId) return;
    if (error) {
      logger.error('mentor load studentScores', error);
      if (!silent) setStudentScores([]);
    } else {
      // 仅保留 course_type=1（校内课程）的成绩
      setStudentScores((data || []).filter(s => s.course && s.course.course_type === 1));
    }
    if (!silent) setStudentScoresLoading(false);
  }

  useEffect(() => {
    if (!picked) { setStudentScores([]); return; }
    fetchPickedScores(picked.id);
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendInvite(studentId) {
    if (!user) { toast('请先登录老师账号', { kind: 'error' }); return; }
    if (!deployCheck.ok) { toast('邀请系统尚未部署完成', { kind: 'error' }); return; }
    if (inviteBusyId) return;
    const existing = connections[studentId];
    // 邀请中：行已存在，再插入会撞唯一约束；邀请保持有效即可
    if (existing?.status === 0) {
      toast('邀请已发出，正在等待学生接受', { kind: 'success' });
      return;
    }
    const note = inviteNotes[studentId] || '';
    setInviteBusyId(studentId);
    try {
      if (existing?.status === 2) {
        // 已拒绝 / 已断开：把原有的行改回邀请中（插入新行会撞 unique(teacher_id, student_id)）
        const { error } = await supabase.rpc('mentor_reinvite', { p_student: studentId, p_note: note || null });
        if (error) {
          if (isMissingFunction(error)) throw new Error('暂时无法再次邀请：数据库还没升级，请联系管理员（需执行 schema.patch-mentor-connections.sql）');
          throw error;
        }
        notifyReinvite(studentId); // 再次邀请要再推送一次邀请通知；不等待，失败不影响邀请本身
      } else {
        const { error } = await supabase
          .from('teacher_student_connections')
          .insert({ teacher_id: user.id, student_id: studentId, status: 0, note });
        if (error) throw error;
      }
      setConnections((m) => ({
        ...m,
        [studentId]: { id: 'new', student_id: studentId, status: 0, note, created_at: new Date().toISOString() },
      }));
      setInviteNotes((m) => ({ ...m, [studentId]: '' }));
      toast('已发送邀请，等待学生接受。', { kind: 'success' });
    } catch (err) {
      logger.error('sendInvite failed:', err);
      const code = err && err.code;
      const msg = err && err.message;
      if (code === '42P01' || /relation.*does not exist/i.test(msg || '')) {
        toast('邀请表未创建。请在 Supabase SQL Editor 运行 schema.patch-invites.sql。', { kind: 'error' });
      } else if (code === '23505' || /unique.*constraint/i.test(msg || '')) {
        toast('该学生已经被邀请过了', { kind: 'error' });
      } else if (!code && msg) {
        toast(msg, { kind: 'error' });
      } else {
        toast(`邀请失败（${code || 'error'}: ${msg || '未知错误'}）`, { kind: 'error' });
      }
    } finally {
      setInviteBusyId(null);
    }
  }

  // 再次邀请成功后补发邀请推送（带导师登录令牌；客户端拿不到 NOTIFY_SECRET）。失败只记日志。
  async function notifyReinvite(studentId) {
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
        body: JSON.stringify({ type: 'reinvite', student_id: studentId }),
      });
      if (!res.ok) logger.warn('reinvite push not sent:', res.status);
    } catch (e) {
      logger.warn('reinvite push failed:', e);
    }
  }

  async function withdrawInvite(studentId) {
    const c = connections[studentId];
    if (!c || c.status !== 0) return;
    if (inviteBusyId) return;
    setConfirmState({
      open: true,
      title: '撤回邀请',
      message: '确定撤回这封邀请吗？',
      confirmLabel: '撤回',
      variant: 'danger',
      onConfirm: () => {
        setConfirmState((s) => ({ ...s, open: false }));
        doWithdrawInvite(studentId);
      },
    });
  }

  async function doWithdrawInvite(studentId) {
    const c = connections[studentId];
    if (!c || c.status !== 0) return;
    setInviteBusyId(studentId);
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .delete()
        .match({ teacher_id: user.id, student_id: studentId });
      if (error) throw error;
      setConnections((m) => { const next = { ...m }; delete next[studentId]; return next; });
      toast('已撤回邀请', { kind: 'success' });
    } catch (err) {
      logger.error('withdrawInvite failed:', err);
      toast(`撤回失败`, { kind: 'error' });
    } finally {
      setInviteBusyId(null);
    }
  }

  async function disconnectStudent(studentId) {
    const c = connections[studentId];
    if (!c || c.status !== 1) return;
    setConfirmState({
      open: true,
      title: '断开连接',
      message: '确定断开与这位学生的连接吗？断开后将无法查看他的学习数据。',
      confirmLabel: '断开',
      variant: 'danger',
      onConfirm: () => {
        setConfirmState((s) => ({ ...s, open: false }));
        doDisconnectStudent(studentId);
      },
    });
  }

  async function doDisconnectStudent(studentId) {
    const c = connections[studentId];
    if (!c || c.status !== 1) return;
    try {
      const { error } = await supabase.rpc('mentor_disconnect', { p_student: studentId });
      if (error && isMissingFunction(error)) {
        // 补丁未执行时退回直接更新，但必须确认真的改到了行：
        // 没有老师 UPDATE 策略时更新 0 行也不报错，之前会显示假的「已断开」
        const { data, error: updErr } = await supabase
          .from('teacher_student_connections')
          .update({ status: 2, updated_at: new Date().toISOString() })
          .match({ teacher_id: user.id, student_id: studentId })
          .select('id');
        if (updErr) throw updErr;
        if (!data || data.length === 0) {
          throw new Error('数据库还没升级，请联系管理员（需执行 schema.patch-mentor-connections.sql）');
        }
      } else if (error) {
        throw error;
      }
      setConnections((m) => ({ ...m, [studentId]: { ...c, status: 2, updated_at: new Date().toISOString() } }));
      toast('已断开连接', { kind: 'success' });
    } catch (err) {
      logger.error('disconnectStudent failed:', err);
      toast(err?.message ? `断开失败：${err.message}` : '断开失败', { kind: 'error' });
    }
  }

  async function saveSchoolName(studentId, newSchool) {
    if (!newSchool.trim()) {
      toast('学校名称不能为空', { kind: 'error' });
      return;
    }
    try {
      // Use SECURITY DEFINER RPC to bypass RLS safely (mentor is not the
      // student owner, so direct profiles.update would fail RLS).
      const { error } = await supabase.rpc('update_student_school', {
        p_student_id: studentId,
        p_school_name: newSchool.trim(),
      });
      if (error) throw error;
      setStudents((prev) => prev.map((s) => s.id === studentId ? { ...s, school_name: newSchool.trim() } : s));
      setSchools((prev) => {
        const updated = [...prev, newSchool.trim()];
        return [...new Set(updated)].sort();
      });
      setEditingSchoolId(null);
      setEditingSchoolValue('');
      toast('学校名称已更新', { kind: 'success' });
    } catch (err) {
      logger.error('saveSchoolName failed:', err);
      toast(`更新失败：${err.message}`, { kind: 'error' });
    }
  }

  // 保存学生别名（仅当前导师可见，存于 teacher_student_connections.mentor_alias）
  // 空字符串清除别名。Mirrors saveSchoolName 的 RPC 模式。
  async function saveStudentAlias(studentId, newAlias) {
    const trimmed = (newAlias || '').trim();
    try {
      const { error } = await supabase.rpc('update_student_alias', {
        p_student_id: studentId,
        p_alias: trimmed,
      });
      if (error) throw error;
      setConnections((prev) => {
        const cur = prev[studentId];
        if (!cur) return prev;
        return { ...prev, [studentId]: { ...cur, mentor_alias: trimmed || null, updated_at: new Date().toISOString() } };
      });
      setEditingAliasId(null);
      setEditingAliasValue('');
      toast(trimmed ? '备注名已更新' : '备注名已清除', { kind: 'success' });
    } catch (err) {
      logger.error('saveStudentAlias failed:', err);
      toast(`更新失败：${err.message}`, { kind: 'error' });
    }
  }

  // 永久删除学生（admin only）。从 auth.users 真删，级联删除所有相关数据。
  function deleteStudent(studentId) {
    if (!isAdmin) return;
    const s = students.find((x) => x.id === studentId);
    if (!s) return;
    if (deleteBusyId) return;
    const displayName = connections[studentId]?.mentor_alias || s.full_name || '该学生';
    setConfirmState({
      open: true,
      title: '永久删除学生',
      message: `确定永久删除「${displayName}」吗？此操作不可恢复，将同时删除该学生的学习记录、连接、反馈等所有数据。请确认你删除的是测试账号。`,
      confirmLabel: '永久删除',
      variant: 'danger',
      onConfirm: () => {
        setConfirmState((st) => ({ ...st, open: false }));
        doDeleteStudent(studentId);
      },
    });
  }

  async function doDeleteStudent(studentId) {
    if (!isAdmin) return;
    setDeleteBusyId(studentId);
    try {
      const { data, error } = await supabase.rpc('delete_student', {
        p_student_id: studentId,
      });
      if (error) throw error;
      // 本地立即移除，避免等待重拉的延迟感
      setStudents((prev) => prev.filter((s) => s.id !== studentId));
      setConnections((prev) => {
        const next = { ...prev };
        delete next[studentId];
        return next;
      });
      if (studentParam === studentId) setActiveView('analytics', { replace: true });
      toast('学生已永久删除', { kind: 'success' });
      // 重拉一次，刷新统计与左侧列表
      try { await loadData(user.id, isAdmin); } catch (_) {}
      logger.log('delete_student rpc returned:', data);
    } catch (err) {
      logger.error('deleteStudent failed:', err);
      toast(`删除失败：${err.message}`, { kind: 'error' });
    } finally {
      setDeleteBusyId(null);
    }
  }

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const name = s.full_name || '';
      const alias = connections[s.id]?.mentor_alias || '';
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        name.toLowerCase().includes(q) || alias.toLowerCase().includes(q)
        || (s.school_name || '').toLowerCase().includes(q);

      const matchesSchool = filterSchool === 'all' || s.school_name === filterSchool;

      const conn = connections[s.id];
      let matchesFilter = true;
      if (filterStatus === 'connected') matchesFilter = conn?.status === 1;
      else if (filterStatus === 'invited') matchesFilter = conn?.status === 0;
      else if (filterStatus === 'rejected') matchesFilter = conn?.status === 2;
      else if (filterStatus === 'uninvited') matchesFilter = !conn;
      return matchesSearch && matchesSchool && matchesFilter;
    });
  }, [students, connections, searchQuery, filterStatus, filterSchool]);

  // 按顾问分组（基于筛选后的学生，顾问归属从备注名的括号里解析）
  const consultantGroups = useMemo(
    () => groupByConsultant(filteredStudents, connections),
    [filteredStudents, connections],
  );

  // 顾问下拉的选项：全部学生，不随搜索 / 学校 / 连接筛选变化
  const consultantOptions = useMemo(
    () => groupByConsultant(students, connections),
    [students, connections],
  );

  // 顾问数：全部学生里的顾问数量（不受筛选影响）
  const consultantCount = useMemo(() => {
    const keys = new Set();
    for (const s of students) {
      const { consultant } = parseConsultant(connections[s.id]?.mentor_alias || '');
      if (consultant) keys.add(consultantKey(consultant));
    }
    return keys.size;
  }, [students, connections]);

  // 移动端分组小标题：仅当存在具名顾问时显示，避免全部未分配时的噪音
  const showConsultantHeadings = consultantCount > 0;

  const visibleGroups = useMemo(
    () => (filterConsultant === 'all'
      ? consultantGroups
      : consultantGroups.filter((g) => consultantKey(g.consultant) === filterConsultant)),
    [consultantGroups, filterConsultant],
  );

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── 填写情况（近 7 天 / 阶段 / 需关注 / 待补填）──
  const infoById = useMemo(() => {
    const m = {};
    for (const s of students) {
      const conn = connections[s.id];
      const connected = fill.loaded && conn?.status === 1 && !conn?.virtual;
      m[s.id] = buildFillInfo({
        student: s,
        connected,
        dates: fill.datesByStudent[s.id],
        todayIso: fill.today,
        pending: fill.pendingByStudent ? (fill.pendingByStudent[s.id] || 0) : null,
      });
    }
    return m;
  }, [students, connections, fill]);
  const infoOf = (id) => infoById[id] || { connected: false, pending: null };

  const studentById = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);

  // 组内排序：已连接在前 → 首月在前 → 没填天数多的在前 → 原顺序
  const displayGroups = useMemo(
    () => visibleGroups.map((g) => ({ ...g, students: sortGroupStudents(g.students, (id) => infoById[id]) })),
    [visibleGroups, infoById],
  );

  // 键盘 J/K 的顺序：按页面上从上到下的学生（折叠的分组不参与）
  const orderedIds = useMemo(
    () => displayGroups.flatMap((g) => (collapsedGroups.has(consultantKey(g.consultant)) ? [] : g.students.map((s) => s.id))),
    [displayGroups, collapsedGroups],
  );

  const mentorNameOf = (id) => {
    const c = connections[id];
    return (c?.teacher_id && teacherNames[c.teacher_id]) || '';
  };

  const personOf = (id) => {
    const s = studentById[id];
    const alias = connections[id]?.mentor_alias || '';
    const { consultant, cleanName } = parseConsultant(alias);
    const info = infoById[id];
    return {
      id,
      name: cleanName || alias || s?.full_name || '(未命名)',
      advisor: consultant,
      consultant,
      color: consultantColor(consultant),
      stageText: info?.connected ? info.stage : '',
      school: s?.school_name || '',
      mentorName: mentorNameOf(id),
      info,
    };
  };

  // 草稿：只看已连接（读得到记录）的学生
  const draftStudentIds = useMemo(
    () => students.filter((s) => connections[s.id]?.status === 1 && !connections[s.id]?.virtual).map((s) => s.id),
    [students, connections],
  );
  const dr = useDrafts({ supabase, getAccessToken, userId: user?.id, studentIds: draftStudentIds });

  const openDrafts = useMemo(() => dr.drafts.filter((d) => d.status === 'draft'), [dr.drafts]);

  // 一位学生今天最终落在「今天的消息」里的那一条：待发优先，其次今天处理过的
  const draftByStudent = useMemo(() => {
    const m = {};
    for (const d of dr.drafts) {
      if (d.status === 'dropped') continue;
      const cur = m[d.student_id];
      if (!cur || (d.status === 'draft' && cur.status !== 'draft')) m[d.student_id] = d;
    }
    return m;
  }, [dr.drafts]);

  const todayIso = fill.today || todayISO();
  const todayDateLine = dateLineCN(todayIso);

  // 今天 tab 的「这周谁记了」：已连接、符合搜索和顾问筛选的学生
  const todayRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return draftStudentIds
      .map((id) => studentById[id])
      .filter(Boolean)
      .filter((s) => {
        const alias = connections[s.id]?.mentor_alias || '';
        const { consultant, cleanName } = parseConsultant(alias);
        if (filterConsultant !== 'all' && consultantKey(consultant) !== filterConsultant) return false;
        if (!q) return true;
        return (cleanName || '').toLowerCase().includes(q)
          || alias.toLowerCase().includes(q)
          || (s.full_name || '').toLowerCase().includes(q)
          || (s.school_name || '').toLowerCase().includes(q);
      })
      .map((s) => weekBoardRow({
        ...s,
        mentorName: teacherNames[connections[s.id]?.teacher_id] || '',
      }, infoById[s.id], draftByStudent[s.id], todayIso));
  }, [draftStudentIds, studentById, connections, infoById, draftByStudent, todayIso, filterConsultant, searchQuery, teacherNames]);

  // 今天 tab 的抬头数字：几条表扬、几条提醒、今天已经发了多少
  const praiseCount = openDrafts.filter((d) => d.kind !== 'nudge' && !(d.kind === 'weekly' && d.meta?.nudge)).length;
  const reminderCount = openDrafts.length - praiseCount;
  const sentTodayCount = dr.drafts.filter((d) => d.status === 'sent').length;

  /** 「今天的消息」列：滚动到对应卡片，闪一下引起注意（不跳页） */
  function jumpToDraft(studentId) {
    const draft = draftByStudent[studentId];
    if (!draft) return;
    const el = document.getElementById(`md-msg-${draft.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'box-shadow .25s';
    el.style.boxShadow = '0 0 0 3px rgba(28, 28, 30, 0.16)';
    setTimeout(() => { el.style.boxShadow = ''; }, 1200);
  }

  function openStudentById(id) {
    if (!id) return;
    setSelectedId(id);
    goUrl({ view: 'analytics', student: id });
  }

  function switchViewMode(mode) {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch (_) { /* 隐私模式等：不记住也不影响使用 */ }
  }

  // 切回标签页时（且距上次超过 2 分钟）重算填写情况，保证「昨天没填」「3 天以上没填」不过期
  useEffect(() => {
    if (!user) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!statsArgsRef.current || Date.now() - statsAtRef.current < 120000) return;
      loadClassStats(...statsArgsRef.current).catch((e) => logger.warn('stats refresh failed:', e));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // 键盘：J/K 移动、Enter 打开、/ 搜索（在输入框里不触发；只作用在「全部学生」列表）
  useEffect(() => {
    if (isMobile || activeView !== 'students') return undefined;
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (isTypingTarget(e.target) || confirmState.open) return;
      const k = e.key;
      if (k === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (tab !== 'all') return;
      if (k === 'j' || k === 'J' || k === 'k' || k === 'K') {
        if (orderedIds.length === 0) return;
        e.preventDefault();
        const cur = orderedIds.indexOf(selectedId);
        const down = k === 'j' || k === 'J';
        const idx = cur < 0 ? (down ? 0 : orderedIds.length - 1) : Math.min(orderedIds.length - 1, Math.max(0, cur + (down ? 1 : -1)));
        const id = orderedIds[idx];
        setSelectedId(id);
        requestAnimationFrame(() => {
          document.querySelector(`[data-sid="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
        });
      } else if (k === 'Enter') {
        // 焦点在按钮 / 链接上时，让它自己处理 Enter
        const tag = e.target?.tagName;
        if (tag === 'BUTTON' || tag === 'A' || !selectedId) return;
        e.preventDefault();
        openStudentById(selectedId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, activeView, tab, orderedIds, selectedId, confirmState.open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 列表 / 卡片共用的行内操作与编辑状态
  const rowActions = {
    isAdmin,
    connections,
    statusMeta,
    deleteBusyId,
    editingAliasId, editingAliasValue, setEditingAliasId, setEditingAliasValue, saveStudentAlias,
    editingSchoolId, editingSchoolValue, setEditingSchoolId, setEditingSchoolValue, saveSchoolName,
    sendInvite, withdrawInvite, disconnectStudent, deleteStudent,
    mentorNameOf,
    onOpen: openStudentById,
  };

  if (!user) {
    return (
      <div className="mentor-page" style={{ padding: 40, fontSize: 14, color: '#475569' }}>
        正在加载…（请确认你是以老师账号登录）
      </div>
    );
  }

  if (!isMobile) {
    return (
      <>
      <MentorLayout activeView={activeView} onViewChange={setActiveView}>
        <div className="mentor-desktop-content">
          {!deployCheck.ok && (
            <motion.div 
              className="mentor-alert mentor-alert-error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <strong>邀请系统未就绪</strong>
              <div>{deployCheck.message}</div>
            </motion.div>
          )}

          {activeView === 'students' && (
            <motion.div
              className="mentor-students-page"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {/* 页内标签：今天 / 全部学生；右侧是共用的顾问筛选和搜索 */}
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
                borderBottom: '1px solid rgba(15, 23, 42, 0.08)', marginBottom: 16,
              }}>
                <div role="tablist" aria-label="学生管理标签" style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'today'}
                    onClick={() => goTab('today')}
                    style={{
                      ...TAB_BTN,
                      fontWeight: tab === 'today' ? 600 : 500,
                      color: tab === 'today' ? '#1C1C1E' : '#6E6E73',
                      borderBottom: tab === 'today' ? '2px solid #1C1C1E' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    今天
                    {openDrafts.length > 0 && (
                      <span style={{ marginLeft: 5, fontSize: 12, color: '#6E6E73' }}>{openDrafts.length}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'all'}
                    onClick={() => goTab('all')}
                    style={{
                      ...TAB_BTN,
                      fontWeight: tab === 'all' ? 600 : 500,
                      color: tab === 'all' ? '#1C1C1E' : '#6E6E73',
                      borderBottom: tab === 'all' ? '2px solid #1C1C1E' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    全部学生
                    <span style={{ marginLeft: 5, fontSize: 12, color: '#6E6E73' }}>{students.length}</span>
                  </button>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingBottom: 8 }}>
                  <label className="mt-sel">
                    <span>顾问</span>
                    <select value={filterConsultant} onChange={(e) => setFilterConsultant(e.target.value)}>
                      <option value="all">全部</option>
                      {consultantOptions.map((g) => (
                        <option key={consultantKey(g.consultant)} value={consultantKey(g.consultant)}>
                          {g.consultant || '未分配'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mentor-search-field mt-search">
                    <Search className="mentor-search-icon" aria-hidden="true" />
                    <input
                      ref={searchRef}
                      type="text"
                      placeholder="搜索学生、备注、学校"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
                      className="mentor-search-input"
                    />
                    <kbd className="mt-kbd" aria-hidden="true">/</kbd>
                  </div>
                </div>
              </div>

              {tab === 'today' ? (
                <>
                  <header style={{ margin: '8px 2px 20px' }}>
                    <div style={{ fontSize: 12.5, color: '#6E6E73' }}>{todayDateLine}</div>
                    <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1C1C1E', margin: '5px 0 6px' }}>
                      {dr.status === 'loading'
                        ? '正在加载今天的消息…'
                        : openDrafts.length > 0
                          ? `今天有 ${openDrafts.length} 条消息要发`
                          : '今天的消息都处理完了'}
                    </h1>
                    <p style={{ fontSize: 13.5, color: '#48484A', lineHeight: 1.65, margin: 0 }}>
                      {dr.status === 'loading'
                        ? '稍等，正在整理学生昨天的记录。'
                        : openDrafts.length > 0
                          ? `${praiseCount} 条表扬，${reminderCount} 条提醒。都是根据学生自己的记录写的，复制后去微信发，看着不对就改一下。`
                          : `今天发了 ${sentTodayCount} 条。下面是这周的填写情况。`}
                    </p>
                  </header>

                  <MessageQueue
                    drafts={dr.drafts}
                    persons={personOf}
                    dr={dr}
                    todayIso={todayIso}
                    showMentor={isAdmin}
                    onOpenStudent={openStudentById}
                  />

                  <WeekBoard
                    rows={todayRows}
                    showMentor={isAdmin}
                    onOpenStudent={openStudentById}
                    onJumpToDraft={jumpToDraft}
                  />
                  <a
                    href="/mentor?tab=all"
                    onClick={(e) => { e.preventDefault(); goTab('all'); }}
                    style={{
                      display: 'inline-block', marginTop: 14, fontSize: 13, color: '#6E6E73',
                      textDecoration: 'underline', textDecorationColor: '#C7C7CC', textUnderlineOffset: 3,
                    }}
                  >
                    邀请学生、看未连接的学生 → 全部学生
                  </a>
                </>
              ) : (
                <>
                  <div className="mt-filterbar">
                    <label className="mt-sel">
                      <span>学校</span>
                      <select value={filterSchool} onChange={(e) => setFilterSchool(e.target.value)}>
                        <option value="all">全部</option>
                        {schools.map((school) => (
                          <option key={school} value={school}>{school}</option>
                        ))}
                      </select>
                    </label>
                    <label className="mt-sel">
                      <span>连接</span>
                      <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                        <option value="all">全部</option>
                        <option value="connected">已连接</option>
                        <option value="invited">邀请中</option>
                        <option value="rejected">已拒绝</option>
                        <option value="uninvited">未邀请</option>
                      </select>
                    </label>
                    <div className="mt-switch" role="group" aria-label="显示方式">
                      <button
                        type="button"
                        className={viewMode === 'list' ? 'is-active' : ''}
                        aria-pressed={viewMode === 'list'}
                        onClick={() => switchViewMode('list')}
                      >列表</button>
                      <button
                        type="button"
                        className={viewMode === 'cards' ? 'is-active' : ''}
                        aria-pressed={viewMode === 'cards'}
                        onClick={() => switchViewMode('cards')}
                      >卡片</button>
                    </div>
                  </div>

              {viewMode === 'list' ? (
                <StudentTable
                  groups={displayGroups}
                  infoOf={infoOf}
                  selectedId={selectedId}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={toggleGroup}
                  actions={rowActions}
                />
              ) : (
                <StudentCards
                  groups={displayGroups}
                  infoOf={infoOf}
                  selectedId={selectedId}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={toggleGroup}
                  actions={rowActions}
                  inactiveByStudent={classStats.inactiveByStudent}
                />
              )}

              {displayGroups.length === 0 && (
                <div className="mentor-empty-state" style={{ padding: '56px 20px' }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--mentor-color-text-secondary)' }}>
                    未找到匹配的学生
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--mentor-color-text-tertiary)', marginTop: 4 }}>
                    调整搜索关键词或筛选条件后重试
                  </div>
                </div>
              )}

              <div className="mt-hints">
                <span><kbd>J</kbd><kbd>K</kbd> 上下移动</span>
                <span><kbd>Enter</kbd> 打开学生</span>
                <span><kbd>/</kbd> 搜索</span>
                <span className="mt-hints-note">首月 = 注册 30 天内，每天看；之后每周看</span>
              </div>
                </>
              )}
            </motion.div>
          )}

          {activeView === 'analytics' && (
            <motion.div
              className="mentor-analytics-page"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {/* Student selector */}
              <div className="mentor-analytics-picker" style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
                padding: '12px 16px', borderRadius: 12,
                background: 'var(--mentor-color-surface)',
                border: '1px solid var(--mentor-color-border)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                  选择学生
                </span>
                <select
                  value={picked?.id || ''}
                  onChange={(e) => pickStudent(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--mentor-color-border)',
                    background: 'var(--mentor-color-surface-secondary)',
                    fontSize: 13, color: 'var(--mentor-color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">— 请选择学生 —</option>
                  {students.map(s => {
                    const conn = connections[s.id];
                    const status = conn?.status ?? -1;
                    if (!isAdmin && status !== 1) return null;
                    return (
                      <option key={s.id} value={s.id}>
                        {s.full_name || '(未命名)'} {s.school_name ? `· ${s.school_name}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {picked ? (
                <>
                  <div style={{ marginBottom: 24 }}>
                    <StudentMessagesPanel
                      student={picked}
                      person={personOf(picked.id)}
                      draft={draftByStudent[picked.id]?.status === 'draft' ? draftByStudent[picked.id] : null}
                      dr={dr}
                      todayIso={todayIso}
                      showMentor={isAdmin}
                    />
                  </div>
                  {sessions.length > 0 ? (
                    <>
                    {sessionsTruncated && (
                      <div style={{ fontSize: 12, color: '#b45309', marginBottom: 10 }}>
                        该学生记录较多，这里只显示最近 2000 条，更早的记录未纳入统计。
                      </div>
                    )}
                    <WeekReviewDashboard sessions={sessions} student={picked} />

                      {/* ── 成绩概览：数据分析最底部 ── */}
                      <div style={{ marginTop: 24 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 10,
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          <span style={{
                            width: 3, height: 14, background: '#4F46E5', borderRadius: 2,
                            display: 'inline-block',
                          }} />
                          校内课程成绩概览
                        </div>
                        {studentScoresLoading ? (
                          <div style={{
                            textAlign: 'center', padding: '32px 0',
                            color: '#94a3b8', fontSize: 12,
                          }}>
                            加载中…
                          </div>
                        ) : (() => {
                          // 按课程分组
                          const groups = {};
                          for (const s of studentScores) {
                            const name = s.course?.name || '未分类';
                            if (!groups[name]) groups[name] = [];
                            groups[name].push(s);
                          }
                          const courseNames = Object.keys(groups);
                          if (courseNames.length === 0) {
                            return (
                              <div style={{
                                textAlign: 'center', padding: '32px 16px',
                                fontSize: 12, color: '#94a3b8',
                                borderRadius: 12,
                                background: 'rgba(255,255,255,0.5)',
                                border: '1px solid rgba(148,163,184,0.2)',
                              }}>
                                该学生暂无校内课程考试成绩记录
                              </div>
                            );
                          }
                          return (
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                              gap: 10,
                            }}>
                              {courseNames.map(name => {
                                const list = (groups[name] || [])
                                  .sort((a, b) => {
                                    const da = String(a.exam_date || '');
                                    const db = String(b.exam_date || '');
                                    return db.localeCompare(da); // 日期倒序
                                  });
                                const top3 = list.slice(0, 3);
                                return (
                                  <div key={name} style={{
                                    padding: '14px 14px 12px',
                                    borderRadius: 12,
                                    background: 'rgba(255,255,255,0.6)',
                                    border: '1px solid rgba(148,163,184,0.25)',
                                  }}>
                                    <div style={{
                                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                      marginBottom: 10,
                                    }}>
                                      <div style={{
                                        fontSize: 14, fontWeight: 700, color: '#0f172a',
                                      }}>{name}</div>
                                      <span style={{
                                        fontSize: 11, fontWeight: 600,
                                        padding: '3px 8px', borderRadius: 999,
                                        background: 'rgba(15,23,42,0.05)',
                                        color: '#475569',
                                      }}>
                                        {list.length} 条记录
                                      </span>
                                    </div>
                                    {top3.length === 0 ? (
                                      <div style={{
                                        fontSize: 11, color: '#94a3b8', textAlign: 'center',
                                        padding: '10px 0',
                                      }}>暂无成绩记录</div>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {top3.map(s => {
                                          const dateStr = String(s.exam_date || '').slice(5); // MM-DD
                                          const parts = [];
                                          if (s.score != null) parts.push(`${s.score} 分`);
                                          if (s.grade_label) parts.push(s.grade_label);
                                          const result = parts.length ? parts.join(' · ') : '—';
                                          return (
                                            <div key={s.id} style={{
                                              display: 'flex', alignItems: 'center',
                                              justifyContent: 'space-between',
                                              padding: '6px 8px',
                                              borderRadius: 8,
                                              background: 'rgba(15,23,42,0.02)',
                                              gap: 8,
                                            }}>
                                              <div style={{
                                                flex: 1, minWidth: 0, display: 'flex',
                                                alignItems: 'center', gap: 6, flexWrap: 'wrap',
                                              }}>
                                                <span style={{
                                                  fontSize: 12, fontWeight: 600, color: '#0f172a',
                                                }}>{s.exam_name}</span>
                                                <span style={{
                                                  fontSize: 10, color: '#94a3b8',
                                                  fontFamily: 'ui-monospace, monospace',
                                                }}>{dateStr}</span>
                                              </div>
                                              <div style={{
                                                fontSize: 12, fontWeight: 700, color: '#0f172a',
                                                fontFamily: 'ui-monospace, monospace',
                                                tabularNums: true,
                                                flexShrink: 0,
                                              }}>{result}</div>
                                            </div>
                                          );
                                        })}
                                        {list.length > 3 && (
                                          <div style={{
                                            fontSize: 10, color: '#94a3b8', textAlign: 'center',
                                            marginTop: 2,
                                          }}>
                                            另还有 {list.length - 3} 条历史记录
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    <div className="mentor-empty-state" style={{ padding: 40 }}>
                      <div>{busy ? '加载中…' : '该学生暂无学习记录'}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="mentor-empty-state" style={{ padding: 60 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                    请选择一位学生
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>
                    从上方下拉菜单选择已连接的学生，查看他们的周度学习复盘报告
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeView === 'syllabus' && (
            <motion.div
              className="mentor-syllabus-page"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {/* 学生选择器 */}
              <div className="mentor-analytics-picker" style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
                padding: '12px 16px', borderRadius: 12,
                background: 'var(--mentor-color-surface)',
                border: '1px solid var(--mentor-color-border)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                  选择学生
                </span>
                <select
                  value={picked?.id || ''}
                  onChange={(e) => pickStudent(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--mentor-color-border)',
                    background: 'var(--mentor-color-surface-secondary)',
                    fontSize: 13, color: 'var(--mentor-color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">— 请选择学生 —</option>
                  {students.map(s => {
                    const conn = connections[s.id];
                    const status = conn?.status ?? -1;
                    if (!isAdmin && status !== 1) return null;
                    return (
                      <option key={s.id} value={s.id}>
                        {s.full_name || '(未命名)'} {s.school_name ? `· ${s.school_name}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {picked ? (
                syllabusLoading ? (
                  <div className="mentor-empty-state" style={{ padding: 40 }}>
                    <div>加载中…</div>
                  </div>
                ) : syllabusCourses.length > 0 ? (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: 16,
                  }}>
                    {syllabusCourses.map(course => (
                      <motion.div
                        key={course.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          background: '#fff',
                          borderRadius: 16,
                          border: '1px solid rgba(15,23,42,0.06)',
                          overflow: 'hidden',
                        }}
                      >
                        {/* 课程头部 */}
                        <div style={{
                          padding: '16px 18px',
                          borderBottom: '1px solid #f1f5f9',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                              {course.name}
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                              {course.subject || '未分类学科'}
                              {course.source ? ` · ${course.source}` : ''}
                            </div>
                          </div>
                          <div style={{
                            fontSize: 11, color: '#94a3b8',
                            background: '#f8fafc', padding: '3px 8px', borderRadius: 6,
                          }}>
                            {(course.chapters || []).length} 章
                          </div>
                        </div>

                        {/* 章节 + 单元列表 */}
                        <div style={{ padding: '8px 18px 16px' }}>
                          {(course.chapters || []).length === 0 ? (
                            <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
                              暂无章节
                            </div>
                          ) : (
                            course.chapters.map((ch, chi) => (
                              <div key={ch.id} style={{ marginBottom: chi === course.chapters.length - 1 ? 0 : 12 }}>
                                <div style={{
                                  fontSize: 13, fontWeight: 600, color: '#0f172a',
                                  padding: '6px 0',
                                  display: 'flex', alignItems: 'center', gap: 6,
                                }}>
                                  <span style={{
                                    width: 18, height: 18, borderRadius: 5,
                                    background: '#f1f5f9',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 10, fontWeight: 700, color: '#64748b',
                                    flexShrink: 0,
                                  }}>{chi + 1}</span>
                                  {ch.name}
                                </div>
                                {(ch.units || []).length > 0 && (
                                  <div style={{ paddingLeft: 24, paddingBottom: 4 }}>
                                    {ch.units.map(u => (
                                      <div key={u.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '3px 0',
                                      }}>
                                        <span style={{
                                          width: 4, height: 4, borderRadius: '50%',
                                          background: '#cbd5e1', flexShrink: 0,
                                        }} />
                                        <span style={{ fontSize: 12, color: '#64748b' }}>
                                          {u.name}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="mentor-empty-state" style={{ padding: 40 }}>
                    <div>该学生暂未创建课程</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                      学生可以在学生端的「课表」页面添加课程
                    </div>
                  </div>
                )
              ) : (
                <div className="mentor-empty-state" style={{ padding: 60 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                    请选择一位学生
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>
                    从上方下拉菜单选择已连接的学生，查看他们的课程大纲
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeView === 'settings' && (
            <motion.div
              className="mentor-settings-page"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <WorkspacePreference />
              <ProfileEditor
                mode="inline"
                forceSchool={false}
                onSaved={() => loadData(user.id)}
              />
            </motion.div>
          )}
        </div>
      </MentorLayout>
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />
      </>
    );
  }

  return (
    <div className="mentor-mobile">
      <header className="m-mentor-header">
        <div className="m-mentor-header__top">
          <h1 className="m-mentor-title">导师视图</h1>
        </div>
        <nav className="m-mentor-tabs">
          <button
            onClick={() => setActiveView('students')}
            className={`m-mentor-tab ${activeView === 'students' ? 'm-mentor-tab-active' : ''}`}
          >
            学生管理
          </button>
          <button
            onClick={() => setActiveView('analytics')}
            className={`m-mentor-tab ${activeView === 'analytics' ? 'm-mentor-tab-active' : ''}`}
          >
            数据分析
          </button>
          <button
            onClick={() => setActiveView('syllabus')}
            className={`m-mentor-tab ${activeView === 'syllabus' ? 'm-mentor-tab-active' : ''}`}
          >
            课表
          </button>
          <button
            onClick={() => setActiveView('settings')}
            className={`m-mentor-tab ${activeView === 'settings' ? 'm-mentor-tab-active' : ''}`}
          >
            设置
          </button>
        </nav>
      </header>

      {activeView === 'students' ? (
        <div className="m-mentor-content">
          {!deployCheck.ok && (
            <motion.div
              className="glass m-deploy-alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: '#7f1d1d' }}>邀请系统未就绪</div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#991b1b' }}>{deployCheck.message}</div>
            </motion.div>
          )}

          <div
            role="tablist"
            aria-label="学生管理标签"
            style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(15, 23, 42, 0.08)', marginBottom: 12 }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'today'}
              onClick={() => goTab('today')}
              style={{
                ...TAB_BTN,
                padding: '9px 10px 10px',
                fontWeight: tab === 'today' ? 600 : 500,
                color: tab === 'today' ? '#1C1C1E' : '#6E6E73',
                borderBottom: tab === 'today' ? '2px solid #1C1C1E' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              今天
              {openDrafts.length > 0 && (
                <span style={{ marginLeft: 5, fontSize: 12, color: '#6E6E73' }}>{openDrafts.length}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'all'}
              onClick={() => goTab('all')}
              style={{
                ...TAB_BTN,
                padding: '9px 10px 10px',
                fontWeight: tab === 'all' ? 600 : 500,
                color: tab === 'all' ? '#1C1C1E' : '#6E6E73',
                borderBottom: tab === 'all' ? '2px solid #1C1C1E' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              全部学生
              <span style={{ marginLeft: 5, fontSize: 12, color: '#6E6E73' }}>{students.length}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="搜索学生…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="m-search-input"
              style={{ flex: 1 }}
            />
            <select
              value={filterConsultant}
              onChange={(e) => setFilterConsultant(e.target.value)}
              aria-label="顾问"
              style={{
                padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(15, 23, 42, 0.1)',
                background: '#fff', fontSize: 13, color: '#1C1C1E',
              }}
            >
              <option value="all">全部顾问</option>
              {consultantOptions.map((g) => (
                <option key={consultantKey(g.consultant)} value={consultantKey(g.consultant)}>
                  {g.consultant || '未分配'}
                </option>
              ))}
            </select>
          </div>

          {tab === 'today' ? (
            <>
              <header style={{ margin: '4px 2px 18px' }}>
                <div style={{ fontSize: 12.5, color: '#6E6E73' }}>{todayDateLine}</div>
                <h1 style={{ fontSize: 20, fontWeight: 600, color: '#1C1C1E', margin: '5px 0 6px' }}>
                  {dr.status === 'loading'
                    ? '正在加载今天的消息…'
                    : openDrafts.length > 0
                      ? `今天有 ${openDrafts.length} 条消息要发`
                      : '今天的消息都处理完了'}
                </h1>
                <p style={{ fontSize: 13, color: '#48484A', lineHeight: 1.65, margin: 0 }}>
                  {dr.status === 'loading'
                    ? '稍等，正在整理学生昨天的记录。'
                    : openDrafts.length > 0
                      ? `${praiseCount} 条表扬，${reminderCount} 条提醒。复制后去微信发，看着不对就改一下。`
                      : `今天发了 ${sentTodayCount} 条。下面是这周的填写情况。`}
                </p>
              </header>

              <MessageQueue
                drafts={dr.drafts}
                persons={personOf}
                dr={dr}
                todayIso={todayIso}
                showMentor={isAdmin}
                onOpenStudent={openStudentById}
              />
              <WeekBoard
                rows={todayRows}
                showMentor={isAdmin}
                onOpenStudent={openStudentById}
                onJumpToDraft={jumpToDraft}
              />
              <a
                href="/mentor?tab=all"
                onClick={(e) => { e.preventDefault(); goTab('all'); }}
                style={{
                  display: 'inline-block', marginTop: 14, fontSize: 13, color: '#6E6E73',
                  textDecoration: 'underline', textDecorationColor: '#C7C7CC', textUnderlineOffset: 3,
                }}
              >
                邀请学生、看未连接的学生 → 全部学生
              </a>
            </>
          ) : (
            <>
          <section className="m-filter-bar">
            <div className="m-filter-chips">
              {[
                { k: 'all', label: '全部' },
                { k: 'connected', label: '已连接' },
                { k: 'invited', label: '邀请中' },
                { k: 'rejected', label: '已拒绝' },
                { k: 'uninvited', label: '未邀请' },
              ].map((f) => (
                <button
                  key={f.k}
                  onClick={() => setFilterStatus(f.k)}
                  className={`m-filter-chip ${filterStatus === f.k ? 'm-filter-chip-active' : ''}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {schools.length > 0 && (
              <div className="m-filter-chips">
                <span className="m-filter-label">学校：</span>
                <button
                  onClick={() => setFilterSchool('all')}
                  className={`m-filter-chip ${filterSchool === 'all' ? 'm-filter-chip-active' : ''}`}
                >
                  全部学校
                </button>
                {schools.map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterSchool(s)}
                    className={`m-filter-chip ${filterSchool === s ? 'm-filter-chip-active' : ''}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="m-student-list">
            {consultantGroups.map((group) => (
              <div className="m-consultant-group" key={consultantKey(group.consultant)}>
                {showConsultantHeadings && (
                  <div className="m-consultant-heading">
                    <span className="m-consultant-dot" style={{ background: consultantColor(group.consultant) }} />
                    <span className="m-consultant-name">{group.consultant || '未分配'}</span>
                    <span className="m-consultant-count">{group.students.length}</span>
                  </div>
                )}
                {group.students.map((s) => {
                  const conn = connections[s.id];
                  const status = conn?.status ?? -1;
                  return (
                <motion.div
                  key={s.id}
                  className="glass m-student-card"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div
                    className="m-student-card__header"
                    style={{ cursor: 'pointer' }}
                    onClick={() => openStudentById(s.id)}
                  >
                    <div className="m-student-card__avatar">
                      {(s.full_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="m-student-card__info">
                      <div className="m-student-card__name">
                        <StudentLink id={s.id} onOpen={openStudentById}>{s.full_name || '(未命名)'}</StudentLink>
                      </div>
                      <div className="m-student-card__meta">
                        {s.school_name || '未设置学校'} · {s.created_at ? toLocalDateStr(new Date(s.created_at)) : ''}
                      </div>
                      {infoOf(s.id).connected && (
                        <div className="m-fill">
                          <StageTag info={infoOf(s.id)} />
                          <AttentionText info={infoOf(s.id)} />
                          <FillStrip summary={infoOf(s.id).summary} />
                        </div>
                      )}
                      {/* 首月学生的「昨天」说明已经覆盖了没填，不再重复「N 天未填写」 */}
                      {!infoOf(s.id).isNew && classStats.inactiveByStudent?.[s.id] && (
                        <div className="m-inactive">
                          <span className="m-inactive-dot" />
                          {formatInactivity(classStats.inactiveByStudent[s.id])}
                        </div>
                      )}
                    </div>
                    <span className={`m-status-pill m-status-pill--${status === 1 ? 'connected' : status === 0 ? 'invited' : status === 2 ? 'rejected' : 'uninvited'}`}>
                      {status === 1 ? '已连接' : status === 0 ? '邀请中' : status === 2 ? '已拒绝' : '未邀请'}
                    </span>
                  </div>

                  <div className="m-student-card__actions">
                    {isAdmin && (
                      <button
                        className="m-action-btn m-action-btn--primary"
                        onClick={() => openStudentById(s.id)}
                      >
                        查看数据
                      </button>
                    )}
                    {!isAdmin && status === 1 && (
                      <>
                        <button
                          className="m-action-btn m-action-btn--primary"
                          onClick={() => openStudentById(s.id)}
                        >
                          查看数据
                        </button>
                        <button
                          className="m-action-btn m-action-btn--danger"
                          onClick={() => disconnectStudent(s.id)}
                        >
                          断开
                        </button>
                      </>
                    )}
                    {!isAdmin && status === 0 && (
                      <>
                        <button className="m-action-btn" onClick={() => withdrawInvite(s.id)}>
                          撤回邀请
                        </button>
                        <button
                          className="m-action-btn m-action-btn--primary"
                          onClick={() => sendInvite(s.id)}
                        >
                          重发
                        </button>
                      </>
                    )}
                    {!isAdmin && status === 2 && (
                      <button
                        className="m-action-btn m-action-btn--primary"
                        onClick={() => sendInvite(s.id)}
                      >
                        再次邀请
                      </button>
                    )}
                    {!isAdmin && status === -1 && (
                      <button
                        className="m-action-btn m-action-btn--primary"
                        onClick={() => sendInvite(s.id)}
                      >
                        发送邀请
                      </button>
                    )}
                    <button
                      className="m-action-btn m-action-btn--ghost"
                      onClick={() => {
                        setEditingSchoolId(s.id);
                        setEditingSchoolValue(s.school_name || '');
                      }}
                    >
                      编辑学校
                    </button>
                  </div>

                  {editingSchoolId === s.id && (
                    <motion.div
                      className="m-school-edit"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <input
                        type="text"
                        placeholder="输入学校名称"
                        value={editingSchoolValue}
                        onChange={(e) => setEditingSchoolValue(e.target.value)}
                        className="m-school-input"
                      />
                      <div className="m-school-edit__actions">
                        <button
                          className="m-action-btn"
                          onClick={() => { setEditingSchoolId(null); setEditingSchoolValue(''); }}
                        >
                          取消
                        </button>
                        <button
                          className="m-action-btn m-action-btn--primary"
                          onClick={() => { saveSchoolName(s.id, editingSchoolValue); setEditingSchoolId(null); }}
                        >
                          保存
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {!isAdmin && status === -1 && editingSchoolId !== s.id && (
                    <div className="m-invite-form">
                      <textarea
                        placeholder="邀请备注（选填）"
                        value={inviteNotes[s.id] || ''}
                        onChange={(e) => setInviteNotes({ ...inviteNotes, [s.id]: e.target.value })}
                        className="m-invite-note"
                        rows={2}
                      />
                      <button
                        className="m-action-btn m-action-btn--primary"
                        onClick={() => sendInvite(s.id)}
                      >
                        发送邀请
                      </button>
                    </div>
                  )}
                </motion.div>
                  );
                })}
              </div>
            ))}
            {filteredStudents.length === 0 && (
              <div className="m-empty-state">
                <div className="m-empty-state__text">暂无学生</div>
              </div>
            )}
          </div>
            </>
          )}
        </div>
      ) : activeView === 'analytics' ? (
        <div className="m-mentor-content">
          <section className="glass m-analytics-summary" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>选择学生</span>
              <select
                value={picked?.id || ''}
                onChange={(e) => pickStudent(e.target.value)}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 6,
                  border: '1px solid var(--mentor-color-border)',
                  background: 'var(--mentor-color-surface-secondary)',
                  fontSize: 12, color: 'var(--mentor-color-text-primary)',
                }}
              >
                <option value="">— 请选择 —</option>
                {students.map(s => {
                  const conn = connections[s.id];
                  const status = conn?.status ?? -1;
                  if (!isAdmin && status !== 1) return null;
                  return (
                    <option key={s.id} value={s.id}>
                      {s.full_name || '(未命名)'}
                    </option>
                  );
                })}
              </select>
            </div>
          </section>
          {picked ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <StudentMessagesPanel
                  student={picked}
                  person={personOf(picked.id)}
                  draft={draftByStudent[picked.id]?.status === 'draft' ? draftByStudent[picked.id] : null}
                  dr={dr}
                  todayIso={todayIso}
                  showMentor={isAdmin}
                />
              </div>
              {sessions.length > 0 ? (
                <>
                  {sessionsTruncated && (
                    <div className="m-empty-state__text" style={{ color: '#b45309', marginBottom: 8 }}>
                      记录较多，只显示最近 2000 条。
                    </div>
                  )}
                  <WeekReviewDashboard sessions={sessions} student={picked} />
                </>
              ) : (
                <div className="m-empty-state">
                  <div className="m-empty-state__text">{busy ? '加载中…' : '该学生暂无学习记录'}</div>
                </div>
              )}
            </>
          ) : (
            <div className="m-empty-state">
              <div className="m-empty-state__text">请选择一位学生</div>
            </div>
          )}
        </div>
      ) : activeView === 'syllabus' ? (
        <div className="m-mentor-content">
          {/* 学生选择器 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
            padding: '10px 14px', borderRadius: 12,
            background: '#fff', border: '1px solid rgba(15,23,42,0.06)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', flexShrink: 0 }}>
              学生
            </span>
            <select
              value={picked?.id || ''}
              onChange={(e) => pickStudent(e.target.value)}
              style={{
                flex: 1, padding: '6px 10px', borderRadius: 8,
                border: '1px solid #e2e8f0', background: '#fff',
                fontSize: 13, color: '#0f172a',
              }}
            >
              <option value="">— 请选择 —</option>
              {students.map(s => {
                const conn = connections[s.id];
                const status = conn?.status ?? -1;
                if (!isAdmin && status !== 1) return null;
                return (
                  <option key={s.id} value={s.id}>
                    {s.full_name || '(未命名)'}
                  </option>
                );
              })}
            </select>
          </div>

          {picked ? (
            syllabusLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
                加载中…
              </div>
            ) : syllabusCourses.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {syllabusCourses.map(course => (
                  <div key={course.id} style={{
                    background: '#fff', borderRadius: 14,
                    border: '1px solid rgba(15,23,42,0.06)', overflow: 'hidden',
                  }}>
                    <div style={{
                      padding: '14px 16px',
                      borderBottom: '1px solid #f1f5f9',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                          {course.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {course.subject || '未分类'}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11, color: '#94a3b8',
                        background: '#f8fafc', padding: '3px 8px', borderRadius: 6,
                      }}>
                        {(course.chapters || []).length} 章
                      </span>
                    </div>
                    <div style={{ padding: '6px 16px 12px' }}>
                      {(course.chapters || []).length === 0 ? (
                        <div style={{ fontSize: 12, color: '#94a3b8', padding: '6px 0' }}>
                          暂无章节
                        </div>
                      ) : (
                        course.chapters.map((ch, chi) => (
                          <div key={ch.id} style={{ marginBottom: 8 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 600, color: '#0f172a',
                              padding: '5px 0', display: 'flex', alignItems: 'center', gap: 6,
                            }}>
                              <span style={{
                                width: 18, height: 18, borderRadius: 5,
                                background: '#f1f5f9',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 700, color: '#64748b', flexShrink: 0,
                              }}>{chi + 1}</span>
                              {ch.name}
                            </div>
                            {ch.units && ch.units.length > 0 && (
                              <div style={{ paddingLeft: 24, paddingBottom: 2 }}>
                                {ch.units.map(u => (
                                  <div key={u.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '2px 0',
                                  }}>
                                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#cbd5e1', flexShrink: 0 }} />
                                    <span style={{ fontSize: 12, color: '#64748b' }}>{u.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                <div style={{ fontSize: 13 }}>该学生暂未创建课程</div>
              </div>
            )
          ) : (
            <div className="m-empty-state">
              <div className="m-empty-state__text">请选择一位学生</div>
            </div>
          )}
        </div>
      ) : activeView === 'settings' ? (
        <div className="m-mentor-content">
          <section className="glass" style={{ padding: 20 }}>
            <ProfileEditor
              mode="inline"
              forceSchool={false}
              onSaved={() => loadData(user.id)}
            />
          </section>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}