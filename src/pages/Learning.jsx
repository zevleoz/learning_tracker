import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { SUBJECTIVE_STEPS } from '../lib/rating.js';
import { useAuth } from '../lib/useAuth.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import { setAppBadge } from '../lib/push.js';
import { loadOutbox, enqueueOutbox, removeFromOutbox } from '../lib/outbox.js';
import DatePicker from '../components/ui/date-picker.jsx';
import LogSheet, { Sheet } from '../components/student/LogSheet.jsx';
import LogForm from '../components/student/LogForm.jsx';
import ClassicLogForm from '../components/student/ClassicLogForm.jsx';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import { useRecordUi } from '../lib/recordUiPref.js';
import { useSegDrag } from '../lib/segDrag.js';
import GradeChips from '../components/student/GradeChips.jsx';
import {
  CATEGORY_OPTS, ALL_FORM_PRESET, GRADE_RANGES,
  validateSession, buildSessionPayload, applyPendingFilter, pendingGradePayload, recentCombos,
  spansMidnight, findOverlap, isPendingObjective,
} from '../lib/sessionRules.js';
import { useCached } from '../lib/useCached.js';
import { load, patch, peek, invalidate } from '../lib/studentCache.js';
import {
  KEYS, fetchExams, fetchExamCourses,
  afterSessionAdded, afterSessionEdited, afterSessionDeleted, afterSessionGraded,
  afterExamsChanged,
} from '../lib/studentResources.js';

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
  { key: 'record', label: '全部' },
  { key: 'pending', label: '待补填' },
  { key: 'scores', label: '考试' },
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

/* ============ 取数（走 studentCache：切页回来先显示缓存，后台刷新） ============ */

const PENDING_SELECT = `
  id, session_date, start_time, end_time, duration_minutes,
  category, form, eval_type, self_rating, grade_label, notes,
  course:courses(id,name,subject,course_type),
  chapter:chapters(id,name),
  unit:units(id,name)
`;
const PENDING_LIMIT = 50;

// 新记录放进「最近记录」：同一天里最新创建的排最前（与按 created_at 倒序的查询一致）
function insertRecent(list, row) {
  const rest = list.filter(x => x.id !== row.id);
  const at = rest.findIndex(x => x.session_date <= row.session_date);
  const i = at === -1 ? rest.length : at;
  return [...rest.slice(0, i), row, ...rest.slice(i)].slice(0, RECENT_LIMIT);
}

async function fetchRecent(userId) {
  const { data, error } = await supabase
    .from('learning_sessions')
    .select(RECENT_SELECT)
    .eq('student_id', userId)
    .is('deleted_at', null)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) { logger.error('加载最近记录失败:', error); return peek(userId, KEYS.recent) ?? []; }
  return data || [];
}

async function fetchPending(userId) {
  const { data, error } = await applyPendingFilter(supabase
    .from('learning_sessions')
    .select(PENDING_SELECT)
    .eq('student_id', userId))
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(PENDING_LIMIT);
  if (error) { logger.error('加载待补填列表失败:', error); return peek(userId, KEYS.pending) ?? []; }
  setAppBadge((data || []).length); // 图标角标 = 待补填数量（不支持的浏览器静默忽略）
  return data || [];
}

async function fetchCourseTree(userId) {
  // 课程可见性完全由 RLS（courses_select）决定，前端不再做无效的学校过滤（STU-1）
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, subject, course_type, created_by, chapters(id, name, deleted_at, units(id, name, deleted_at))')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) { logger.error('加载课程失败:', error); toast('课程加载失败，请刷新重试', { kind: 'error' }); }
  return (data || []).map(c => ({
    ...c,
    chapters: (c.chapters || []).filter(ch => !ch.deleted_at)
      .sort((a,b)=>a.order_idx-b.order_idx)
      .map(ch => ({ ...ch, units: (ch.units || []).filter(u => !u.deleted_at).sort((x,y)=>x.order_idx-y.order_idx) })),
  }));
}

