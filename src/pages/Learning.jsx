import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { SUBJECTIVE_STEPS } from '../lib/rating.js';
import { useAuth } from '../lib/useAuth.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import { loadOutbox, enqueueOutbox, removeFromOutbox } from '../lib/outbox.js';
import DatePicker from '../components/ui/date-picker.jsx';
import LogSheet, { Sheet } from '../components/student/LogSheet.jsx';
import GradeChips from '../components/student/GradeChips.jsx';
import {
  CATEGORY_OPTS, ALL_FORM_PRESET, GRADE_RANGES,
  validateSession, buildSessionPayload, applyPendingFilter, pendingGradePayload, recentCombos,
} from '../lib/sessionRules.js';

/* ---------- 常量定义 ---------- */

// 成绩 tab 预设等第（仅 letter grade A+ ~ F）
const GRADE_PRESET_CHIPS = [
  'A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F',
];

// 最近记录的查询列（含 course_id/chapter_id/unit_id：编辑回填与「再记一次」都要用）
const RECENT_SELECT = `
  id, session_date, start_time, end_time, duration_minutes,
  category, form, eval_type, self_rating, grade_label, notes,
  course_id, chapter_id, unit_id,
  course:courses(id,name,subject,course_type),
  chapter:chapters(id,name),
  unit:units(id,name)
`;
const RECENT_LIMIT = 30;

