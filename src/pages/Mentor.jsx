import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';
import { supabase, timeoutSignal } from '../lib/supabase.js';
import { updateWorkspace } from '../lib/e4Store.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import MentorLayout from '../components/MentorLayout.jsx';
import ProfileEditor from '../components/ProfileEditor.jsx';
import WorkspacePreference from '../components/WorkspacePreference.jsx';
import WeekReviewDashboard from '../components/WeekReviewDashboard.jsx';
import { AnimatedNumber, Skeleton } from '../components/animations';
import { subjectColor } from '../components/DeepDivePanels.jsx';
import { scoreToGrade, scoreColor } from '../components/WeekGrid.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Card } from '../components/ui/card.jsx';
import { Sheet, SheetContent, SheetHeader } from '../components/ui/sheet.jsx';
import { consultantColor, consultantKey, groupByConsultant, parseConsultant } from '../utils/consultant.js';
import { evaluateInactivity, formatInactivity } from '../utils/inactivity.js';
import { toLocalDateStr } from '../lib/date.js';
import { useAuth } from '../lib/useAuth.js';

function fmtMinutes(mins) {
  if (!mins) return '0 分钟';
  if (mins < 60) return mins + ' 分钟';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}min` : `${h} 小时`;
}

const STATUS_META = {
  1: { key: 'connected', label: '已连接' },
  0: { key: 'invited', label: '邀请中' },
  2: { key: 'rejected', label: '已拒绝' },
  '-1': { key: 'uninvited', label: '未邀请' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META['-1'];
}

export default function Mentor() {
  const nav = useNavigate();
  // 角色与账号信息统一来自 useAuth（数据库 profile 为权威来源），
  // 不在本页重复实现认证，避免与 ProtectedRoute 逻辑漂移（MEN-2）
  const { user: authUser, profile: authProfile, loading: authLoading } = useAuth();
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const bootstrappedRef = useRef(false);
  const [students, setStudents] = useState([]);
  const [connections, setConnections] = useState([]);
  const [picked, setPicked] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionsTruncated, setSessionsTruncated] = useState(false); // 命中 2000 条上限时提示
  const [busy, setBusy] = useState(false);
  const [deployCheck, setDeployCheck] = useState({ ok: true, message: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSchool, setFilterSchool] = useState('all');
  const [filterConsultant, setFilterConsultant] = useState('all'); // 顾问筛选：'all' | consultantKey
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set()); // 折叠的顾问分区
  const [activeView, setActiveView] = useState('students');
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
  // 确认对话框状态（替代原生 confirm()）
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', confirmLabel: '确认', variant: 'danger', onConfirm: null });

  // 按提交时间（created_at）排序的记录——学生补填旧日期记录时，
  // 按 session_date 排序的列表会把它埋进历史里，老师端"最近记录"永远看不到。
  // 这里单独维护一份按提交时间倒序的副本，供「最新提交」类列表使用。
  const recentSubmitted = useMemo(
    () => [...sessions].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [sessions],
  );

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

    const [pRes, cRes, sRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, role, full_name, school_name, created_at')
        .in('role', [1])
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('teacher_student_connections')
        .select('id, student_id, status, note, mentor_alias, created_at, updated_at')
        .eq('teacher_id', teacherId),
      supabase
        .from('profiles')
        .select('school_name')
        .in('role', [1])
        .not('school_name', 'is', null)
        .not('school_name', 'eq', ''),
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
    const map = {};
    for (const c of (cRes.data || [])) map[c.student_id] = c;

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
            map[s.id] = { student_id: s.id, status: 1, note: 'auto-admin' };
          }
        } else {
          // 插入失败时退回虚拟连接，保证前端仍可显示学生列表。
          // 注意：虚拟连接不满足 learning_sessions 的 RLS（需要真实 status=1 连接行），
          // 这些学生的记录会读不到——必须显式告警，不能静默。
          for (const s of needConnect) {
            map[s.id] = { student_id: s.id, status: 1, note: 'admin', virtual: true };
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

    if (targetStudents.length === 0) {
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
  }

  const pickedIdRef = useRef(null);

  async function fetchPickedSessions(studentId, { silent = false } = {}) {
    if (!silent) setBusy(true);
    const { data, error } = await supabase
      .from('learning_sessions')
      .select(`
        id, session_date, start_time, duration_minutes, category, form, eval_type,
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
    const note = inviteNotes[studentId] || '';
    setInviteBusyId(studentId);
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .insert({ teacher_id: user.id, student_id: studentId, status: 0, note });
      if (error) throw error;
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
      } else {
        toast(`邀请失败（${code || 'error'}: ${msg || '未知错误'}）`, { kind: 'error' });
      }
    } finally {
      setInviteBusyId(null);
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
      const { error } = await supabase
        .from('teacher_student_connections')
        .update({ status: 2, updated_at: new Date().toISOString() })
        .match({ teacher_id: user.id, student_id: studentId });
      if (error) throw error;
      setConnections((m) => ({ ...m, [studentId]: { ...c, status: 2, updated_at: new Date().toISOString() } }));
      if (picked?.id === studentId) setPicked(null);
      toast('已断开连接', { kind: 'success' });
    } catch (err) {
      logger.error('disconnectStudent failed:', err);
      toast(`断开失败`, { kind: 'error' });
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
      if (picked?.id === studentId) setPicked(null);
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

  const stats = useMemo(() => {
    const invited = Object.values(connections).filter((c) => c.status === 0).length;
    const connected = Object.values(connections).filter((c) => c.status === 1).length;
    const rejected = Object.values(connections).filter((c) => c.status === 2).length;
    return { total: students.length, invited, connected, rejected };
  }, [students, connections]);

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const name = s.full_name || '';
      const alias = connections[s.id]?.mentor_alias || '';
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        name.toLowerCase().includes(q) || alias.toLowerCase().includes(q);

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

  const overviewItems = useMemo(() => ([
    { label: '学生总数', value: String(stats.total) },
    { label: '顾问', value: String(consultantCount) },
    { label: '已连接', value: String(stats.connected) },
    { label: '本周活跃', value: String(classStats.activeStudents || 0) },
    { label: '本周日均', value: fmtMinutes(classStats.avgDailyMinutes || 0) },
    { label: '未填写', value: String(classStats.inactiveCount || 0) },
  ]), [stats, consultantCount, classStats]);

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
              <motion.div 
                className="mentor-page-header"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div>
                  <h1 className="mentor-page-title">学生管理</h1>
                  <p className="mentor-page-subtitle">管理你的学生连接和查看学习数据</p>
                </div>
              </motion.div>

              {/* 概览条：复用 stats / classStats，零新增请求 */}
              <motion.div
                className="mentor-overview-bar"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05, duration: 0.3 }}
              >
                {overviewItems.map((item) => (
                  <div key={item.label} className="mentor-overview-block">
                    <div className="mentor-overview-value">{item.value}</div>
                    <div className="mentor-overview-label">{item.label}</div>
                  </div>
                ))}
              </motion.div>

              {/* 工具栏：搜索 + 学校/状态筛选 + 顾问筛选 chip */}
              <motion.div
                className="mentor-toolbar"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.3 }}
              >
                <div className="mentor-toolbar-row">
                  <div className="mentor-search-field">
                    <Search className="mentor-search-icon" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder="搜索学生…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="mentor-search-input"
                    />
                  </div>
                  <select
                    className="mentor-select"
                    value={filterSchool}
                    onChange={(e) => setFilterSchool(e.target.value)}
                  >
                    <option value="all">所有学校</option>
                    {schools.map((school) => (
                      <option key={school} value={school}>{school}</option>
                    ))}
                  </select>
                  <select
                    className="mentor-select"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="all">全部状态</option>
                    <option value="connected">已连接</option>
                    <option value="invited">邀请中</option>
                    <option value="rejected">已拒绝</option>
                    <option value="uninvited">未邀请</option>
                  </select>
                </div>

                <div className="mentor-chip-row">
                  <button
                    type="button"
                    className={`mentor-chip ${filterConsultant === 'all' ? 'mentor-chip--active' : ''}`}
                    onClick={() => setFilterConsultant('all')}
                  >
                    <span className="mentor-chip-dot" style={{ background: 'var(--mentor-color-text-muted)' }} />
                    全部
                    <span className="mentor-chip-count">{filteredStudents.length}</span>
                  </button>
                  {consultantGroups.map((g) => {
                    const key = consultantKey(g.consultant);
                    const active = filterConsultant === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`mentor-chip ${active ? 'mentor-chip--active' : ''}`}
                        onClick={() => setFilterConsultant(active ? 'all' : key)}
                      >
                        <span className="mentor-chip-dot" style={{ background: consultantColor(g.consultant) }} />
                        {g.consultant || '未分配'}
                        <span className="mentor-chip-count">{g.students.length}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>

              {/* 顾问分区：每人一组，组内卡片网格 */}
              <div className="mentor-groups">

                {visibleGroups.map((group) => {
                  const groupKey = consultantKey(group.consultant);
                  const collapsed = collapsedGroups.has(groupKey);
                  const groupColor = consultantColor(group.consultant);
                  return (
                    <section key={groupKey} className="mentor-group">
                      <header className="mentor-group-header">
                        <button
                          type="button"
                          className="mentor-group-toggle"
                          onClick={() => toggleGroup(groupKey)}
                          aria-expanded={!collapsed}
                        >
                          <span
                            className="mentor-group-monogram"
                            style={{ background: `${groupColor}14`, color: groupColor }}
                          >
                            {(group.consultant || '未').charAt(0).toUpperCase()}
                          </span>
                          <span className="mentor-group-name">{group.consultant || '未分配'}</span>
                          <ChevronDown className={`mentor-group-chevron ${collapsed ? 'is-collapsed' : ''}`} />
                        </button>
                        <Badge variant="secondary" className="mentor-group-count">
                          {group.students.length} 位学生
                        </Badge>
                      </header>
                      {!collapsed && (
                        <div className="mentor-group-grid">
                          {group.students.map((s) => {
                            const conn = connections[s.id];
                          const status = conn?.status ?? -1;
                          const alias = conn?.mentor_alias || '';
                          const isDeleting = deleteBusyId === s.id;
                          const isAliasEditing = editingAliasId === s.id;
                          const meta = statusMeta(status);
                          // 备注名括号里是顾问归属（区头已表达），卡片主标题只显示干净姓名
                          const { cleanName } = parseConsultant(alias);
                          const displayName = cleanName || alias || s.full_name || '(未命名)';
                          const avatarColor = consultantColor(group.consultant);
                          return (
                            <Card
                              key={s.id}
                              className="mentor-student-card group"
                              onClick={() => setPicked(s)}
                              style={{ opacity: isDeleting ? 0.55 : 1 }}
                            >
                              <div className="mentor-student-card__top">
                                <div
                                  className="mentor-student-avatar"
                                  style={{ background: `${avatarColor}14`, color: avatarColor }}
                                >
                                  {(displayName || '?').charAt(0).toUpperCase()}
                                </div>
                                <div className="mentor-student-card__id">
                                  <div className="mentor-student-card__name-row">
                                    <span className="mentor-student-card__name">{displayName}</span>
                                    {alias && <span className="mentor-student-card__tag">备注</span>}
                                  </div>
                                  <div className="mentor-student-card__meta">
                                    {alias && <span>本名：{s.full_name || '-'}</span>}
                                    <span>{s.school_name || '未设置学校'}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="mentor-student-card__foot">
                                <div className="mentor-student-card__left">
                                  <span className={`mentor-status mentor-status--${meta.key}`}>
                                    <span className="mentor-status-dot" />
                                    {meta.label}
                                  </span>
                                  {classStats.inactiveByStudent?.[s.id] && (
                                    <span className="mentor-inactive">
                                      <span className="mentor-inactive-dot" />
                                      {formatInactivity(classStats.inactiveByStudent[s.id])}
                                    </span>
                                  )}
                                </div>
                                <div className="mentor-student-card__actions">
                                  {!isAdmin && status === -1 && (
                                    <Button
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}
                                    >邀请</Button>
                                  )}
                                  {!isAdmin && status === 0 && (
                                    <>
                                      <Button
                                        size="sm" variant="outline"
                                        onClick={(e) => { e.stopPropagation(); withdrawInvite(s.id); }}
                                      >撤回</Button>
                                      <Button
                                        size="sm"
                                        onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}
                                      >重发</Button>
                                    </>
                                  )}
                                  {!isAdmin && status === 2 && (
                                    <Button
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}
                                    >再次邀请</Button>
                                  )}
                                  {!isAdmin && status === 1 && (
                                    <Button
                                      size="sm" variant="outline"
                                      onClick={(e) => { e.stopPropagation(); disconnectStudent(s.id); }}
                                    >断开</Button>
                                  )}
                                  {/* 备注名：status === 1（含 admin 自动连接）可编辑 */}
                                  {status === 1 && !isAliasEditing && (
                                    <Button
                                      size="sm" variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingAliasId(s.id);
                                        setEditingAliasValue(alias);
                                      }}
                                    >{alias ? '改备注' : '备注名'}</Button>
                                  )}
                                  {/* 永久删除：admin only */}
                                  {isAdmin && (
                                    <Button
                                      size="sm" variant="destructive"
                                      className="mentor-btn-delete"
                                      disabled={isDeleting}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isDeleting) return;
                                        deleteStudent(s.id);
                                      }}
                                    >{isDeleting ? '删除中…' : '删除'}</Button>
                                  )}
                                </div>
                              </div>

                              {isAliasEditing && (
                                <motion.div
                                  className="mentor-alias-editor"
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                >
                                  <input
                                    type="text"
                                    placeholder="输入备注名（留空清除）"
                                    value={editingAliasValue}
                                    onChange={(e) => setEditingAliasValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { e.preventDefault(); saveStudentAlias(s.id, editingAliasValue); }
                                      if (e.key === 'Escape') { setEditingAliasId(null); setEditingAliasValue(''); }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    autoFocus
                                    className="mentor-alias-input"
                                  />
                                  <div className="mentor-alias-actions">
                                    <Button
                                      size="sm" variant="ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingAliasId(null);
                                        setEditingAliasValue('');
                                      }}
                                    >取消</Button>
                                    <Button
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); saveStudentAlias(s.id, editingAliasValue); }}
                                    >保存</Button>
                                  </div>
                                </motion.div>
                              )}
                            </Card>
                          );
                        })}
                        </div>
                      )}
                    </section>
                  );
                })}

                  {visibleGroups.length === 0 && (
                    <div className="mentor-empty-state" style={{ padding: '56px 20px' }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--mentor-color-text-secondary)' }}>
                        未找到匹配的学生
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--mentor-color-text-tertiary)', marginTop: 4 }}>
                        调整搜索关键词或筛选条件后重试
                      </div>
                    </div>
                  )}
              </div>

              {/* 学生详情：右侧滑出 Sheet（替代原「320px 侧栏 + 详情」分栏） */}
              <Sheet open={!!picked} onOpenChange={(open) => { if (!open) setPicked(null); }}>
                {picked && (() => {
                  const alias = connections[picked.id]?.mentor_alias || '';
                  const { consultant, cleanName } = parseConsultant(alias);
                  const consultantTone = consultantColor(consultant);
                  const title = cleanName || alias || picked.full_name || '学生';
                  return (
                  <SheetContent onClose={() => setPicked(null)}>
                    <SheetHeader>
                      <div className="mentor-sheet-eyebrow">学习数据</div>
                      {editingAliasId === picked.id ? (
                        <div className="mentor-sheet-alias-edit">
                          <input
                            type="text"
                            placeholder="姓名(顾问)，如 Cathryn(Angela)"
                            value={editingAliasValue}
                            onChange={(e) => setEditingAliasValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); saveStudentAlias(picked.id, editingAliasValue); }
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setEditingAliasId(null);
                                setEditingAliasValue('');
                              }
                            }}
                            autoFocus
                            className="mentor-alias-input"
                          />
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => { setEditingAliasId(null); setEditingAliasValue(''); }}
                          >取消</Button>
                          <Button
                            size="sm"
                            onClick={() => saveStudentAlias(picked.id, editingAliasValue)}
                          >保存</Button>
                        </div>
                      ) : (
                        <>
                          <div className="mentor-sheet-title-row">
                            <h2 className="mentor-sheet-title">{title}</h2>
                            {alias && <span className="mentor-student-card__tag">备注</span>}
                            {consultant && (
                              <Badge
                                variant="outline"
                                className="mentor-sheet-consultant"
                                style={{ borderColor: `${consultantTone}40`, color: consultantTone }}
                              >
                                <span className="mentor-chip-dot" style={{ background: consultantTone }} />
                                {consultant}
                              </Badge>
                            )}
                            <Button
                              size="sm" variant="outline"
                              onClick={() => {
                                setEditingAliasId(picked.id);
                                setEditingAliasValue(alias);
                              }}
                            >{alias ? '改备注' : '备注名'}</Button>
                          </div>
                          {alias && picked.full_name && (
                            <div className="mentor-sheet-sub">本名：{picked.full_name}</div>
                          )}
                        </>
                      )}
                    </SheetHeader>
                    <div className="mentor-sheet-body">
                      {busy ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 40 }}>
                          <Skeleton height={20} width="40%" />
                          <Skeleton height={16} width="60%" />
                          <Skeleton height={16} width="40%" />
                        </div>
                      ) : (
                        <>
                          <div className="mentor-sheet-stats">
                            {[
                              { label: '学习记录', value: sessions.length, suffix: '条' },
                              { label: '累计时长', value: fmtMinutes(sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0)), suffix: '' },
                              { label: '活跃天数', value: new Set(sessions.map(s => s.date?.split('T')[0])).size, suffix: '天' },
                            ].map((stat) => (
                              <div key={stat.label} className="mentor-sheet-stat">
                                <div className="mentor-sheet-stat__value">{stat.value}{stat.suffix}</div>
                                <div className="mentor-sheet-stat__label">{stat.label}</div>
                              </div>
                            ))}
                          </div>

                          {sessions.length > 0 ? (
                            <>
                              <div className="mentor-sheet-note">
                                <div className="mentor-sheet-note__title">详细周度复盘请前往「数据分析」页</div>
                                <div className="mentor-sheet-note__sub">当前在学生管理页仅显示简要摘要</div>
                              </div>

                              <div className="mentor-sheet-section-label">最新提交（按提交时间，含补填）</div>
                              <div className="mentor-sheet-list">
                                {recentSubmitted.slice(0, 8).map((s, i) => {
                                  const isBackfill = s.created_at && s.date && toLocalDateStr(new Date(s.created_at)) !== s.date;
                                  return (
                                    <div key={i} className="mentor-sheet-row">
                                      <span className="mentor-sheet-row__subject">{s.subject}</span>
                                      <span className="mentor-sheet-row__date">{s.date}</span>
                                      {isBackfill && <span className="mentor-sheet-row__backfill">补填</span>}
                                      <span className="mentor-sheet-row__dur">{fmtMinutes(s.duration_minutes || 0)}</span>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="mentor-sheet-actions">
                                <Button
                                  className="mentor-sheet-action"
                                  onClick={() => setActiveView('analytics')}
                                >前往数据分析</Button>
                                <Button
                                  variant="outline"
                                  className="mentor-sheet-action"
                                  onClick={() => setActiveView('syllabus')}
                                >前往课表</Button>
                              </div>
                            </>
                          ) : (
                            <div className="mentor-sheet-empty">该学生暂无学习记录</div>
                          )}
                        </>
                      )}
                    </div>
                  </SheetContent>
                  );
                })()}
              </Sheet>
                  </motion.div>
          )}

          {activeView === 'analytics' && (
            <motion.div
              className="mentor-analytics-page"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="mentor-page-header"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <h1 className="mentor-page-title">数据分析</h1>
                <p className="mentor-page-subtitle">选择学生查看周度学习复盘</p>
              </motion.div>

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
                  onChange={(e) => {
                    const s = students.find(st => st.id === e.target.value);
                    setPicked(s || null);
                  }}
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
                sessions.length > 0 ? (
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
                  )
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
              <motion.div
                className="mentor-page-header"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <h1 className="mentor-page-title">课表</h1>
                <p className="mentor-page-subtitle">查看学生的课程大纲</p>
              </motion.div>

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
                  onChange={(e) => {
                    const s = students.find(st => st.id === e.target.value);
                    setPicked(s || null);
                  }}
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
              <div className="mentor-page-header">
                <h1 className="mentor-page-title">账号设置</h1>
                <p className="mentor-page-subtitle">管理你的导师账号资料</p>
              </div>
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

          <section className="glass m-mentor-stats-grid">
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#64748b' }}>{stats.total}</div>
              <div className="m-mentor-stat-label">学生总数</div>
            </div>
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#171717' }}>{stats.connected}</div>
              <div className="m-mentor-stat-label">已连接</div>
            </div>
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#8E8E93' }}>{stats.invited}</div>
              <div className="m-mentor-stat-label">邀请中</div>
            </div>
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#B91C1C' }}>{stats.rejected}</div>
              <div className="m-mentor-stat-label">被拒绝</div>
            </div>
          </section>

          {classStats.totalStudents > 0 && (
            <section className="glass m-mentor-class-stats">
              <div className="m-class-stat-item">
                <span className="m-class-stat-value">{classStats.totalStudents}</span>
                <span className="m-class-stat-label">已连接学生</span>
              </div>
              <div className="m-class-stat-divider" />
              <div className="m-class-stat-item">
                <span className="m-class-stat-value">{classStats.activeStudents || 0}</span>
                <span className="m-class-stat-label">本周活跃</span>
              </div>
              <div className="m-class-stat-divider" />
              <div className="m-class-stat-item">
                <span className="m-class-stat-value">{fmtMinutes(classStats.avgDailyMinutes || 0)}</span>
                <span className="m-class-stat-label">日均时长</span>
              </div>
              <div className="m-class-stat-divider" />
              <div className="m-class-stat-item">
                <span className="m-class-stat-value">{classStats.inactiveCount || 0}</span>
                <span className="m-class-stat-label">未填写</span>
              </div>
            </section>
          )}

          <section className="m-filter-bar">
            <div className="m-search-wrap">
              <input
                type="text"
                placeholder="搜索学生…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="m-search-input"
              />
            </div>
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
                  <div className="m-student-card__header">
                    <div className="m-student-card__avatar">
                      {(s.full_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="m-student-card__info">
                      <div className="m-student-card__name">{s.full_name || '(未命名)'}</div>
                      <div className="m-student-card__meta">
                        {s.school_name || '未设置学校'} · {s.created_at ? toLocalDateStr(new Date(s.created_at)) : ''}
                      </div>
                      {classStats.inactiveByStudent?.[s.id] && (
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
                        onClick={() => setPicked(s)}
                      >
                        查看数据
                      </button>
                    )}
                    {!isAdmin && status === 1 && (
                      <>
                        <button
                          className="m-action-btn m-action-btn--primary"
                          onClick={() => setPicked(s)}
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

          <AnimatePresence>
            {picked && (
              <motion.div
                className="m-detail-overlay"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 40 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              >
                <div className="m-detail-header">
                  <button
                    className="m-detail-close"
                    onClick={() => setPicked(null)}
                  >
                    ✕
                  </button>
                  <div className="m-detail-title">{picked.full_name || '学生'} 的学习数据</div>
                  <div className="m-detail-spacer" />
                </div>
                <div className="m-detail-body">
                  {(() => {
                    const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
                    const allDates = sessions.map(s => (s.date || '').split('T')[0]).filter(Boolean);
                    const uniqueDates = [...new Set(allDates)].sort();
                    const spanDays = uniqueDates.length > 0
                      ? Math.max(1, Math.round((new Date(uniqueDates[uniqueDates.length - 1]) - new Date(uniqueDates[0])) / 86400000) + 1)
                      : 1;
                    const dailyAvg = uniqueDates.length > 0 ? Math.round(totalMins / spanDays) : 0;
                    // 本周活跃
                    const today = new Date();
                    const dow = today.getDay();
                    const mon = new Date(today);
                    mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
                    const weekStartStr = toLocalDateStr(mon);
                    const weekActive = uniqueDates.filter(d => d >= weekStartStr).length;
                    // 学科分布
                    const bySubj = {};
                    for (const s of sessions) {
                      const n = (s.subject || '未分类').trim();
                      bySubj[n] = (bySubj[n] || 0) + (s.duration_minutes || 0);
                    }
                    const subjList = Object.entries(bySubj)
                      .map(([name, total]) => ({ name, total, pct: totalMins > 0 ? Math.round(total / totalMins * 100) : 0 }))
                      .sort((a, b) => b.total - a.total);
                    // 有评估的
                    const scored = sessions
                      .filter(s => Number(s.eval_type) === 2 && s.score != null && s.score !== '' && !Number.isNaN(Number(s.score)))
                      .slice(0, 5);
                    const fmtD = (iso) => { const p = (iso || '').split('T')[0].split('-'); return p.length >= 3 ? `${p[1]}/${p[2]}` : ''; };

                    return (
                      <>
                        {/* 4 stat grid */}
                        <section className="glass m-detail-stats">
                          <div className="m-detail-stat">
                            <div className="m-detail-stat__value">{sessions.length}</div>
                            <div className="m-detail-stat__label">学习记录</div>
                          </div>
                          <div className="m-detail-stat-divider" />
                          <div className="m-detail-stat">
                            <div className="m-detail-stat__value">{fmtMinutes(totalMins)}</div>
                            <div className="m-detail-stat__label">累计时长</div>
                          </div>
                          <div className="m-detail-stat-divider" />
                          <div className="m-detail-stat">
                            <div className="m-detail-stat__value">{fmtMinutes(dailyAvg)}</div>
                            <div className="m-detail-stat__label">日均</div>
                          </div>
                          <div className="m-detail-stat-divider" />
                          <div className="m-detail-stat">
                            <div className="m-detail-stat__value">{weekActive}<span style={{ fontSize: '0.6em', color: '#94a3b8' }}>/7</span></div>
                            <div className="m-detail-stat__label">本周活跃</div>
                          </div>
                        </section>

                        {busy ? (
                          <div className="m-loading">加载中…</div>
                        ) : sessions.length > 0 ? (
                          <div className="m-detail-dashboard">
                            {/* 学科分布 */}
                            {subjList.length > 0 && (
                              <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>学科分布</div>
                                {subjList.map((subj, i) => {
                                  const color = subjectColor(subj.name);
                                  return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                      <span style={{ fontSize: 12, fontWeight: 500, color: '#1e293b', minWidth: 50, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subj.name}</span>
                                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                                        <motion.div
                                          initial={{ width: 0 }}
                                          animate={{ width: `${subj.pct}%` }}
                                          transition={{ duration: 0.4, delay: 0.05 * i }}
                                          style={{ height: '100%', borderRadius: 3, background: color }}
                                        />
                                      </div>
                                      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace', minWidth: 40, textAlign: 'right' }}>{fmtMinutes(subj.total)}</span>
                                      <span style={{ fontSize: 10, color: '#94a3b8', minWidth: 28, textAlign: 'right' }}>{subj.pct}%</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* 最近评估 */}
                            {scored.length > 0 && (
                              <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>最近评估</div>
                                {scored.map((s, i) => {
                                  const grade = scoreToGrade(Number(s.score));
                                  const sColor = scoreColor(Number(s.score));
                                  const subjC = subjectColor((s.subject || '未分类').trim());
                                  return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < scored.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: subjC, flexShrink: 0 }} />
                                      <span style={{ fontSize: 12, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(s.subject || '未分类').trim()}</span>
                                      <span style={{ fontSize: 14, fontWeight: 700, color: sColor, fontFamily: 'ui-monospace, monospace' }}>{s.score}</span>
                                      {grade && <span style={{ fontSize: 11, fontWeight: 600, color: sColor, minWidth: 20 }}>{grade}</span>}
                                      <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', minWidth: 36, textAlign: 'right' }}>{fmtD(s.date)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* 最近活动（按提交时间，含补填） */}
                            <div style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>最新提交</div>
                              {recentSubmitted.slice(0, 3).map((s, i) => {
                                const subjC = subjectColor((s.subject || '未分类').trim());
                                const isBackfill = s.created_at && s.date && toLocalDateStr(new Date(s.created_at)) !== s.date;
                                return (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < 2 ? '1px solid #f1f5f9' : 'none' }}>
                                    <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', minWidth: 32 }}>{fmtD(s.date)}</span>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: subjC }} />
                                    <span style={{ fontSize: 12, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(s.subject || '未分类').trim()}</span>
                                    {isBackfill && (
                                      <span style={{
                                        fontSize: 9, fontWeight: 700, color: '#b45309',
                                        background: 'rgba(245,158,11,0.12)', borderRadius: 4,
                                        padding: '1px 5px', flexShrink: 0,
                                      }}>补填</span>
                                    )}
                                    <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>{fmtMinutes(s.duration_minutes || 0)}</span>
                                  </div>
                                );
                              })}
                            </div>

                            <button
                              onClick={() => { setActiveView('analytics'); setPicked(null); }}
                              style={{
                                width: '100%', padding: '10px',
                                borderRadius: 8, border: 'none',
                                background: 'var(--mentor-color-primary)', color: '#fff',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              前往深度分析 →
                            </button>
                          </div>
                        ) : (
                          <div className="m-empty-state">
                            <div className="m-empty-state__text">该学生暂无学习记录</div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : activeView === 'analytics' ? (
        <div className="m-mentor-content">
          <section className="glass m-analytics-summary" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>选择学生</span>
              <select
                value={picked?.id || ''}
                onChange={(e) => {
                  const s = students.find(st => st.id === e.target.value);
                  setPicked(s || null);
                }}
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
              sessions.length > 0 ? (
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
              )
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
              onChange={(e) => {
                const s = students.find(st => st.id === e.target.value);
                setPicked(s || null);
              }}
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