async function fetchCustomForms(userId) {
  const { data, error } = await supabase
    .from('user_learning_forms')
    .select('name')
    .eq('student_id', userId)
    .order('created_at', { ascending: false });
  if (error) { logger.error('加载学习形式失败:', error); return peek(userId, KEYS.forms) ?? []; }
  return (data || []).map(x => x.name);
}

const NONE = [];

// 插入成功之后把返回的行放进各个缓存
function patchAfterAdd(userId, row) {
  if (row) {
    patch(userId, KEYS.recent, (list) => insertRecent(list || [], row));
    if (isPendingObjective(row)) {
      patch(userId, KEYS.pending, (list) => [row, ...(list || []).filter(x => x.id !== row.id)].slice(0, PENDING_LIMIT));
    }
  }
  afterSessionAdded(userId, row);
}

// 考试成绩：日期倒序，同一天按创建时间倒序（与取数的排序一致）
function sortExams(list) {
  return list.slice().sort((a, b) => {
    const da = String(a.exam_date || ''), db = String(b.exam_date || '');
    if (da !== db) return da < db ? 1 : -1;
    const ca = String(a.created_at || ''), cb = String(b.created_at || '');
    return ca < cb ? 1 : ca > cb ? -1 : 0;
  });
}

/* ============ 页面主体 ============ */
function shiftDay(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}

// 与已有记录的时段重叠检查：返回第一条冲突记录或 null；查询失败时抛出。
// 普通时段走数据库的 lt/gt 查询（与改版前一致）；跨午夜（结束 <= 开始）的记录占用 开始日晚上 + 次日凌晨，
// lt/gt 查不出来（end < start），所以取前后一天的记录在本地按绝对分钟比较。
async function findConflict(payload, studentId, excludeId = null) {
  if (spansMidnight(payload.start_time, payload.end_time)) {
    const { data, error } = await supabase
      .from('learning_sessions')
      .select('id, session_date, start_time, end_time')
      .eq('student_id', studentId)
      .is('deleted_at', null)
      .in('session_date', [shiftDay(payload.session_date, -1), payload.session_date, shiftDay(payload.session_date, 1)]);
    if (error) throw error;
    return findOverlap(data, payload, excludeId);
  }
  let q = supabase
    .from('learning_sessions')
    .select('id, start_time, end_time')
    .eq('student_id', studentId)
    .eq('session_date', payload.session_date)
    .is('deleted_at', null);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q
    .lt('start_time', payload.end_time)
    .gt('end_time', payload.start_time);
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}
const conflictMsg = (c) => `该时间段已有学习记录（${c.start_time} - ${c.end_time}）`;