const TABS = [
  { key: 'record', label: '记录' },
  { key: 'pending', label: '待补填' },
  { key: 'scores', label: '成绩' },
];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const ds = toDateStr(d);
  if (ds === toDateStr(now)) return '今天';
  if (ds === toDateStr(yest)) return '昨天';
  return `${d.getMonth()+1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}
function fmtShortDate(iso) {
  if (!iso) return '';
  const day = fmtDay(iso);
  return day === '今天' || day === '昨天' ? day : day.split(' ')[0];
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const catLabel = (k) => CATEGORY_OPTS.find(c => c.key === k)?.label || '';
const subjLabel = (v) => SUBJECTIVE_STEPS.find(s => s.value === v)?.label || '-';
// 校内/校外用文字表达，不靠颜色区分
const whereLabel = (course) => (course?.course_type === 2 ? '校外' : '校内');
function coursePath(r) {
  const parts = [r.chapter?.name, r.unit?.name].filter(Boolean);
  return parts.length ? parts.join(' · ') : '未选章节';
}

/* ============ 页面主体 ============ */
export default function LearningPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  /* --- 课程与自定义形式 --- */
  const [courses, setCourses] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [customForms, setCustomForms] = useState([]); // string[]

  /* --- 记一笔 sheet --- */
  const [sheet, setSheet] = useState({ open: false, mode: 'new', preset: null, editRow: null });

  /* --- 提交状态 / 最近记录 --- */
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  // 保存失败的本机暂存队列（网络中断/会话失效时兜底，恢复后自动重试）
  const [outboxItems, setOutboxItems] = useState(() => loadOutbox());
  const [outboxRetrying, setOutboxRetrying] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  /* --- 顶部 tab：记录 / 待补填 / 成绩 --- */
  const [view, setView] = useState('record'); // 'record' | 'pending' | 'scores'
  const tabRefs = useRef([]);

  /* --- 待补填客观评价列表 --- */
  const [pending, setPending] = useState([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [pendingSavingId, setPendingSavingId] = useState(null);
  const [pendingDone, setPendingDone] = useState({}); // { [sessionId]: grade_label }
  const pendingReloadTimer = useRef(null);

  /* --- 成绩 Tab：校内课程 + 考试成绩 --- */
  const [scoreCourses, setScoreCourses] = useState([]);   // 校内课程列表 course_type=1
  const [examScores, setExamScores] = useState([]);      // 所有 exam_scores 记录
  const [loadingScores, setLoadingScores] = useState(false);
  // 新增/编辑成绩 sheet
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [scoreModalEditing, setScoreModalEditing] = useState(null);  // exam_score 对象或 null(新增)
  const [scoreModalCourseId, setScoreModalCourseId] = useState('');
  const [scoreForm, setScoreForm] = useState({ exam_name: '', exam_date: '', score: '', grade_label: '', notes: '' });
  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreDeletingId, setScoreDeletingId] = useState(null);

  /* ========== 载入：课程 tree ========== */
  useEffect(() => {
    if (!user) return;
    (async () => {
      // 课程可见性完全由 RLS（courses_select）决定，前端不再做无效的学校过滤（STU-1）
      const { data, error } = await supabase
        .from('courses')
        .select('id, name, subject, course_type, created_by, chapters(id, name, deleted_at, units(id, name, deleted_at))')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) { logger.error('加载课程失败:', error); toast('课程加载失败，请刷新重试', { kind: 'error' }); }
      const list = (data || []).map(c => ({
        ...c,
        chapters: (c.chapters || []).filter(ch => !ch.deleted_at)
          .sort((a,b)=>a.order_idx-b.order_idx)
          .map(ch => ({ ...ch, units: (ch.units || []).filter(u => !u.deleted_at).sort((x,y)=>x.order_idx-y.order_idx) })),
      }));
      setCourses(list);
      setLoadingCourses(false);
    })();
  }, [user]);

  /* ========== 载入：自定义学习行为形式 ========== */
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from('user_learning_forms')
        .select('name')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false });
      if (error) { logger.error('加载学习形式失败:', error); return; }
      setCustomForms((data || []).map(x => x.name));
    })();
  }, [user]);

  /* ========== 最近记录（载入 / 提交成功 / 队列冲刷后共用） ========== */
  async function refreshRecent() {
    if (!user) return;
    const { data, error } = await supabase
      .from('learning_sessions')
      .select(RECENT_SELECT)
      .eq('student_id', user.id)
      .is('deleted_at', null)
      .order('session_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT);
    if (error) { logger.error('加载最近记录失败:', error); return; }
    setRecent(data || []);
  }
  useEffect(() => {
    if (user) refreshRecent();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ========== 载入：待补填客观评价列表（练习类 + 无客观） ========== */
  const loadPending = async () => {
    if (!user) return;
    setLoadingPending(true);
    try {
      const { data, error } = await applyPendingFilter(supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, end_time, duration_minutes,
          category, form, eval_type, self_rating, grade_label, notes,
          course:courses(id,name,subject,course_type),
          chapter:chapters(id,name),
          unit:units(id,name)
        `)
        .eq('student_id', user.id))
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) { logger.error('加载待补填列表失败:', error); return; }
      setPending(data || []);
    } finally {
      setLoadingPending(false);
    }
  };

  // 进页面即加载 pending（tab bar badge 需要立即显示数字）
  useEffect(() => {
    if (user) loadPending();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  // 切到「待补填」tab 时再次刷新；提交后也刷新
  useEffect(() => {
    if (user && view === 'pending') loadPending();
  }, [user, view]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ========== 载入：成绩 Tab 数据（校内课程 + exam_scores）========== */
  const loadScores = async () => {
    if (!user) return;
    setLoadingScores(true);
    let cancelled = false;
    try {
      const [coursesRes, scoresRes] = await Promise.all([
        supabase
          .from('courses')
          .select('id, name, subject, course_type')
          .eq('created_by', user.id)
          .eq('course_type', 1)   // 仅校内课程
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('exam_scores')
          .select('*')
          .eq('student_id', user.id)
          .is('deleted_at', null)
          .order('exam_date', { ascending: false })
          .order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      if (coursesRes.error) { logger.error('加载校内课程失败:', coursesRes.error); }
      if (scoresRes.error)  { logger.error('加载考试成绩失败:', scoresRes.error); }
      if (!coursesRes.error) setScoreCourses(coursesRes.data || []);
      if (!scoresRes.error)  setExamScores(scoresRes.data || []);
    } finally {
      if (!cancelled) setLoadingScores(false);
    }
  };
  useEffect(() => {
    if (user && view === 'scores') loadScores();
  }, [user, view]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ========== 成绩：打开新增/编辑 modal ========== */
  function openScoreModal(courseId, editingScore = null) {
    setScoreModalCourseId(courseId);
    setScoreModalEditing(editingScore);
    if (editingScore) {
      setScoreForm({
        exam_name: editingScore.exam_name || '',
        exam_date: String(editingScore.exam_date || ''),
        score: editingScore.score != null ? String(editingScore.score) : '',
        grade_label: editingScore.grade_label || '',
        notes: editingScore.notes || '',
      });
    } else {
      const today = new Date();
      setScoreForm({
        exam_name: '',
        exam_date: toDateStr(today),
        score: '',
        grade_label: '',
        notes: '',
      });
    }
    setScoreModalOpen(true);
  }
  function closeScoreModal() {
    setScoreModalOpen(false);
    setScoreModalEditing(null);
    setScoreSaving(false);
  }
  function friendlyErr(e, fallback = '保存失败') {
    let msg = (e && e.message) || fallback;
    const code = e && e.code;
    // 常见 Supabase / Postgres 错误 → 中文友好提示（移动端用户一眼懂）
    if (msg.includes('row-level security')) return '权限不足：您只能操作自己的记录。';
    if (/relation.*exam_scores.*does not exist/i.test(msg)) return '成绩表未创建：请先在 Supabase SQL Editor 执行 schema.patch-exam-scores.sql 补丁。';
    if (/invalid input syntax for type uuid/i.test(msg)) return '课程信息无效，请返回课程列表重新打开此页面。';
    if (/foreign key constraint.*course_id/i.test(msg) || /FK.*courses/i.test(msg)) return '关联的课程不存在，可能已被删除。';
    if (/value too long.*varchar\(64\)/i.test(msg) || code === '22001') return '考试名称太长（最多 64 个字符）。';
    if (/numeric field overflow/i.test(msg) || code === '22003') return '分数超出范围，请输入 0–100。';
    if (/not null.*constraint/i.test(msg) || code === '23502') {
      if (/exam_name/.test(msg)) return '请填写考试名称。';
      if (/exam_date/.test(msg)) return '请选择考试日期。';
      if (/student_id/.test(msg)) return '登录状态失效，请重新登录。';
      if (/course_id/.test(msg)) return '请先选择课程。';
      return '必填项缺失，请检查后重试。';
    }
    if (code) msg = `${fallback}（${code}）`;
    return msg;
  }
  async function saveScore() {
    const { exam_name, exam_date, score, grade_label, notes } = scoreForm;
    if (!scoreModalCourseId) { toast('课程无效，请返回重试', { kind: 'error' }); return; }
    if (!exam_name || !exam_name.trim()) { toast('请填写考试名称', { kind: 'error' }); return; }
    if (!exam_date) { toast('请选择考试日期', { kind: 'error' }); return; }
    const trimmedName = exam_name.trim();
    if (trimmedName.length > 64) { toast('考试名称过长（最多 64 字）', { kind: 'error' }); return; }
    let scoreNum = null;
    if (score !== '' && score != null && String(score).trim() !== '') {
      scoreNum = Number(score);
      if (Number.isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
        toast('分数需在 0–100 之间', { kind: 'error' }); return;
      }
      // Postgres numeric(5,2)：保留两位，超出截断避免溢出
      scoreNum = Math.round(scoreNum * 100) / 100;
    }
    const trimmedGrade = grade_label ? grade_label.trim() : '';
    if (trimmedGrade && trimmedGrade.length > 8) { toast('评级最长 8 个字符', { kind: 'error' }); return; }
    if (scoreNum == null && !trimmedGrade) {
      toast('请至少填写分数或评级一项', { kind: 'error' }); return;
    }
    setScoreSaving(true);
    try {
      // 预检：exam_scores 表是否存在
      const { error: preCheckErr } = await supabase
        .from('exam_scores')
        .select('id')
        .limit(1);
      if (preCheckErr) {
        const preMsg = friendlyErr(preCheckErr, '成绩数据表异常');
        logger.error('[saveScore] pre-check failed:', JSON.stringify(preCheckErr, null, 2));
        toast(preMsg, { kind: 'error', duration: 6000 });
        return;
      }

      const payload = {
        student_id: user.id,
        course_id: scoreModalCourseId,
        exam_name: trimmedName,
        exam_date,
        score: scoreNum,
        grade_label: trimmedGrade || null,
        notes: notes ? notes.trim() || null : null,
      };
      if (scoreModalEditing) {
        const { error } = await supabase
          .from('exam_scores')
          .update(payload)
          .eq('id', scoreModalEditing.id);
        if (error) throw error;
        toast('已更新', { kind: 'success' });
      } else {
        const { error } = await supabase
          .from('exam_scores')
          .insert(payload);
        if (error) throw error;
        toast('已保存', { kind: 'success' });
      }
      closeScoreModal();
      await loadScores();
    } catch (e) {
      logger.error('[saveScore] failed:', JSON.stringify(e, null, 2));
      const msg = friendlyErr(e, '保存失败');
      toast(msg, { kind: 'error', duration: 6000 });
    } finally {
      setScoreSaving(false);
    }
  }
  async function deleteScore(score) {
    try {
      const { error } = await supabase
        .from('exam_scores')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', score.id);
      if (error) throw error;
      toast('已删除', { kind: 'success' });
      setScoreDeletingId(null);
      await loadScores();
    } catch (e) {
      logger.error('deleteScore failed:', e);
      toast(friendlyErr(e, '删除失败'), { kind: 'error' });
    }
  }

  /* ========== 打开记一笔：＋ 按钮事件 / ?log=1 / 再记一次 ========== */
  function openNew(detail) {
    const d = detail && typeof detail === 'object' ? detail : {};
    setSheet({
      open: true, mode: 'new', editRow: null,
      preset: {
        courseId: d.courseId || '',
        chapterId: d.chapterId || '',
        unitId: d.unitId || '',
        category: d.category,
        form: d.form || '',
        durationMinutes: Number(d.durationMinutes) || 0,
      },
    });
  }
  function closeSheet() {
    setSheet(s => ({ ...s, open: false }));
  }

  useEffect(() => {
    const onOpen = (e) => openNew(e.detail);
    window.addEventListener('yb:open-log', onOpen);
    return () => window.removeEventListener('yb:open-log', onOpen);
  }, []);

  useEffect(() => {
    if (searchParams.get('log') !== '1') return;
    openNew(null);
    const next = new URLSearchParams(searchParams);
    next.delete('log');
    setSearchParams(next, { replace: true });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ========== 添加自定义 学习行为形式 ========== */
  async function onAddCustomForm(name) {
    if (ALL_FORM_PRESET.includes(name) || customForms.includes(name)) return true;
    try {
      const { error } = await supabase.from('user_learning_forms').insert({
        student_id: user.id, name,
      });
      if (error) throw error;
      setCustomForms([name, ...customForms]);
      return true;
    } catch (e) {
      toast(e.message || '保存失败', { kind: 'error' });
      return false;
    }
  }

  /* ========== 失败队列：自动/手动重试 ========== */
  // 网络中断或会话失效导致 insert 失败时，记录已暂存本机（outbox）。
  // 恢复后逐条重试：先做与 onSubmit 相同的时段重叠检查（暂存期间学生可能已手动补了同一时段），再写入。
  async function flushOutbox() {
    const items = loadOutbox();
    if (!items.length || !user || outboxRetrying) return;
    setOutboxRetrying(true);
    let conflictDropped = 0;
    let succeeded = 0;
    try {
      for (const item of items) {
        if (item.kind !== 'learning_session') { removeFromOutbox(item.id); continue; }
        const p = item.payload;
        const { data: conflicts, error: conflictErr } = await supabase
          .from('learning_sessions')
          .select('id')
          .eq('student_id', p.student_id)
          .eq('session_date', p.session_date)
          .is('deleted_at', null)
          .lt('start_time', p.end_time)
          .gt('end_time', p.start_time);
        if (conflictErr) break;            // 网络/会话仍不可用，停止本轮，保留队列
        if (conflicts && conflicts.length > 0) {
          removeFromOutbox(item.id);       // 已有同时段记录：丢弃暂存，不重复写
          conflictDropped += 1;
          continue;
        }
        const { error } = await supabase.from('learning_sessions').insert(p);
        if (error) break;                  // 仍失败，保留队列等待下次
        removeFromOutbox(item.id);
        succeeded += 1;
      }
    } catch {
      // fetch 级别的异常同样保留队列
    } finally {
      setOutboxRetrying(false);
      setOutboxItems(loadOutbox());
    }
    if (conflictDropped > 0) {
      toast(`${conflictDropped} 条暂存记录与已有记录时间重叠，未重复保存`, { kind: 'error' });
    }
    if (succeeded > 0) {
      toast(`${succeeded} 条暂存记录已补传成功`, { kind: 'success' });
      await refreshRecent();
      await loadPending();
    }
  }

  // 挂载后 + 网络恢复时自动冲刷失败队列
  useEffect(() => {
    if (!user) return;
    flushOutbox();
    const onOnline = () => flushOutbox();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ========== 提交（新增） ========== */
  async function onSubmit(values) {
    const newErrors = validateSession(values);
    if (Object.keys(newErrors).length > 0) return { errors: newErrors };

    const payload = buildSessionPayload({ studentId: user.id, ...values });

    setBusy(true);
    try {
      const { data: conflicts, error: conflictError } = await supabase
        .from('learning_sessions')
        .select('id, start_time, end_time')
        .eq('student_id', user.id)
        .eq('session_date', payload.session_date)
        .is('deleted_at', null)
        .lt('start_time', payload.end_time)
        .gt('end_time', payload.start_time);

      if (conflictError) throw conflictError;
      if (conflicts && conflicts.length > 0) {
        const conflict = conflicts[0];
        return { errors: { time: `该时间段已有学习记录（${conflict.start_time} - ${conflict.end_time}）` } };
      }

      const { error } = await supabase.from('learning_sessions').insert(payload);
      if (error) throw error;

      toast('记录已保存', { kind: 'success' });
      closeSheet();
      await refreshRecent();
      await loadPending();
      flushOutbox();  // 网络已通，顺带冲刷暂存队列（不阻塞本次提交）
      return { ok: true };
    } catch (err) {
      // 保存失败：暂存本机，同步状态条会持续提示并自动重试——绝不让记录无声丢失
      enqueueOutbox({ kind: 'learning_session', payload });
      setOutboxItems(loadOutbox());
      let msg = err.message || '保存失败';
      if (msg.includes('row-level security')) {
        msg = '权限不足：登录状态可能已过期，请重新登录';
      } else if (msg.includes('self_rating') || msg.includes('not-null') || msg.includes('constraint')) {
        msg = '数据库配置需要更新';
      } else if (msg.includes('fetch')) {
        msg = '网络连接失败';
      }
      toast(`${msg}。本条已暂存本机，恢复后会自动重试`, { kind: 'error' });
      closeSheet();
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }

  /* ========== 编辑现有记录 ========== */
  function onStartEdit(r) {
    setSheet({ open: true, mode: 'edit', editRow: r, preset: null });
  }

  async function onSaveEdit(values) {
    const editingSessionId = sheet.editRow?.id;
    if (!editingSessionId) return { ok: false };
    const newErrors = validateSession(values);
    if (Object.keys(newErrors).length > 0) return { errors: newErrors };

    const payload = buildSessionPayload(values);

    setBusy(true);
    try {
      const { data: conflicts, error: conflictError } = await supabase
        .from('learning_sessions')
        .select('id, start_time, end_time')
        .eq('student_id', user.id)
        .eq('session_date', payload.session_date)
        .is('deleted_at', null)
        .neq('id', editingSessionId)
        .lt('start_time', payload.end_time)
        .gt('end_time', payload.start_time);

      if (conflictError) throw conflictError;
      if (conflicts && conflicts.length > 0) {
        const conflict = conflicts[0];
        return { errors: { time: `该时间段已有学习记录（${conflict.start_time} - ${conflict.end_time}）` } };
      }

      const { error } = await supabase
        .from('learning_sessions')
        .update(payload)
        .eq('id', editingSessionId);
      if (error) {
        logger.error('Update session error:', error);
        throw error;
      }
      toast('已更新', { kind: 'success' });
      closeSheet();
      await refreshRecent();
      await loadPending();
      return { ok: true };
    } catch (err) {
      let msg = err.message || '保存失败';
      if (msg.includes('row-level security')) {
        msg = '权限不足：您只能操作自己的学习记录。';
      }
      toast(msg, { kind: 'error' });
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }

  /* ========== 删除（软删除）========== */
  async function onConfirmDelete(r) {
    setDeletingId(null);
    setBusy(true);
    try {
      const { error } = await supabase
        .from('learning_sessions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', r.id);
      if (error) throw error;
      toast('已删除', { kind: 'success' });
      setRecent(prev => prev.filter(x => x.id !== r.id));
      loadPending();
    } catch (err) {
      let msg = err.message || '删除失败';
      if (msg.includes('row-level security')) {
        msg = '权限不足：您只能删除自己的学习记录。';
      }
      toast(msg, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  /* ========== 待补填：点等第即保存 ========== */
  async function onPendingGrade(r, gradeLabel) {
    if (pendingSavingId) return;
    setPendingSavingId(r.id);
    try {
      const { error } = await supabase
        .from('learning_sessions')
        .update(pendingGradePayload(gradeLabel))
        .eq('id', r.id);
      if (error) throw error;
      setPendingDone(d => ({ ...d, [r.id]: gradeLabel }));
      toast('客观评价已保存', { kind: 'success' });
      // 稍等片刻让学生看到确认，再刷新列表（连续补填时合并成一次刷新）
      clearTimeout(pendingReloadTimer.current);
      pendingReloadTimer.current = setTimeout(async () => {
        await loadPending();
        setPendingDone({});
      }, 1200);
    } catch (err) {
      let msg = err.message || '保存失败';
      if (msg.includes('row-level security')) {
        msg = '权限不足：您只能操作自己的学习记录。';
      }
      toast(msg, { kind: 'error' });
    } finally {
      setPendingSavingId(null);
    }
  }
  useEffect(() => () => clearTimeout(pendingReloadTimer.current), []);

  /* ========== 派生数据 ========== */
  const combos = useMemo(() => recentCombos(recent, 4), [recent]);
  const days = useMemo(() => {
    const out = [];
    for (const r of recent) {
      const last = out[out.length - 1];
      if (last && last.date === r.session_date) { last.rows.push(r); last.total += r.duration_minutes || 0; }
      else out.push({ date: r.session_date, rows: [r], total: r.duration_minutes || 0 });
    }
    return out;
  }, [recent]);
  const pendingOpen = pending.filter(r => !pendingDone[r.id]).length;

  function onTabKeyDown(e, i) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + TABS.length) % TABS.length;
    tabRefs.current[next]?.focus();
    setView(TABS[next].key);
  }

  /* ========== JSX ========== */
  return (
    <div className="yb-lg yb-lg-page animate-fade-in">
      <div className="yb-lg-head">
        <div>
          <h1>记录</h1>
          <p>记下每一次学习，数据会帮你看清自己</p>
        </div>
        <button type="button" className="yb-btn sm" aria-haspopup="dialog" onClick={() => openNew(null)}>
          <Plus size={16} strokeWidth={2.4} aria-hidden="true" />记一笔
        </button>
      </div>

      {/* ====== 顶部 Tab: 记录 / 待补填 / 成绩 ====== */}
      <div className="yb-seg" role="tablist" aria-label="记录分类">
        {TABS.map((t, i) => {
          const count = t.key === 'pending' ? pending.length : t.key === 'scores' ? examScores.length : 0;
          return (
            <button
              key={t.key}
              ref={el => { tabRefs.current[i] = el; }}
              type="button"
              role="tab"
              id={`yb-tab-${t.key}`}
              aria-selected={view === t.key}
              aria-controls={`yb-panel-${t.key}`}
              tabIndex={view === t.key ? 0 : -1}
              onClick={() => setView(t.key)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
            >
              {t.label}
              {count > 0 && <span className="count num" aria-label={`${count} 条`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ====== 失败暂存队列：中性同步状态（消失=已全部补传成功） ====== */}
      {outboxItems.length > 0 && (
        <div className="yb-sync" role="status" aria-live="polite">
          <span className="yb-dot warn" aria-hidden="true" />
          <span className="grow">
            <b className="num">{outboxItems.length}</b> 条待同步 · 已暂存在本机，联网后自动补传
          </span>
          <button type="button" className="yb-btn sm ghost" onClick={flushOutbox} disabled={outboxRetrying}>
            {outboxRetrying ? '同步中…' : '重试'}
          </button>
        </div>
      )}

      <div role="tabpanel" id={`yb-panel-${view}`} aria-labelledby={`yb-tab-${view}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {view === 'scores' ? (
        /* ====== 成绩视图 ====== */
        loadingScores ? (
          <div className="yb-empty">加载中…</div>
        ) : scoreCourses.length === 0 ? (
          <div className="yb-empty">
            <b>还没有校内课程</b>
            在「课程」里创建课程时选择「校内」，这里就会出现，可以记录考试成绩。
            <div><a href="/syllabus" className="yb-btn sm">去创建课程</a></div>
          </div>
        ) : (
          <div className="yb-scores">
            {scoreCourses.map(c => {
              const scores = examScores.filter(s => s.course_id === c.id);
              return (
                <section key={c.id} className="yb-score-card" aria-label={`${c.name} 成绩`}>
                  <div className="yb-score-card__h">
                    <b>{c.name}</b>
                    <small>已记录 {scores.length} 次</small>
                  </div>
                  {scores.length === 0 ? (
                    <p className="yb-note">还没有成绩记录</p>
                  ) : scores.map(s => (
                    <div key={s.id} className="yb-score">
                      <div className="yb-score__md">
                        <div className="yb-score__name">
                          {s.exam_name}
                          <time dateTime={String(s.exam_date || '')}>{String(s.exam_date || '').slice(5)}</time>
                        </div>
                        {(s.score != null || s.grade_label) && (
                          <div className="yb-score__val">
                            {s.score != null && `${s.score} 分`}
                            {s.score != null && s.grade_label ? ' · ' : ''}
                            {s.grade_label}
                          </div>
                        )}
                        {s.notes && <div className="yb-score__notes">{s.notes}</div>}
                      </div>
                      {scoreDeletingId === s.id ? (
                        <div className="yb-score-confirm">
                          <button type="button" className="yb-btn sm" onClick={() => deleteScore(s)}>确认删除</button>
                          <button type="button" className="yb-btn sm quiet" onClick={() => setScoreDeletingId(null)}>取消</button>
                        </div>
                      ) : (
                        <div className="yb-rec__acts">
                          <button type="button" className="yb-icon-btn" aria-label={`编辑 ${s.exam_name}`} onClick={() => openScoreModal(c.id, s)}>
                            <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <button type="button" className="yb-icon-btn" aria-label={`删除 ${s.exam_name}`} onClick={() => setScoreDeletingId(s.id)}>
                            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <button type="button" className="yb-btn sm ghost block" onClick={() => openScoreModal(c.id, null)}>
                    <Plus size={15} aria-hidden="true" />新增成绩
                  </button>
                </section>
              );
            })}
          </div>
        )
      ) : view === 'pending' ? (
        /* ====== 待补填视图：等第格直接放在卡片上，点一下即保存 ====== */
        loadingPending && pending.length === 0 ? (
          <div className="yb-empty">加载中…</div>
        ) : pending.length === 0 ? (
          <div className="yb-empty"><b>都补齐了</b>暂无待补填的客观评价</div>
        ) : (
          <>
            <div className="yb-lg-section-title">
              补填 {pendingOpen} 条客观评价
              <small>点一下等第即保存</small>
            </div>
            {pending.map(r => {
              const done = pendingDone[r.id];
              return (
                <section key={r.id} className="yb-pend" aria-label={`${r.course?.name || ''} ${fmtShortDate(r.session_date)} 的练习`}>
                  <div className="yb-pend__top">
                    <div>
                      <div className="yb-pend__title">
                        {r.course?.name || '-'} <span className="yb-rec__where">{whereLabel(r.course)}</span>
                      </div>
                      <div className="yb-pend__meta">
                        {fmtShortDate(r.session_date)} {hhmm(r.start_time)} · {coursePath(r)} · {r.form}
                        {r.duration_minutes ? ` · ${r.duration_minutes} 分钟` : ''}
                      </div>
                    </div>
                    {r.self_rating != null && (
                      <div className="yb-pend__self">主观：{subjLabel(r.self_rating)}</div>
                    )}
                  </div>
                  {done ? (
                    <div className="yb-pend__done" role="status">
                      <Check size={16} aria-hidden="true" />
                      已补填 {done}{GRADE_RANGES[done] ? ` · ${GRADE_RANGES[done]}` : ''}
                    </div>
                  ) : (
                    <GradeChips
                      value={null}
                      includeNA
                      showBand={false}
                      label={`为 ${r.course?.name || ''} 这次练习补填客观评价`}
                      disabled={!!pendingSavingId}
                      onChange={(g) => onPendingGrade(r, g)}
                    />
                  )}
                </section>
              );
            })}
          </>
        )
      ) : (
        /* ====== 记录视图：再记一次 + 按天分组的最近记录 ====== */
        <>
          {!loadingCourses && courses.length === 0 && (
            <div className="yb-empty">
              <b>还没有课程</b>
              需要先创建课程大纲，才能记录学习行为。
              <div><a href="/syllabus" className="yb-btn sm">去创建课程</a></div>
            </div>
          )}

          {combos.length > 0 && (
            <section aria-labelledby="yb-again-title">
              <div className="yb-lg-section-title" id="yb-again-title" style={{ marginBottom: 8 }}>
                再记一次 <small>点一下，预填好</small>
              </div>
              <div className="yb-again">
                {combos.map(c => (
                  <button key={c.key} type="button" aria-haspopup="dialog"
                    aria-label={`再记一次：${c.courseName} · ${catLabel(c.category)} · ${c.form} · ${c.durationMinutes} 分钟`}
                    onClick={() => openNew(c)}>
                    <span className="t">{c.courseName}</span>
                    <span className="m">
                      <span className={`yb-dot c${c.category}`} aria-hidden="true" />
                      {`${c.form} · ${c.durationMinutes} 分钟`}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="yb-lg-section-title">
            最近记录
            <small className="num">{recent.length} 条</small>
          </div>
          {recent.length === 0 ? (
            courses.length > 0 && (
              <div className="yb-empty">
                <b>还没有记录</b>
                点「记一笔」记下第一次学习。
              </div>
            )
          ) : days.map(day => (
            <section key={day.date} className="yb-day" aria-label={fmtDay(day.date)}>
              <div className="yb-day__h">
                <span>{fmtDay(day.date)}</span>
                <span className="num">共 {day.total} 分钟</span>
              </div>
              <div className="yb-day__list">
                {day.rows.map(r => (
                  <article key={r.id} className={`yb-rec ${sheet.open && sheet.mode === 'edit' && sheet.editRow?.id === r.id ? 'yb-rec--editing' : ''}`}>
                    <time className="yb-rec__tm" dateTime={hhmm(r.start_time)}>{hhmm(r.start_time)}</time>
                    <div className="yb-rec__md">
                      <div className="yb-rec__course">
                        {r.course?.name || '-'}
                        <span className="yb-rec__where">{whereLabel(r.course)}</span>
                      </div>
                      <div className="yb-rec__path">{coursePath(r)}</div>
                      <div className="yb-rec__tags">
                        <span><span className={`yb-dot c${r.category}`} aria-hidden="true" />{catLabel(r.category)}</span>
                        <span>{r.form}</span>
                        {r.self_rating != null && (
                          <span>主观：{subjLabel(r.self_rating)}</span>
                        )}
                        {r.category === 3 && r.grade_label && (
                          <span>客观：{r.grade_label}</span>
                        )}
                        {r.category === 3 && !r.grade_label && (
                          <span className="yb-pill pending">客观：待补充</span>
                        )}
                      </div>
                      {r.notes && <div className="yb-rec__notes">{r.notes}</div>}
                    </div>
                    <div className="yb-rec__rt">
                      <div className="yb-rec__dur">
                        <span className="yb-rec__dur-num">{r.duration_minutes}</span>
                        <span className="yb-rec__dur-unit">分钟</span>
                      </div>
                      {deletingId === r.id ? (
                        <div className="yb-rec__acts">
                          <button type="button" className="yb-icon-btn danger" onClick={() => onConfirmDelete(r)} aria-label="确认删除这条记录">
                            <Check size={16} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                          <button type="button" className="yb-icon-btn" onClick={() => setDeletingId(null)} aria-label="取消删除">
                            <X size={16} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <div className="yb-rec__acts">
                          <button type="button" className="yb-icon-btn" onClick={() => onStartEdit(r)} aria-label="编辑这条记录">
                            <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <button type="button" className="yb-icon-btn" onClick={() => setDeletingId(r.id)} aria-label="删除这条记录" disabled={busy}>
                            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      </div>

      {/* ====== 记一笔 / 编辑记录 ====== */}
      <LogSheet
        open={sheet.open}
        onClose={closeSheet}
        mode={sheet.mode}
        editRow={sheet.editRow}
        preset={sheet.preset}
        courses={courses}
        loadingCourses={loadingCourses}
        recent={recent}
        customForms={customForms}
        onAddCustomForm={onAddCustomForm}
        onSave={sheet.mode === 'edit' ? onSaveEdit : onSubmit}
        busy={busy}
      />

      {/* ====== 新增 / 编辑成绩 ====== */}
      <Sheet
        open={scoreModalOpen}
        onClose={closeScoreModal}
        title={scoreModalEditing ? '编辑成绩' : '新增成绩'}
        footer={(
          <>
            <button type="button" className="yb-btn ghost" onClick={closeScoreModal} disabled={scoreSaving}>取消</button>
            <button type="button" className="yb-btn" onClick={saveScore} disabled={scoreSaving}>
              {scoreSaving ? '保存中…' : (scoreModalEditing ? '保存修改' : '保存成绩')}
            </button>
          </>
        )}
      >
        <p className="yb-note" style={{ marginTop: -8 }}>{scoreCourses.find(c => c.id === scoreModalCourseId)?.name || '-'}</p>
        <div className="yb-field">
          <label className="yb-label" htmlFor="yb-exam-name">考试名称 · 必填</label>
          <input id="yb-exam-name" type="text" className="yb-input"
            value={scoreForm.exam_name}
            onChange={(e) => setScoreForm({ ...scoreForm, exam_name: e.target.value })}
            placeholder="如：期末考试、月考、单元测"
            disabled={scoreSaving} />
        </div>
        <div className="yb-field">
          <div className="yb-label">考试日期 · 必填</div>
          <DatePicker
            value={scoreForm.exam_date || ''}
            onChange={(v) => setScoreForm({ ...scoreForm, exam_date: v })}
            disabled={scoreSaving}
            className="h-[42px] rounded-xl text-sm font-normal"
            placeholder="选择日期"
          />
        </div>
        <div className="yb-field">
          <label className="yb-label" htmlFor="yb-exam-score">分数（0–100，可选）</label>
          <input id="yb-exam-score" type="number" className="yb-input" min={0} max={100} step={0.1}
            inputMode="decimal"
            value={scoreForm.score}
            onChange={(e) => setScoreForm({ ...scoreForm, score: e.target.value })}
            placeholder="如：92.5"
            disabled={scoreSaving} />
        </div>
        <div className="yb-field">
          <div className="yb-label" id="yb-exam-grade">等第 / 评级</div>
          <div className="yb-chips" role="group" aria-labelledby="yb-exam-grade">
            {GRADE_PRESET_CHIPS.map(chip => {
              const selected = scoreForm.grade_label === chip;
              return (
                <button key={chip} type="button" className="yb-chip num" aria-pressed={selected}
                  onClick={() => setScoreForm({ ...scoreForm, grade_label: selected ? '' : chip })}
                  disabled={scoreSaving}>
                  {chip}
                </button>
              );
            })}
          </div>
        </div>
        <div className="yb-field">
          <label className="yb-label" htmlFor="yb-exam-notes">备注（可选）</label>
          <textarea id="yb-exam-notes" rows={3} className="yb-input"
            value={scoreForm.notes}
            onChange={(e) => setScoreForm({ ...scoreForm, notes: e.target.value })}
            placeholder="如：失分点分析、排名信息等"
            disabled={scoreSaving} />
        </div>
        <p className="yb-note">分数和评级至少填写一项</p>
      </Sheet>
    </div>
  );
}