export default function LearningPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const userId = user?.id;

  /* --- 课程与自定义形式（缓存：切回来立即有，后台刷新） --- */
  const coursesRes = useCached(userId, KEYS.courseTree, () => fetchCourseTree(userId));
  const courses = coursesRes.data ?? NONE;
  const loadingCourses = coursesRes.loading;
  const formsRes = useCached(userId, KEYS.forms, () => fetchCustomForms(userId));
  const customForms = formsRes.data ?? NONE; // string[]

  /* --- 记一笔 sheet --- */
  // forceDialog：从别的页面（?log=1）打开时，即使宽屏也用居中对话框，不占用记录列表旁的内嵌位
  const [sheet, setSheet] = useState({ open: false, mode: 'new', preset: null, editRow: null, forceDialog: false });
  // 旧版记录界面（我的 › 使用旧版记录界面）：表单内嵌在「记录」视图，sheet 状态照用，只是不弹出
  const classic = useRecordUi() === 'classic';
  const classicRef = useRef(null);

  /* --- 宽屏：记录页内嵌表单 / 居中对话框 / 手机底部弹层 --- */
  const isWide = useMediaQuery('(min-width: 1180px)');   // ≥1180：记录页内嵌表单
  const isDialogWidth = useMediaQuery('(min-width: 900px)'); // 900–1179：居中对话框
  const asyncRef = useRef(null); // 内嵌表单（切换 tab 也不卸载，草稿留在组件 state 里）
  const inlineMode = !classic && isWide;
  const inlineModeRef = useRef(inlineMode);
  inlineModeRef.current = inlineMode;
  const inlineActive = inlineMode && !sheet.forceDialog;
  const modalOpen = sheet.open && !classic && !inlineActive;

  function revealInline() {
    if (!inlineModeRef.current) return;
    setView('record');
    setTimeout(() => asyncRef.current?.focus?.(), 0);
  }
  function revealClassic() {
    if (!classic) return;
    setView('record');
    setTimeout(() => {
      classicRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      classicRef.current?.focus?.({ preventScroll: true });
    }, 0);
  }

  /* --- 提交状态 / 最近记录 --- */
  const [busy, setBusy] = useState(false);
  const recentRes = useCached(userId, KEYS.recent, () => fetchRecent(userId));
  const recent = recentRes.data ?? NONE;
  // 保存失败的本机暂存队列（网络中断/会话失效时兜底，恢复后自动重试）
  const [outboxItems, setOutboxItems] = useState(() => loadOutbox());
  const [outboxRetrying, setOutboxRetrying] = useState(false);
  // 用 ref 防并发：挂载 / online 事件 / 提交成功 / 点重试各自持有旧闭包，state 拦不住同时进入的第二轮
  const flushingRef = useRef(false);
  const [deletingId, setDeletingId] = useState(null);

  /* --- 顶部 tab：记录 / 待补填 / 成绩 --- */
  const [view, setView] = useState('record'); // 'record' | 'pending' | 'scores'
  const tabRefs = useRef([]);
  // 手机上按住顶部 tab 横滑，选手指下那一类（点按行为不变）
  const tabDrag = useSegDrag({ onPick: (i) => { if (TABS[i]) setView(TABS[i].key); } });

  /* --- 待补填客观评价列表 --- */
  const pendingRes = useCached(userId, KEYS.pending, () => fetchPending(userId));
  const pending = pendingRes.data ?? NONE;
  const loadingPending = pendingRes.loading;
  const [pendingSavingId, setPendingSavingId] = useState(null);
  const [pendingDone, setPendingDone] = useState({}); // { [sessionId]: grade_label }
  const pendingReloadTimer = useRef(null);
  const gradedIdsRef = useRef(new Set());   // 刚补填、等着从待补填列表拿掉的行

  /* --- 成绩 Tab：校内课程 + 考试成绩 --- */
  // 进过「考试」tab 才取 / 显示（与改版前一致）；取过之后在缓存里，下次进来立即有
  const scoresOpened = view === 'scores';
  const scoreCoursesRes = useCached(userId, KEYS.examCourses, () => fetchExamCourses(userId), { enabled: scoresOpened });
  const examScoresRes = useCached(userId, KEYS.exams, () => fetchExams(userId), { enabled: scoresOpened });
  const [scoresSeen, setScoresSeen] = useState(false);
  useEffect(() => { if (scoresOpened) setScoresSeen(true); }, [scoresOpened]);
  const scoreCourses = scoresSeen ? (scoreCoursesRes.data ?? NONE) : NONE;   // 校内课程列表 course_type=1
  const examScores = scoresSeen ? (examScoresRes.data ?? NONE) : NONE;      // 所有 exam_scores 记录
  const loadingScores = scoresOpened && (scoreCoursesRes.loading || examScoresRes.loading);
  // 新增/编辑成绩 sheet
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [scoreModalEditing, setScoreModalEditing] = useState(null);  // exam_score 对象或 null(新增)
  const [scoreModalCourseId, setScoreModalCourseId] = useState('');
  const [scoreForm, setScoreForm] = useState({ exam_name: '', exam_date: '', score: '', grade_label: '', notes: '' });
  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreDeletingId, setScoreDeletingId] = useState(null);

  /* ========== 最近记录 / 待补填：后台刷新（提交成功 / 队列冲刷 / 切到「待补填」时共用，两个请求并行） ========== */
  function refreshRecent() {
    if (!userId) return Promise.resolve();
    return load(userId, KEYS.recent, () => fetchRecent(userId)).catch(() => {});
  }
  function loadPending() {
    if (!userId) return Promise.resolve();
    return load(userId, KEYS.pending, () => fetchPending(userId)).catch(() => {});
  }
  function refreshLists() {
    return Promise.all([refreshRecent(), loadPending()]);
  }

  // 切到「待补填」tab 时再次刷新（进页面时的首次加载由上面的 useCached 负责：tab bar badge 需要立即显示数字）
  useEffect(() => {
    if (userId && view === 'pending') loadPending();
  }, [userId, view]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const payload = {
        student_id: user.id,
        course_id: scoreModalCourseId,
        exam_name: trimmedName,
        exam_date,
        score: scoreNum,
        grade_label: trimmedGrade || null,
        notes: notes ? notes.trim() || null : null,
      };
      let saved = null;
      if (scoreModalEditing) {
        const { data, error } = await supabase
          .from('exam_scores')
          .update(payload)
          .eq('id', scoreModalEditing.id)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        saved = data;
        toast('已更新', { kind: 'success' });
      } else {
        const { data, error } = await supabase
          .from('exam_scores')
          .insert(payload)
          .select('*')
          .single();
        if (error) throw error;
        saved = data;
        toast('已保存', { kind: 'success' });
      }
      closeScoreModal();
      // 写入已确认：立刻把返回的那一行放进列表，再在后台与数据库对一次
      if (saved) {
        patch(user.id, KEYS.exams, (list) => sortExams([saved, ...(list || []).filter(x => x.id !== saved.id)]));
      }
      afterExamsChanged(user.id);
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
      patch(user.id, KEYS.exams, (list) => (list || []).filter(x => x.id !== score.id));
      afterExamsChanged(user.id);
    } catch (e) {
      logger.error('deleteScore failed:', e);
      toast(friendlyErr(e, '删除失败'), { kind: 'error' });
    }
  }

  /* ========== 打开记一笔：＋ 按钮事件 / ?log=1 / 再记一次 ========== */
  // forceDialog 用于「从别的页面点 ＋」的入口（?log=1）：宽屏也保留居中对话框的形态。
  function openNew(detail, opts) {
    const d = detail && typeof detail === 'object' ? detail : {};
    const forceDialog = !!opts?.dialog;
    setSheet({
      open: true, mode: 'new', editRow: null, forceDialog,
      preset: {
        courseId: d.courseId || '',
        chapterId: d.chapterId || '',
        unitId: d.unitId || '',
        category: d.category,
        form: d.form || '',
        durationMinutes: Number(d.durationMinutes) || 0,
      },
    });
    if (!forceDialog) revealInline();
    revealClassic();
  }
  function closeSheet() {
    // 关闭时一并退出编辑；内嵌表单按 editRow / preset 的变化回到新建状态
    setSheet(s => ({ ...s, open: false, mode: 'new', editRow: null, forceDialog: false }));
  }

  useEffect(() => {
    const onOpen = (e) => openNew(e.detail);
    // yb:close-log（桌面 Esc）由 LogSheet 自己处理，走 requestClose 才好做未保存确认
    window.addEventListener('yb:open-log', onOpen);
    return () => window.removeEventListener('yb:open-log', onOpen);
  }, []);

  useEffect(() => {
    if (searchParams.get('log') !== '1') return;
    // 提醒推送点开的链接：?log=1&course=<id>&category=<1|2|3>&form=<形式>&minutes=<分钟>，与 yb:open-log 的 detail 同义
    const category = Number(searchParams.get('category'));
    openNew({
      courseId: searchParams.get('course') || '',
      category: [1, 2, 3].includes(category) ? category : undefined,
      form: searchParams.get('form') || '',
      durationMinutes: Number(searchParams.get('minutes')) || 0,
    }, { dialog: true });
    const next = new URLSearchParams(searchParams);
    ['log', 'course', 'category', 'form', 'minutes'].forEach((k) => next.delete(k));
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
      patch(user.id, KEYS.forms, (list) => [name, ...(list || [])]);
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
    if (!items.length || !user || flushingRef.current) return;
    flushingRef.current = true;
    setOutboxRetrying(true);
    let conflictDropped = 0;
    let succeeded = 0;
    try {
      for (const item of items) {
        if (item.kind !== 'learning_session') { removeFromOutbox(item.id); continue; }
        const p = item.payload;
        let conflict;
        try {
          conflict = await findConflict(p, p.student_id);
        } catch {
          break;                           // 网络/会话仍不可用，停止本轮，保留队列
        }
        if (conflict) {
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
      flushingRef.current = false;
      setOutboxRetrying(false);
      setOutboxItems(loadOutbox());
    }
    if (conflictDropped > 0) {
      toast(`${conflictDropped} 条暂存记录与已有记录时间重叠，未重复保存`, { kind: 'error' });
    }
    if (succeeded > 0) {
      toast(`${succeeded} 条暂存记录已补传成功`, { kind: 'success' });
      invalidate(user.id, KEYS.student, { drop: true }); // 补传的记录没有拿回行：今天 / 洞察的缓存丢弃，下次读取等新数据
      await refreshLists();
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
      const conflict = await findConflict(payload, user.id);
      if (conflict) return { errors: { time: conflictMsg(conflict) } };

      // 写入由数据库确认之后才算保存成功：insert 的同一次请求把这一行带回来（payload 与之前完全相同）
      const { data: inserted, error } = await supabase
        .from('learning_sessions')
        .insert(payload)
        .select(RECENT_SELECT)
        .single();
      if (error) throw error;

      toast('记录已保存', { kind: 'success' });
      closeSheet();
      // 马上把已确认的这一行放进列表（最近记录 / 待补填 / 今天与洞察的缓存），再在后台并行与数据库对一次
      patchAfterAdd(user.id, inserted);
      refreshLists();
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
    setSheet({ open: true, mode: 'edit', editRow: r, preset: null, forceDialog: false });
    revealInline();
    revealClassic();
  }

  async function onSaveEdit(values) {
    const editingSessionId = sheet.editRow?.id;
    if (!editingSessionId) return { ok: false };
    const newErrors = validateSession(values);
    if (Object.keys(newErrors).length > 0) return { errors: newErrors };

    const payload = buildSessionPayload(values);

    setBusy(true);
    try {
      const conflict = await findConflict(payload, user.id, editingSessionId);
      if (conflict) return { errors: { time: conflictMsg(conflict) } };

      const { data: updated, error } = await supabase
        .from('learning_sessions')
        .update(payload)
        .eq('id', editingSessionId)
        .select(RECENT_SELECT)
        .maybeSingle();
      if (error) {
        logger.error('Update session error:', error);
        throw error;
      }
      toast('已更新', { kind: 'success' });
      closeSheet();
      // 马上用返回的行替换列表里的旧行；再在后台并行与数据库对一次
      if (updated) {
        patch(user.id, KEYS.recent, (list) => (list || []).map(x => (x.id === updated.id ? updated : x)));
        patch(user.id, KEYS.pending, (list) => {
          const rest = (list || []).filter(x => x.id !== updated.id);
          return isPendingObjective(updated) ? [updated, ...rest].slice(0, PENDING_LIMIT) : rest;
        });
      }
      afterSessionEdited(user.id, updated);
      refreshLists();
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
      patch(user.id, KEYS.recent, (list) => (list || []).filter(x => x.id !== r.id));
      patch(user.id, KEYS.pending, (list) => (list || []).filter(x => x.id !== r.id));
      afterSessionDeleted(user.id, r.id);
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
      const gradePayload = pendingGradePayload(gradeLabel);
      const { error } = await supabase
        .from('learning_sessions')
        .update(gradePayload)
        .eq('id', r.id);
      if (error) throw error;
      setPendingDone(d => ({ ...d, [r.id]: gradeLabel }));
      gradedIdsRef.current.add(r.id);
      toast('客观评价已保存', { kind: 'success' });
      // 写入已确认：「全部」列表里该行立刻从「待补充」变成等第；今天 / 洞察的缓存同步修补
      patch(user.id, KEYS.recent, (list) => (list || []).map(x => (x.id === r.id ? { ...x, ...gradePayload } : x)));
      afterSessionGraded(user.id, r.id, gradePayload);
      // 稍等片刻让学生看到确认，再把已补填的行从待补填列表拿掉（连续补填时合并成一次）
      clearTimeout(pendingReloadTimer.current);
      pendingReloadTimer.current = setTimeout(() => {
        const ids = gradedIdsRef.current;
        gradedIdsRef.current = new Set();
        patch(user.id, KEYS.pending, (list) => (list || []).filter(x => !ids.has(x.id)));
        setPendingDone({});
        refreshLists();   // 后台与数据库对一次，不挡界面
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
    <div className={`yb-lg yb-lg-page animate-fade-in${classic ? ' is-classic' : ''}${inlineMode ? ' is-wide' : ''}`}>
      <div className="yb-lg-head">
        <div>
          <h1>记录</h1>
          <p>记下每一次学习，数据会帮你看清自己</p>
        </div>
        <button type="button" className="yb-btn sm" aria-haspopup="dialog" onClick={() => openNew(null)}>
          <Plus size={16} strokeWidth={2.4} aria-hidden="true" />记一下
        </button>
      </div>

      {/* ====== 顶部 Tab: 记录 / 待补填 / 成绩 ====== */}
      <div
        className="yb-seg"
        role="tablist"
        aria-label="记录分类"
        data-no-swipe
        ref={tabDrag.ref}
        onPointerDown={tabDrag.onPointerDown}
      >
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
              onClick={() => { if (!tabDrag.shouldSkipClick()) setView(t.key); }}
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

      {/* 宽屏记录页：左内嵌表单、右记录列表；切到别的 tab 时表单隐藏但保持挂载（草稿不丢） */}
      <div className={`yb-cols-new${inlineMode && view === 'record' ? ' is-split' : ''}`}>
      {inlineMode && (
        <aside
          className={`yb-inline${view !== 'record' || (sheet.forceDialog && sheet.open) ? ' is-hidden' : ''}`}
          aria-hidden={view !== 'record' || (sheet.forceDialog && sheet.open) || undefined}
        >
          <LogForm
            ref={asyncRef}
            layout="two-col"
            open={sheet.open}
            mode={sheet.mode}
            editRow={sheet.editRow}
            preset={sheet.preset}
            courses={courses}
            loadingCourses={loadingCourses}
            recent={recent}
            customForms={customForms}
            onAddCustomForm={onAddCustomForm}
            onSave={sheet.mode === 'edit' ? onSaveEdit : onSubmit}
            onClose={closeSheet}
            onCancelEdit={closeSheet}
            busy={busy}
          />
        </aside>
      )}
      <div role="tabpanel" id={`yb-panel-${view}`} aria-labelledby={`yb-tab-${view}`} style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
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
                      commitOnMove={false}
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
        /* ====== 记录视图：再记一次 + 按天分组的最近记录（旧版界面时左侧为内嵌表单） ====== */
        <div className={classic ? 'ybc-cols' : 'yb-contents'}>
          {classic && (courses.length > 0 || loadingCourses) && (
            <ClassicLogForm
              ref={classicRef}
              open={sheet.open}
              mode={sheet.mode}
              editRow={sheet.editRow}
              preset={sheet.preset}
              onCancelEdit={closeSheet}
              courses={courses}
              loadingCourses={loadingCourses}
              recent={recent}
              customForms={customForms}
              onAddCustomForm={onAddCustomForm}
              onSave={sheet.open && sheet.mode === 'edit' ? onSaveEdit : onSubmit}
              busy={busy}
            />
          )}
        <div className={classic ? 'ybc-list' : 'yb-contents'}>
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
                点「记一下」记下第一次学习。
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
                  <article
                    key={r.id}
                    className={`yb-rec ${sheet.open && sheet.mode === 'edit' && sheet.editRow?.id === r.id ? 'yb-rec--editing' : ''}`}
                    aria-current={sheet.open && sheet.mode === 'edit' && sheet.editRow?.id === r.id ? 'true' : undefined}
                  >
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
        </div>
        </div>
      )}
      </div>
      </div>

      {/* ====== 记一笔 / 编辑记录 ====== */}
      <LogSheet
        open={modalOpen}
        variant={isDialogWidth ? 'dialog' : 'sheet'}
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
