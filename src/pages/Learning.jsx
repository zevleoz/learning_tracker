import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/useAuth.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';

/* ---------- 常量定义 ---------- */

// 学习行为类别（category）— 与数据库/分析面板一致：1=学习 2=复习 3=练习
const CATEGORY_OPTS = [
  { key: 1, label: '学习' },
  { key: 2, label: '复习' },
  { key: 3, label: '练习' },
];

// 学习行为形式（预设 form，字符串；按学习行为类别分组；
// 额外的 "+其他/自定义" 通过 ADD_OTHER_SENTINEL 让用户新增，不与预设重复）
const ADD_OTHER_SENTINEL = '__ADD_OTHER__';
const FORM_PRESET_BY_CATEGORY = {
  1: ['自主预习', '校外线上', '校外线下'],                                 // 学习
  2: ['自主复习', '校外线上', '校外线下'],                                 // 复习
  3: ['自主练习', '校外线上', '校外线下', '课外作业', '学校作业'],          // 练习
};
const ALL_FORM_PRESET = Array.from(new Set(Object.values(FORM_PRESET_BY_CATEGORY).flat()));

// 主观评估 5 档
const SUBJECTIVE_STEPS = [
  { value: 20, label: '没有听课' },
  { value: 40, label: '像在听天书' },
  { value: 60, label: '有不少没掌握' },
  { value: 80, label: '基本掌握' },
  { value: 100, label: '完全掌握' },
];

// 客观评估 13 档
const OBJECTIVE_STEPS = [
  { value: 0,  label: 'F'  },
  { value: 1,  label: 'D-' },
  { value: 2,  label: 'D'  },
  { value: 3,  label: 'D+' },
  { value: 4,  label: 'C-' },
  { value: 5,  label: 'C'  },
  { value: 6,  label: 'C+' },
  { value: 7,  label: 'B-' },
  { value: 8,  label: 'B'  },
  { value: 9,  label: 'B+' },
  { value: 10, label: 'A-' },
  { value: 11, label: 'A'  },
  { value: 12, label: 'A+' },
];

// letter grade → 百分制区间（作为参考显示在客观评估下方）
const GRADE_RANGES = {
  'A+': '97–100',
  'A':  '93–96',
  'A-': '90–92',
  'B+': '87–89',
  'B':  '83–86',
  'B-': '80–82',
  'C+': '77–79',
  'C':  '73–76',
  'C-': '70–72',
  'D+': '67–69',
  'D':  '63–66',
  'D-': '60–62',
  'F':  '0–59',
};

// 成绩 tab 预设等第（仅 letter grade A+ ~ F）
const GRADE_PRESET_CHIPS = [
  'A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F',
];

const SUBJECT_COLORS = {
  '数学': { bg: 'rgba(99, 102, 241, 0.15)', text: '#4338ca', border: 'rgba(99, 102, 241, 0.3)' },
  '物理': { bg: 'rgba(34, 197, 94, 0.15)', text: '#166534', border: 'rgba(34, 197, 94, 0.3)' },
  '英语': { bg: 'rgba(249, 115, 22, 0.15)', text: '#9a3412', border: 'rgba(249, 115, 22, 0.3)' },
  '历史': { bg: 'rgba(168, 85, 247, 0.15)', text: '#7e22ce', border: 'rgba(168, 85, 247, 0.3)' },
  '化学': { bg: 'rgba(236, 72, 153, 0.15)', text: '#be185d', border: 'rgba(236, 72, 153, 0.3)' },
  '生物': { bg: 'rgba(6, 182, 212, 0.15)', text: '#0891b2', border: 'rgba(6, 182, 212, 0.3)' },
};

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function toTimeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtRecentDate(iso, timeStr) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const today = toDateStr(now);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const ds = toDateStr(d);
  const ts = timeStr ? timeStr.slice(0, 5) : toTimeStr(d);
  if (ds === today) return `今天 ${ts}`;
  if (ds === toDateStr(yest)) return `昨天 ${ts}`;
  return `${d.getMonth()+1}/${d.getDate()} ${ts}`;
}

/* ============ 渐变吸附式滑轨 GlassRail ============ */
function GlassRail({ steps, idx, onChange, disabled, labelFn }) {
  const n = steps.length;
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  // 吸附点百分比（首尾留一点空间让 thumb 不贴边）
  const pct = (i) => {
    if (n === 1) return 50;
    return (i / (n - 1)) * 100;
  };
  const label = (labelFn || ((s) => s.label))(steps[idx]);

  // 把 pointer 坐标转换为 step index
  function pointerToStep(clientX) {
    const el = trackRef.current;
    if (!el) return idx;
    const rect = el.getBoundingClientRect();
    // 轨道有效范围：padding 20px 两侧
    const usableLeft = rect.left + 20;
    const usableWidth = rect.width - 40;
    if (usableWidth <= 0) return idx;
    let ratio = (clientX - usableLeft) / usableWidth;
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.round(ratio * (n - 1));
  }

  function onPointerDown(e) {
    if (disabled) return;
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    draggingRef.current = true;
    onChange(pointerToStep(e.clientX));
  }
  function onPointerMove(e) {
    if (!draggingRef.current || disabled) return;
    onChange(pointerToStep(e.clientX));
  }
  function onPointerUp(e) {
    draggingRef.current = false;
    try { e.target.releasePointerCapture(e.pointerId); } catch {}
  }

  return (
    <div className="glass-rail">
      <div
        className="glass-rail-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: 'none' }}
      >
        {/* 吸附点 */}
        <div className="glass-rail-steps">
          {steps.map((_, i) => <span key={i} style={{ opacity: i === idx ? 1 : 0.55 }} />)}
        </div>
        {/* 隐藏的原生 input（键盘无障碍用，pointer 已由 track 接管） */}
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={idx}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {/* 绝对定位 thumb（用 SVG 绘制圆形，避免 Safari 的 CSS border-radius 泄漏问题） */}
        <div className="glass-rail-thumb-wrap">
          <div
            className="glass-rail-thumb"
            style={{ left: `${pct(idx)}%` }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ display: 'block' }}>
              <circle cx="14" cy="14" r="12" fill="#ffffff" stroke="rgba(255,255,255,0.9)" strokeWidth="2"/>
            </svg>
          </div>
        </div>
      </div>
      {/* 当前标签 tooltip（在滑轨下方居中） */}
      <div className="glass-rail-tooltip">{label}</div>
      {/* 刻度标签（可选：只在 ≤ 6 档显示） */}
      {n <= 6 && (
        <div className="glass-rail-labels">
          {steps.map((s, i) => (
            <span key={i} className={'tick' + (i === idx ? ' active' : '')}>
              {(labelFn || ((x) => x.label))(s)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ Inline Spinner（14px，用于按钮 busy 态左侧） ============ */
function Spinner({ size = 14, color = 'currentColor' }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 50 50"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <circle
        cx="25" cy="25" r="20"
        fill="none"
        stroke={color}
        strokeOpacity="0.25"
        strokeWidth="5"
      />
      <path
        d="M25 5 a20 20 0 0 1 20 20"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </motion.svg>
  );
}

/* ============ Liquid Glass Checkmark（成功/失败反馈 overlay） ============ */
function LiquidGlassFlash({ show, variant = 'success', size = 88, duration = 500, onComplete }) {
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  useEffect(() => {
    if (show) {
      setVisible(true);
      setAnimKey(k => k + 1);
      const t = setTimeout(() => {
        setVisible(false);
        onComplete && onComplete();
      }, duration);
      return () => clearTimeout(t);
    }
  }, [show]); // eslint-disable-line
  if (!show && !visible) return null;
  const isSuccess = variant === 'success';
  // 用全屏 flex 容器保证任何分辨率/横屏/软键盘弹出时都严格居中
  // dvh = 动态视口高度，随 iOS Safari 地址栏收起/展开实时更新（vh 是固定值会偏上）
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1500,
        pointerEvents: 'none',
      }}
    >
      <motion.div
        key={animKey}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        style={{
          width: size, height: size,
          borderRadius: Math.round(size * 0.26),
          background: 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${isSuccess ? 'rgba(148,163,184,0.55)' : 'rgba(254,202,202,0.9)'}`,
          boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isSuccess ? (
          <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 52 52" fill="none">
            <motion.path
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              d="M14 27 L23 36 L39 18"
              stroke="#0f172a"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 52 52" fill="none">
            <motion.g
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              stroke="#0f172a"
              strokeWidth="4.5"
              strokeLinecap="round"
            >
              <line x1="16" y1="16" x2="36" y2="36" />
              <line x1="36" y1="16" x2="16" y2="36" />
            </motion.g>
          </svg>
        )}
      </motion.div>
    </div>
  );
}

/* ============ 页面主体 ============ */
export default function LearningPage() {
  const { user } = useAuth();

  /* --- 下拉数据 --- */
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [unitId, setUnitId] = useState('');

  /* --- 学习行为形式（预设 + 自定义） --- */
  const [customForms, setCustomForms] = useState([]); // string[]
  const [formValue, setFormValue] = useState('');     // 选中的 form 名
  const [addingCustom, setAddingCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');

  /* --- 时间 --- */
  const now = new Date();
  const [dateStr, setDateStr] = useState(toDateStr(now));
  const [startStr, setStartStr] = useState(toTimeStr(now));
  const [endStr, setEndStr] = useState('');

  /* --- 学习行为类别 --- */
  const [category, setCategory] = useState(1); // 默认"学习"（1=学习 2=复习 3=练习）

  /* --- 评估方式 --- */
  // 主观：必填，始终展示
  // 客观：可选，仅"练习"(category=3)展示，可滞后填写（objDeferred=true 表示暂不填写）
  //       或标记为不适用（isObjNA=true 时 grade_label='N/A'，自动从待补填列表排除）
  const [subjIdx, setSubjIdx] = useState(3);     // 默认"基本掌握" → 80
  const [objIdx, setObjIdx] = useState(9);        // 默认 B+；展开即给默认值
  const [objDeferred, setObjDeferred] = useState(false); // 默认"现在填写"
  const [isObjNA, setIsObjNA] = useState(false);  // 客观不适用 (N/A)

  /* --- 备注 --- */
  const [notes, setNotes] = useState('');

  /* --- 错误状态 --- */
  const [errors, setErrors] = useState({});

  /* --- 提交状态 / 最近记录 --- */
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [loadingCourses, setLoadingCourses] = useState(true);

  /* --- 顶部 tab：记录 / 待补填 / 成绩 --- */
  const [view, setView] = useState('record'); // 'record' | 'pending' | 'scores'

  /* --- 待补填客观评价列表 --- */
  const [pending, setPending] = useState([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [pendingModalSession, setPendingModalSession] = useState(null); // 选中的 session
  const [pendingModalGrade, setPendingModalGrade] = useState(null);     // 选中的 grade label
  const [pendingSaving, setPendingSaving] = useState(false);

  /* --- 成绩 Tab：校内课程 + 考试成绩 --- */
  const [scoreCourses, setScoreCourses] = useState([]);   // 校内课程列表 course_type=1
  const [examScores, setExamScores] = useState([]);      // 所有 exam_scores 记录
  const [loadingScores, setLoadingScores] = useState(false);
  // 新增/编辑成绩 modal
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [scoreModalEditing, setScoreModalEditing] = useState(null);  // exam_score 对象或 null(新增)
  const [scoreModalCourseId, setScoreModalCourseId] = useState('');
  const [scoreForm, setScoreForm] = useState({ exam_name: '', exam_date: '', score: '', grade_label: '', notes: '' });
  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreDeletingId, setScoreDeletingId] = useState(null);

  /* --- Liquid Glass 成功/失败反馈 flash --- */
  const [flashState, setFlashState] = useState({ show: false, variant: 'success', size: 88, duration: 500 });
  function triggerFlash(variant = 'success', size = 88, duration = 500) {
    setFlashState({ show: true, variant, size, duration });
  }

  /* ========== 载入：课程 tree ========== */
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('school_name')
        .eq('id', user.id)
        .maybeSingle();
      const mySchool = profile?.school_name;

      const { data, error } = await supabase
        .from('courses')
        .select('id, name, subject, course_type, created_by, chapters(id, name, units(id, name))')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) { logger.error('加载课程失败:', error); toast('课程加载失败，请刷新重试', { kind: 'error' }); }
      const list = (data || []).filter(c => {
        if (c.created_by === user.id) return true;
        if (!mySchool) return false;
        return true;
      }).map(c => ({
        ...c,
        chapters: (c.chapters || []).sort((a,b)=>a.order_idx-b.order_idx)
          .map(ch => ({ ...ch, units: (ch.units || []).sort((x,y)=>x.order_idx-y.order_idx) })),
      }));
      setCourses(list);
      if (list.length) setCourseId(list[0].id);
      setLoadingCourses(false);
    })();
  }, [user]);

  /* --- 课程变化 -> 预选第一个章节 --- */
  useEffect(() => {
    const c = courses.find(x => x.id === courseId);
    if (c && c.chapters && c.chapters.length) {
      setChapterId(c.chapters[0].id);
    } else {
      setChapterId('');
    }
  }, [courseId, courses]);

  /* --- 章节变化 -> 预选第一个 unit --- */
  useEffect(() => {
    const c = courses.find(x => x.id === courseId);
    const ch = c?.chapters?.find(x => x.id === chapterId);
    if (ch && ch.units && ch.units.length) {
      setUnitId(ch.units[0].id);
    } else {
      setUnitId('');
    }
  }, [chapterId, courseId, courses]);

  const activeCourse = useMemo(() => courses.find(c => c.id === courseId), [courses, courseId]);
  const activeChapter = useMemo(() => activeCourse?.chapters?.find(c => c.id === chapterId), [activeCourse, chapterId]);

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

  /* ========== 载入：最近记录 ========== */
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, end_time, duration_minutes,
          category, form, eval_type, self_rating, grade_label, notes,
          course_id, chapter_id, unit_id,
          course:courses(id,name,subject,course_type),
          chapter:chapters(id,name),
          unit:units(id,name)
        `)
        .eq('student_id', user.id)
        .is('deleted_at', null)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) { logger.error('加载最近记录失败:', error); return; }
      setRecent(data || []);
    })();
  }, [user]);

  /* ========== 载入：待补填客观评价列表（练习类 + 无客观） ========== */
  const loadPending = async () => {
    if (!user) return;
    setLoadingPending(true);
    try {
      const { data, error } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, end_time, duration_minutes,
          category, form, eval_type, self_rating, grade_label, notes,
          course:courses(id,name,subject,course_type),
          chapter:chapters(id,name),
          unit:units(id,name)
        `)
        .eq('student_id', user.id)
        .eq('category', 3)            // 练习
        .is('grade_label', null)      // 无 letter grade
        .is('score', null)            // 也无分数（排除旧 seed 数据）
        .is('deleted_at', null)
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
        triggerFlash('failure', 92, 450);
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
      triggerFlash('success', 92, 500);
      closeScoreModal();
      await loadScores();
    } catch (e) {
      logger.error('[saveScore] failed:', JSON.stringify(e, null, 2));
      const msg = friendlyErr(e, '保存失败');
      toast(msg, { kind: 'error', duration: 6000 });
      triggerFlash('failure', 92, 450);
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

  /* ========== 添加自定义 学习行为形式 ========== */
  async function onAddCustomForm() {
    const name = customInput.trim();
    if (!name) return;
    if (ALL_FORM_PRESET.includes(name) || customForms.includes(name)) {
      setFormValue(name);
      setAddingCustom(false);
      setCustomInput('');
      return;
    }
    try {
      const { error } = await supabase.from('user_learning_forms').insert({
        student_id: user.id, name,
      });
      if (error) throw error;
      setCustomForms([name, ...customForms]);
      setFormValue(name);
      setAddingCustom(false);
      setCustomInput('');
    } catch (e) {
      toast(e.message || '保存失败', { kind: 'error' });
    }
  }

  /* ========== 计算用时（分钟） ========== */
  function computeDuration() {
    if (!startStr || !endStr) return null;
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    if ([sh,sm,eh,em].some(Number.isNaN)) return null;
    let mins = (eh*60+em) - (sh*60+sm);
    if (mins <= 0) mins += 24*60;       // 跨午夜
    return mins;
  }

  /* ========== 提交 ========== */
  async function onSubmit(e) {
    e.preventDefault();
    setErrors({});

    const newErrors = {};
    if (!courseId) newErrors.course = '请选择课程';
    if (!startStr || !endStr) newErrors.time = '请填写开始和结束时间';
    if (!formValue) newErrors.form = '请选择学习行为形式';

    const duration = computeDuration();
    if ((startStr && endStr) && (!duration || duration <= 0)) {
      newErrors.time = '结束时间需晚于开始时间';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const newStartTime = startStr + ':00';
    const newEndTime = endStr + ':00';

    setBusy(true);
    try {
      const { data: conflicts, error: conflictError } = await supabase
        .from('learning_sessions')
        .select('id, start_time, end_time')
        .eq('student_id', user.id)
        .eq('session_date', dateStr)
        .is('deleted_at', null)
        .lt('start_time', newEndTime)
        .gt('end_time', newStartTime);

      if (conflictError) throw conflictError;
      if (conflicts && conflicts.length > 0) {
        const conflict = conflicts[0];
        newErrors.time = `该时间段已有学习记录（${conflict.start_time} - ${conflict.end_time}）`;
        setErrors(newErrors);
        setBusy(false);
        return;
      }

      const hasObjective = !objDeferred && (isObjNA || objIdx !== null);
      const gradeLabelValue = isObjNA ? 'N/A' : (!objDeferred && objIdx !== null ? OBJECTIVE_STEPS[objIdx].label : null);
      const payload = {
        student_id: user.id,
        course_id: courseId,
        chapter_id: chapterId || null,
        unit_id: unitId || null,
        category,
        form: formValue,
        eval_type: hasObjective ? 2 : 1,  // 1=仅主观 / 2=含客观 (含 N/A)
        duration_minutes: duration,
        notes: notes.trim() || null,
        session_date: dateStr,
        start_time: newStartTime,
        end_time: newEndTime,
        self_rating: SUBJECTIVE_STEPS[subjIdx].value,  // 始终写入
        grade_label: gradeLabelValue,
      };

      const { error } = await supabase.from('learning_sessions').insert(payload);
      if (error) throw error;

      toast('记录已保存', { kind: 'success' });
      triggerFlash('success', 88, 480);

      const d = new Date();
      setStartStr(toTimeStr(d));
      setEndStr('');
      setNotes('');
      setSubjIdx(3);
      setObjIdx(9);
      setObjDeferred(false);
      setIsObjNA(false);

      const { data } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, end_time, duration_minutes,
          category, form, eval_type, self_rating, grade_label, notes,
          course:courses(id,name,subject,course_type),
          chapter:chapters(id,name),
          unit:units(id,name)
        `)
        .eq('student_id', user.id)
        .is('deleted_at', null)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
      setRecent(data || []);
      await loadPending();
    } catch (err) {
      let msg = err.message || '保存失败';
      if (msg.includes('row-level security')) {
        msg = '权限不足：您只能操作自己的学习记录。';
      } else if (msg.includes('self_rating') || msg.includes('not-null') || msg.includes('constraint')) {
        msg = '数据库配置需要更新';
      }
      toast(msg, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  /* ========== 编辑现有记录 ========== */
  function onStartEdit(r) {
    setEditingSessionId(r.id);
    setCourseId(r.course_id);
    const course = (courses || []).find(c => c.id === r.course_id);
    const chapter = (course?.chapters || []).find(ch => ch.id === r.chapter_id);
    if (chapter) setChapterId(chapter.id);
    if (chapter?.units?.length) setUnitId(chapter.units[0].id);
    if (r.unit_id) setUnitId(r.unit_id);

    setDateStr(String(r.session_date || toDateStr(new Date())));
    setStartStr(String(r.start_time || toTimeStr(new Date())).slice(0, 5));
    setEndStr(String(r.end_time || '').slice(0, 5));
    setCategory(r.category || 1);
    setFormValue(r.form || '');
    // 主观：始终回显
    const subjIdxLoaded = SUBJECTIVE_STEPS.findIndex(s => s.value === r.self_rating);
    setSubjIdx(subjIdxLoaded >= 0 ? subjIdxLoaded : 3);
    // 客观：按字段存在性独立回显（不依赖 eval_type）
    if (r.grade_label === 'N/A') {
      setIsObjNA(true);
      setObjIdx(9);
      setObjDeferred(false);
    } else if (r.grade_label) {
      setIsObjNA(false);
      const objIdxLoaded = OBJECTIVE_STEPS.findIndex(s => s.label === r.grade_label);
      setObjIdx(objIdxLoaded >= 0 ? objIdxLoaded : 9);
      setObjDeferred(false);
    } else {
      setIsObjNA(false);
      setObjIdx(9);
      setObjDeferred(false);  // 编辑时也默认"现在填写"，让学生看到滑轨
    }
    setNotes(r.notes || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onCancelEdit() {
    setEditingSessionId(null);
    const d = new Date();
    setDateStr(toDateStr(d));
    setStartStr(toTimeStr(d));
    setEndStr('');
    setCategory(1);
    setFormValue('');
    setSubjIdx(3);
    setObjIdx(9);
    setObjDeferred(false);
    setIsObjNA(false);
    setNotes('');
  }

  async function onSaveEdit() {
    setErrors({});

    const newErrors = {};
    if (!courseId) newErrors.course = '请选择课程';
    if (!startStr || !endStr) newErrors.time = '请填写开始和结束时间';
    if (!formValue) newErrors.form = '请选择学习行为形式';

    const duration = computeDuration();
    if ((startStr && endStr) && (!duration || duration <= 0)) {
      newErrors.time = '结束时间需晚于开始时间';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const newStartTime = startStr + ':00';
    const newEndTime = endStr + ':00';

    setBusy(true);
    try {
      const { data: conflicts, error: conflictError } = await supabase
        .from('learning_sessions')
        .select('id, start_time, end_time')
        .eq('student_id', user.id)
        .eq('session_date', dateStr)
        .is('deleted_at', null)
        .neq('id', editingSessionId)
        .lt('start_time', newEndTime)
        .gt('end_time', newStartTime);

      if (conflictError) throw conflictError;
      if (conflicts && conflicts.length > 0) {
        const conflict = conflicts[0];
        newErrors.time = `该时间段已有学习记录（${conflict.start_time} - ${conflict.end_time}）`;
        setErrors(newErrors);
        setBusy(false);
        return;
      }

      const hasObjective = !objDeferred && (isObjNA || objIdx !== null);
      const gradeLabelValue = isObjNA ? 'N/A' : (!objDeferred && objIdx !== null ? OBJECTIVE_STEPS[objIdx].label : null);
      const payload = {
        course_id: courseId,
        chapter_id: chapterId || null,
        unit_id: unitId || null,
        category,
        form: formValue,
        eval_type: hasObjective ? 2 : 1,  // 1=仅主观 / 2=含客观 (含 N/A)
        duration_minutes: duration,
        notes: notes.trim() || null,
        session_date: dateStr,
        start_time: newStartTime,
        end_time: newEndTime,
        self_rating: SUBJECTIVE_STEPS[subjIdx].value,  // 始终写入
        grade_label: gradeLabelValue,
      };

      const { error } = await supabase
        .from('learning_sessions')
        .update(payload)
        .eq('id', editingSessionId);
      if (error) {
        logger.error('Update session error:', error);
        throw error;
      }
      toast('已更新', { kind: 'success' });
      triggerFlash('success', 88, 480);

      const { data } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, end_time, duration_minutes,
          category, form, eval_type, self_rating, grade_label, notes,
          course_id, chapter_id, unit_id,
          course:courses(id,name,subject,course_type),
          chapter:chapters(id,name),
          unit:units(id,name)
        `)
        .eq('student_id', user.id)
        .is('deleted_at', null)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
      setRecent(data || []);
      setEditingSessionId(null);
      await loadPending();
    } catch (err) {
      let msg = err.message || '保存失败';
      if (msg.includes('row-level security')) {
        msg = '权限不足：您只能操作自己的学习记录。';
      }
      toast(msg, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  /* ========== 删除（软删除）========== */
  function onDeleteClick(r) {
    setDeletingId(r.id);
  }

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

  function onCancelDelete() {
    setDeletingId(null);
  }

  /* ========== helper 渲染 ========== */
  // 预设列表按学习行为类别切换；用户自定义项在任意类别下都可选择
  const currentPreset = FORM_PRESET_BY_CATEGORY[category] || FORM_PRESET_BY_CATEGORY[1];
  const customForCategory = customForms.filter(n => !ALL_FORM_PRESET.includes(n));
  const formOptions = [...currentPreset, ...customForCategory];

  // 当学习行为类别改变时，如果当前 formValue 不在新列表里，就清空，避免提交时漏选
  useEffect(() => {
    if (formValue && !formOptions.includes(formValue)) setFormValue('');
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps
  const catLabel = (k) => CATEGORY_OPTS.find(c => c.key === k)?.label || '';
  const autoDur = computeDuration();

  /* ========== 待补填：一键保存客观评价 ========== */
  async function onSavePendingGrade() {
    if (!pendingModalSession || !pendingModalGrade) return;
    setPendingSaving(true);
    try {
      const { error } = await supabase
        .from('learning_sessions')
        .update({
          grade_label: pendingModalGrade,
          eval_type: 2,  // 含客观
        })
        .eq('id', pendingModalSession.id);
      if (error) throw error;
      toast('客观评价已保存', { kind: 'success' });
      triggerFlash('success', 108, 750);
      await new Promise(r => setTimeout(r, 750));
      setPendingModalSession(null);
      setPendingModalGrade(null);
      await loadPending();  // 刷新待补填列表
    } catch (err) {
      let msg = err.message || '保存失败';
      if (msg.includes('row-level security')) {
        msg = '权限不足：您只能操作自己的学习记录。';
      }
      toast(msg, { kind: 'error' });
      triggerFlash('failure', 108, 500);
    } finally {
      setPendingSaving(false);
    }
  }

  /* ========== JSX ========== */
  return (
    <>
    <div className="learn-wrap animate-fade-in">

      <div className="page-title">
        <h1>记录</h1>
        <p>填写一次学习行为，数据积累帮你了解自己</p>
      </div>

      {/* ====== 顶部 Tab: 记录 / 待补填 / 成绩 ====== */}
      <div className="seg-tabs">
        <button
          type="button"
          className={'seg-tab' + (view === 'record' ? ' active' : '')}
          onClick={() => setView('record')}
        >记录</button>
        <button
          type="button"
          className={'seg-tab' + (view === 'pending' ? ' active' : '')}
          onClick={() => setView('pending')}
        >
          待补填
          {pending.length > 0 && (
            <span className="seg-tab-badge">{pending.length}</span>
          )}
        </button>
        <button
          type="button"
          className={'seg-tab' + (view === 'scores' ? ' active' : '')}
          onClick={() => setView('scores')}
        >
          成绩
          {examScores.length > 0 && (
            <span className="seg-tab-badge">{examScores.length}</span>
          )}
        </button>
      </div>

      {view === 'scores' ? (
        /* ====== 成绩视图 ====== */
        <div className="scores-section">
          {loadingScores ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>
              加载中…
            </div>
          ) : scoreCourses.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '50px 24px',
              color: '#94a3b8', fontSize: 13, lineHeight: 1.7,
            }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                还没有校内课程
              </div>
              <div style={{ marginBottom: 16 }}>
                先在「课表」页面创建勾选「校内课程」的课程，
                <br/>这里就会自动出现，可以自由记录考试成绩。
              </div>
              <a href="/syllabus" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
                去创建课程
              </a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {scoreCourses.map(c => {
                const scores = examScores.filter(s => s.course_id === c.id);
                return (
                  <div key={c.id} className="glass-sheet" style={{ padding: '16px 16px 14px' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 10,
                    }}>
                      <div style={{
                        fontSize: 15, fontWeight: 700, color: '#0f172a',
                      }}>{c.name}</div>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        padding: '3px 8px', borderRadius: 999,
                        background: 'rgba(15,23,42,0.05)', color: '#475569',
                      }}>
                        已记录 {scores.length} 次
                      </span>
                    </div>
                    {scores.length === 0 ? (
                      <div style={{
                        fontSize: 12, color: '#94a3b8', textAlign: 'center',
                        padding: '18px 0 4px',
                      }}>
                        还没有成绩记录
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
                        {scores.map(s => (
                          <div key={s.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: 'rgba(15,23,42,0.02)',
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: 13, fontWeight: 700, color: '#0f172a',
                                }}>{s.exam_name}</span>
                                <span style={{
                                  fontSize: 11, color: '#94a3b8',
                                  fontFamily: 'ui-monospace, monospace',
                                }}>{String(s.exam_date || '').slice(5)}</span>
                              </div>
                              {(s.score != null || s.grade_label) && (
                                <div style={{
                                  marginTop: 2, fontSize: 13, fontWeight: 600,
                                  color: '#0f172a',
                                  fontFamily: 'ui-monospace, monospace', tabularNums: true,
                                }}>
                                  {s.score != null && `${s.score} 分`}
                                  {s.score != null && s.grade_label ? ' · ' : ''}
                                  {s.grade_label}
                                </div>
                              )}
                              {s.notes && (
                                <div style={{ marginTop: 3, fontSize: 11, color: '#64748b' }}>
                                  {s.notes}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              {scoreDeletingId === s.id ? (
                                <>
                                  <button
                                    onClick={() => deleteScore(s)}
                                    title="确认删除"
                                    style={{
                                      padding: '4px 8px', fontSize: 11, fontWeight: 600,
                                      border: 'none', borderRadius: 6,
                                      background: '#fee2e2', color: '#b91c1c',
                                      cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                  >确认</button>
                                  <button
                                    onClick={() => setScoreDeletingId(null)}
                                    title="取消"
                                    style={{
                                      padding: '4px 8px', fontSize: 11, fontWeight: 600,
                                      border: '1px solid #e2e8f0', borderRadius: 6,
                                      background: '#fff', color: '#475569',
                                      cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                  >取消</button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => openScoreModal(c.id, s)}
                                    title="编辑"
                                    style={{
                                      padding: '4px 8px', fontSize: 11, fontWeight: 600,
                                      border: '1px solid #e2e8f0', borderRadius: 6,
                                      background: '#fff', color: '#475569',
                                      cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                  >编辑</button>
                                  <button
                                    onClick={() => setScoreDeletingId(s.id)}
                                    title="删除"
                                    style={{
                                      padding: '4px 8px', fontSize: 11, fontWeight: 600,
                                      border: '1px solid #e2e8f0', borderRadius: 6,
                                      background: '#fff', color: '#94a3b8',
                                      cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                  >删除</button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => openScoreModal(c.id, null)}
                      style={{
                        marginTop: 8,
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: 12, fontWeight: 600,
                        border: '1px dashed #cbd5e1',
                        borderRadius: 8,
                        background: '#fafafa',
                        color: '#475569',
                        cursor: 'pointer',
                        transition: 'all 160ms ease',
                        fontFamily: 'inherit',
                      }}
                    >
                      + 新增成绩
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : view === 'pending' ? (
        /* ====== 待补填视图 ====== */
        <div className="pending-section">
          {loadingPending ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>
              加载中…
            </div>
          ) : pending.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '40px 20px',
              color: '#94a3b8', fontSize: 13,
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              暂无待补填的客观评价
            </div>
          ) : (
            <div className="recent-list">
              {pending.map(r => (
                <div
                  key={r.id}
                  className="record-card"
                  onClick={() => {
                    setPendingModalSession(r);
                    setPendingModalGrade(null);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="record-card__info">
                    <div className="record-card__course">
                      {r.course?.name || '-'}
                      <span className="record-card__subject" style={{ color: r.course?.course_type === 2 ? '#f59e0b' : '#64748b' }}>
                        {r.course?.course_type === 2 ? '校外' : '校内'}
                      </span>
                    </div>
                    <div className="record-card__path">{r.chapter?.name || '-'} · {r.unit?.name || '-'}</div>
                    <div className="record-card__tags">
                      <span className="record-tag record-tag--form">{r.form}</span>
                      {r.self_rating != null && (
                        <span className="record-tag record-tag--eval">
                          主观：{SUBJECTIVE_STEPS.find(s => s.value === r.self_rating)?.label || '-'}
                        </span>
                      )}
                      <span className="record-tag record-tag--eval" style={{ color: '#94a3b8' }}>
                        客观：待补充 ›
                      </span>
                    </div>
                  </div>
                  <div className="record-card__top-right">
                    <div className="record-card__time">{fmtRecentDate(r.session_date, r.start_time)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ====== 记录视图（表单 + 最近记录）====== */
        <>
      {courses.length > 0 && (
        <div className="quick-actions">
          <div className="quick-actions-label">快速记录</div>
          <div className="quick-actions-grid">
            {courses.slice(0, 6).map((course) => (
              <button
                key={course.id}
                className="quick-action-btn"
                onClick={() => {
                  setCourseId(course.id);
                  setStartStr(toTimeStr(new Date()));
                  setCategory(1);  // 学习
                  setFormValue('自主预习');
                  setObjIdx(9);
                  setObjDeferred(false);
                  setIsObjNA(false);
                }}
              >
                <span className="quick-action-course">{course.name}</span>
                <span className="quick-action-form">自主预习</span>
              </button>
            ))}
            {courses.length > 6 && (
              <button
                className="quick-action-btn quick-action-more"
                onClick={() => {
                  if (courses.length > 6) {
                    setCourseId(courses[6].id);
                  }
                  setStartStr(toTimeStr(new Date()));
                }}
              >
                <span className="quick-action-course">更多课程</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ====== 表单卡片 ====== */}
      <div className="glass-sheet record-sheet">
        {editingSessionId && (
          <div className="edit-indicator">
            <span className="edit-indicator-icon">编辑</span>
            <span className="edit-indicator-text">编辑中</span>
            <button className="edit-indicator-close" onClick={onCancelEdit}>✕</button>
          </div>
        )}

        {loadingCourses ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <span>加载课程中…</span>
          </div>
        ) : courses.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <h3>还没有课程</h3>
            <p>需要先创建课程大纲，才能记录学习行为。</p>
            <a href="/syllabus" className="btn btn-primary btn-sm" style={{ marginTop: 12, textDecoration: 'none' }}>
              去创建课程
            </a>
          </div>
        ) : (
          <>
            {/* ---- 1) 课程 / 章节 / 单元 ---- */}
            <div className="rec-block">
              <div className="rec-label">课程 / 章节 / 单元</div>
              <div className="three-col three-col-stay">
                <div className="field">
                  <label>课程</label>
                  <select className={`input input-strong ${errors.course ? 'input-error' : ''}`}
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    disabled={busy}>
                    <option value="">请选择</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {errors.course && <span className="field-error">{errors.course}</span>}
                </div>

                <div className="field">
                  <label>章节 <span className="field-optional">可选</span></label>
                  <select className="input input-strong"
                    value={chapterId}
                    onChange={(e) => setChapterId(e.target.value)}
                    disabled={busy || !activeCourse}>
                    <option value="">{activeCourse ? '不选' : '先选课程'}</option>
                    {activeCourse?.chapters?.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                  </select>
                </div>

                <div className="field">
                  <label>单元 <span className="field-optional">可选</span></label>
                  <select className="input input-strong"
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    disabled={busy || !activeChapter}>
                    <option value="">{activeChapter ? '不选' : '先选章节'}</option>
                    {activeChapter?.units?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* ---- 2) 日期 + 开始/结束时间 ---- */}
            <div className="rec-block">
              <div className="rec-label">时间</div>
              <div className="three-col three-col-stay">
                <div className="field">
                  <label>日期</label>
                  <input type="date" className="input input-strong"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    disabled={busy} />
                </div>
                <div className="field">
                  <label>开始</label>
                  <input type="time" className={`input input-strong ${errors.time ? 'input-error' : ''}`}
                    value={startStr}
                    onChange={(e) => setStartStr(e.target.value)}
                    disabled={busy} />
                </div>
                <div className="field">
                  <label>结束</label>
                  <input type="time" className={`input input-strong ${errors.time ? 'input-error' : ''}`}
                    value={endStr}
                    onChange={(e) => setEndStr(e.target.value)}
                    disabled={busy} />
                </div>
              </div>
              {errors.time && <span className="field-error">{errors.time}</span>}
              {autoDur ? (
                <div className="rec-hint">系统自动记录用时：<b>{autoDur}</b> 分钟</div>
              ) : (
                <div className="rec-hint rec-hint-dim">填写开始和结束后自动计算用时</div>
              )}
              <div className="duration-shortcuts">
                <span className="duration-shortcuts-label">快速设置时长：</span>
                {[30, 45, 60, 90, 120].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    className="duration-shortcut-btn"
                    onClick={() => {
                      if (!startStr) return;
                      const [h, m] = startStr.split(':').map(Number);
                      const total = h * 60 + m + mins;
                      const nh = Math.floor(total / 60) % 24;
                      const nm = total % 60;
                      setEndStr(`${pad(nh)}:${pad(nm)}`);
                    }}
                    disabled={busy || !startStr}
                  >
                    {mins}分钟
                  </button>
                ))}
              </div>
            </div>

            {/* ---- 3) 学习行为类别 ---- */}
            <div className="rec-block">
              <div className="rec-label">学习行为类别</div>
              <div className="btn-row">
                {CATEGORY_OPTS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className={'seg-btn' + (category === opt.key ? ' active' : '')}
                    onClick={() => setCategory(opt.key)}
                    disabled={busy}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ---- 4) 学习行为形式 ---- */}
            <div className="rec-block">
              <div className="rec-label">学习行为形式</div>
              {!addingCustom ? (
                <>
                  <select className={`input input-strong ${errors.form ? 'input-error' : ''}`}
                    value={formValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === ADD_OTHER_SENTINEL) { setAddingCustom(true); return; }
                      setFormValue(v);
                    }}
                    disabled={busy}>
                    <option value="">请选择</option>
                    {formOptions.map(n => <option key={n} value={n}>{n}</option>)}
                    <option value={ADD_OTHER_SENTINEL}>＋ 其他 / 自定义…</option>
                  </select>
                  {errors.form && <span className="field-error">{errors.form}</span>}
                </>
              ) : (
                <div className="custom-add-row">
                  <input type="text" className="input input-strong"
                    placeholder="填写一个新的形式名称，如：家教辅导"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    disabled={busy}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddCustomForm(); } }}
                  />
                  <button type="button" className="btn btn-ghost" onClick={onAddCustomForm} disabled={busy}>添加</button>
                  <button type="button" className="btn btn-ghost btn-ghost-dim" onClick={() => { setAddingCustom(false); setCustomInput(''); }} disabled={busy}>取消</button>
                </div>
              )}
            </div>

            {/* ---- 5) 主观评估（必填）---- */}
            <div className="rec-block">
              <div className="rec-label">
                主观评估
                <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>* 必填</span>
              </div>
              <GlassRail
                steps={SUBJECTIVE_STEPS}
                idx={subjIdx}
                onChange={setSubjIdx}
                disabled={busy}
              />
            </div>

            {/* ---- 5b) 客观评估（仅练习类，可选/可滞后）---- */}
            {category === 3 && (
              <div className="rec-block">
                <div className="rec-label">
                  客观评估
                  <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>（可选）</span>
                </div>
                {/* iOS-style segmented control: 现在填写 / 稍后补充 */}
                <div className="eval-seg" role="tablist" style={{
                  display: 'inline-flex',
                  background: 'rgba(15,23,42,0.05)',
                  borderRadius: 10,
                  padding: 2,
                  marginBottom: 10,
                  position: 'relative',
                }}>
                  <button
                    type="button"
                    onClick={() => { setObjDeferred(false); setIsObjNA(false); }}
                    disabled={busy}
                    style={{
                      flex: 1, padding: '6px 14px', fontSize: 12, fontWeight: 600,
                      border: 'none', borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer',
                      background: !objDeferred ? '#fff' : 'transparent',
                      color: !objDeferred ? '#0f172a' : '#94a3b8',
                      boxShadow: !objDeferred ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
                      transition: 'all 160ms ease',
                      fontFamily: 'inherit',
                    }}
                  >现在填写</button>
                  <button
                    type="button"
                    onClick={() => { setObjDeferred(true); setIsObjNA(false); }}
                    disabled={busy}
                    style={{
                      flex: 1, padding: '6px 14px', fontSize: 12, fontWeight: 600,
                      border: 'none', borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer',
                      background: objDeferred ? '#fff' : 'transparent',
                      color: objDeferred ? '#0f172a' : '#94a3b8',
                      boxShadow: objDeferred ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
                      transition: 'all 160ms ease',
                      fontFamily: 'inherit',
                    }}
                  >稍后补充</button>
                </div>
                {!objDeferred && (
                  <>
                    <GlassRail
                      steps={OBJECTIVE_STEPS}
                      idx={objIdx}
                      onChange={(v) => { setObjIdx(v); setIsObjNA(false); }}
                      disabled={busy || isObjNA}
                    />
                    <div className="grade-legend" style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'rgba(99,102,241,0.05)',
                      border: '1px solid rgba(99,102,241,0.18)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, minmax(0,1fr))',
                      rowGap: 4,
                      columnGap: 10,
                      fontSize: 12,
                      color: '#334155',
                      opacity: isObjNA ? 0.45 : 1,
                      transition: 'opacity 160ms ease',
                    }}>
                      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                        letter grade 对应的百分制区间（参考）
                      </div>
                      {['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'].map(g => (
                        <div key={g} style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          padding: '2px 4px',
                          background: g === OBJECTIVE_STEPS[objIdx]?.label && !isObjNA
                            ? 'rgba(99,102,241,0.18)'
                            : 'transparent',
                          borderRadius: 6,
                        }}>
                          <span style={{ fontWeight: 700, color: g === OBJECTIVE_STEPS[objIdx]?.label && !isObjNA ? '#4338ca' : '#475569' }}>
                            {g}
                          </span>
                          <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                            {GRADE_RANGES[g]}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* NA: 与正常分值轻微区分（灰色描边 + 斜体）*/}
                    <button
                      type="button"
                      onClick={() => setIsObjNA(!isObjNA)}
                      disabled={busy}
                      style={{
                        marginTop: 10,
                        width: '100%',
                        padding: '10px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        fontStyle: 'italic',
                        border: isObjNA ? '1.5px solid #94a3b8' : '1px solid #e2e8f0',
                        borderRadius: 10,
                        background: isObjNA ? '#f1f5f9' : '#f8fafc',
                        color: '#64748b',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        transition: 'all 160ms ease',
                        fontFamily: 'inherit',
                      }}
                    >
                      {isObjNA ? '✓ Not Applicable（不适用）' : 'Not Applicable（不适用）'}
                    </button>
                  </>
                )}
                {objDeferred && (
                  <div style={{
                    padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(99,102,241,0.05)',
                    border: '1px dashed rgba(99,102,241,0.25)',
                    fontSize: 12, color: '#64748b',
                  }}>
                    已选择稍后补充。可在顶部「待补填」标签页一键补填客观评价。
                  </div>
                )}
              </div>
            )}

            {/* ---- 6) 备注 ---- */}
            <div className="rec-block">
              <div className="rec-label">备注</div>
              <textarea
                rows="3"
                className="input input-strong"
                placeholder={category === 3 && !objDeferred
                  ? "这次分数的解释：比如这次考试的哪一部分丢分最多？是知识点没掌握、审题粗心、时间分配不合理，还是题目本身偏难？下次可以通过什么方式改进？"
                  : "关于这次学习，你想记录的补充说明：例如自己的专注度如何？有哪些点掌握了，哪些还需要再巩固？学习过程中出现的问题或感悟？"}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
              />
            </div>

            {/* ---- 提交 ---- */}
            {editingSessionId ? (
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button type="button" className="btn btn-primary btn-submit" onClick={onSaveEdit} disabled={busy}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {busy && <Spinner color="#ffffff" />}
                    {busy ? '保存中…' : '保存修改'}
                  </span>
                </button>
                <button type="button" className="btn btn-ghost btn-submit" onClick={onCancelEdit} disabled={busy}>
                  取消编辑
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-submit" onClick={onSubmit} disabled={busy}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {busy && <Spinner color="#ffffff" />}
                  {busy ? '保存中…' : '保存记录'}
                </span>
              </button>
            )}
          </>
        )}
      </div>

      {/* ====== 最近记录 ====== */}
      <div className="recent-section">
        <div className="recent-header">
          <h2 className="recent-title">最近记录</h2>
          <span className="recent-count">{recent.length} 条</span>
        </div>
        {recent.length === 0 ? (
          <div className="recent-empty">还没有记录，从上面的表单开始吧</div>
        ) : (
          <div className="recent-list">
            {recent.map(r => (
              <div 
                key={r.id} 
                className={`record-card ${editingSessionId === r.id ? 'record-card--editing' : ''}`}
              >
                <div className="record-card__info">
                  <div className="record-card__course">
                    {r.course?.name || '-'}
                    <span className="record-card__subject" style={{ color: r.course?.course_type === 2 ? '#f59e0b' : '#64748b' }}>
                      {r.course?.course_type === 2 ? '校外' : '校内'}
                    </span>
                  </div>
                  <div className="record-card__path">{r.chapter?.name || '-'} · {r.unit?.name || '-'}</div>
                  <div className="record-card__tags">
                    <span className="record-tag record-tag--category">{catLabel(r.category)}</span>
                    <span className="record-tag record-tag--form">{r.form}</span>
                    {r.self_rating != null && (
                      <span className="record-tag record-tag--eval">
                        主观：{SUBJECTIVE_STEPS.find(s => s.value === r.self_rating)?.label || '-'}
                      </span>
                    )}
                    {r.grade_label && (
                      <span className="record-tag record-tag--eval"
                        style={r.grade_label === 'N/A' ? { color: '#94a3b8', fontStyle: 'italic' } : undefined}>
                        客观：{r.grade_label}
                      </span>
                    )}
                    {r.category === 3 && !r.grade_label && (
                      <span className="record-tag record-tag--eval" style={{ color: '#94a3b8' }}>
                        客观：待补充
                      </span>
                    )}
                  </div>
                  {r.notes && <div className="record-card__notes">{r.notes}</div>}
                </div>
                <div className="record-card__top-right">
                  <div className="record-card__time">{fmtRecentDate(r.session_date, r.start_time)}</div>
                  <div className="record-card__actions">
                    <button className="record-action-btn" onClick={() => onStartEdit(r)} title="编辑">
                      <Pencil size={14} strokeWidth={2} />
                    </button>
                    {deletingId === r.id ? (
                      <div className="record-delete-confirm">
                        <button className="record-action-btn record-action-btn--confirm" onClick={() => onConfirmDelete(r)} title="确认删除">
                          ✓
                        </button>
                        <button className="record-action-btn record-action-btn--cancel" onClick={onCancelDelete} title="取消">
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button className="record-action-btn record-action-btn--delete" onClick={() => onDeleteClick(r)} title="删除">
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="record-card__duration">
                  <span className="record-card__duration-num">{r.duration_minutes}</span>
                  <span className="record-card__duration-unit">分钟</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}
      </div>

      {/* ====== 待补填客观评价 Modal（createPortal 到 document.body，彻底绕开父级 transform 干扰） ====== */}
      {createPortal(
        <AnimatePresence>
        {pendingModalSession && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => { setPendingModalSession(null); setPendingModalGrade(null); }}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(15,23,42,0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px 16px',
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#fff',
                borderRadius: 16,
                boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
                width: '100%', maxWidth: 420,
                maxHeight: '85vh',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
            {/* 标题区 */}
            <div style={{
              padding: '16px 20px 14px',
              borderBottom: '1px solid #f1f5f9',
            }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>选择客观评价</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                {pendingModalSession.course?.name || '-'}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                {pendingModalSession.form} · {String(pendingModalSession.session_date || '').slice(5)}
              </div>
            </div>
            {/* Grade 网格 */}
            <div style={{
              padding: '16px 20px 0',
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
            }}>
              {OBJECTIVE_STEPS.map(s => {
                const selected = pendingModalGrade === s.label;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setPendingModalGrade(s.label)}
                    style={{
                      padding: '12px 0',
                      fontSize: 16, fontWeight: 700,
                      border: selected ? '1.5px solid #4338ca' : '1px solid #e2e8f0',
                      borderRadius: 10,
                      background: selected ? 'rgba(99,102,241,0.12)' : '#fff',
                      color: selected ? '#4338ca' : '#0f172a',
                      cursor: 'pointer',
                      transition: 'all 120ms ease',
                      fontFamily: 'inherit',
                    }}
                  >
                    {s.label}
                    <div style={{ fontSize: 10, fontWeight: 400, color: '#94a3b8', marginTop: 2 }}>
                      {GRADE_RANGES[s.label]}
                    </div>
                  </button>
                );
              })}
            </div>
            {/* NA 独立按钮 */}
            <div style={{ padding: '10px 20px 0' }}>
              <button
                type="button"
                onClick={() => setPendingModalGrade('N/A')}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  fontSize: 15,
                  fontWeight: 600,
                  fontStyle: 'italic',
                  border: pendingModalGrade === 'N/A' ? '1.5px solid #94a3b8' : '1px solid #e2e8f0',
                  borderRadius: 10,
                  background: pendingModalGrade === 'N/A' ? '#f1f5f9' : '#f8fafc',
                  color: '#64748b',
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                  fontFamily: 'inherit',
                }}
              >
                Not Applicable（不适用）
              </button>
            </div>
            {/* 保存按钮 */}
            <div style={{
              padding: '12px 20px 20px',
              borderTop: '1px solid #f1f5f9',
              flexShrink: 0,
            }}>
              <button
                type="button"
                onClick={onSavePendingGrade}
                disabled={!pendingModalGrade || pendingSaving}
                style={{
                  width: '100%',
                  padding: '14px 0',
                  fontSize: 14, fontWeight: 700,
                  border: 'none',
                  borderRadius: 12,
                  background: pendingModalGrade && !pendingSaving ? '#0f172a' : '#e2e8f0',
                  color: pendingModalGrade && !pendingSaving ? '#fff' : '#94a3b8',
                  cursor: pendingModalGrade && !pendingSaving ? 'pointer' : 'not-allowed',
                  transition: 'all 160ms ease',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {pendingSaving && <Spinner color={pendingModalGrade ? '#ffffff' : '#94a3b8'} />}
                  {pendingSaving ? '保存中…' : '保存客观评价'}
                </span>
              </button>
            </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body
      )}

      {/* ====== 成绩新增/编辑 Modal ====== */}
      {createPortal(
        <AnimatePresence>
        {scoreModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeScoreModal}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(15,23,42,0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px 16px',
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#fff',
                borderRadius: 16,
                boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
                width: '100%', maxWidth: 420,
                maxHeight: '85vh',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div style={{
                padding: '16px 20px 14px',
                borderBottom: '1px solid #f1f5f9',
              }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>
                  {scoreModalEditing ? '编辑成绩' : '新增成绩'}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                  {scoreCourses.find(c => c.id === scoreModalCourseId)?.name || '-'}
                </div>
              </div>
              <div style={{
                padding: '16px 20px 12px',
                overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6,
                  }}>考试名称 <span style={{ color: '#ef4444' }}>*</span></div>
                  <input
                    type="text"
                    value={scoreForm.exam_name}
                    onChange={(e) => setScoreForm({ ...scoreForm, exam_name: e.target.value })}
                    placeholder="如：期末考试、月考、单元测"
                    className="input input-strong"
                    style={{ fontSize: 13 }}
                    disabled={scoreSaving}
                  />
                </div>
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6,
                  }}>考试日期 <span style={{ color: '#ef4444' }}>*</span></div>
                  <input
                    type="date"
                    value={scoreForm.exam_date}
                    onChange={(e) => setScoreForm({ ...scoreForm, exam_date: e.target.value })}
                    className="input input-strong"
                    style={{ fontSize: 13 }}
                    disabled={scoreSaving}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                  <div>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6,
                    }}>分数（0–100，可选）</div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={scoreForm.score}
                      onChange={(e) => setScoreForm({ ...scoreForm, score: e.target.value })}
                      placeholder="如：92.5"
                      className="input input-strong"
                      style={{ fontSize: 14, padding: '10px 12px' }}
                      disabled={scoreSaving}
                    />
                  </div>
                  <div>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6,
                    }}>等第/评级</div>
                    {/* 预设 chips 网格，响应式 auto-fill minmax，触控目标 ≥ 40px */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))',
                      gap: 6,
                    }}>
                      {GRADE_PRESET_CHIPS.map(chip => {
                        const selected = scoreForm.grade_label === chip;
                        return (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => {
                              if (selected) {
                                setScoreForm({ ...scoreForm, grade_label: '' });
                              } else {
                                setScoreForm({ ...scoreForm, grade_label: chip });
                              }
                            }}
                            disabled={scoreSaving}
                            style={{
                              minHeight: 40,
                              padding: '8px 4px',
                              fontSize: 13,
                              fontWeight: 700,
                              border: selected ? '1.5px solid #0f172a' : '1px solid #e2e8f0',
                              borderRadius: 8,
                              background: selected ? 'rgba(15,23,42,0.06)' : '#fff',
                              color: selected ? '#0f172a' : '#475569',
                              cursor: scoreSaving ? 'not-allowed' : 'pointer',
                              transition: 'all 120ms ease',
                              fontFamily: 'inherit',
                            }}
                          >
                            {chip}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6,
                  }}>备注</div>
                  <textarea
                    rows={3}
                    value={scoreForm.notes}
                    onChange={(e) => setScoreForm({ ...scoreForm, notes: e.target.value })}
                    placeholder="可选：如失分点分析、排名信息等"
                    className="input input-strong"
                    style={{ fontSize: 13, resize: 'vertical' }}
                    disabled={scoreSaving}
                  />
                </div>
                <div style={{
                  fontSize: 11, color: '#94a3b8', marginTop: -4,
                }}>
                  * 分数和评级至少填写一项
                </div>
              </div>
              <div style={{
                padding: '12px 20px 20px',
                paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
                borderTop: '1px solid #f1f5f9',
                flexShrink: 0,
                display: 'flex', gap: 8,
              }}>
                <button
                  type="button"
                  onClick={closeScoreModal}
                  disabled={scoreSaving}
                  style={{
                    flex: 1,
                    padding: '12px 0',
                    fontSize: 14, fontWeight: 700,
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    background: '#fff',
                    color: '#475569',
                    cursor: scoreSaving ? 'not-allowed' : 'pointer',
                    transition: 'all 160ms ease',
                    fontFamily: 'inherit',
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveScore}
                  disabled={scoreSaving}
                  style={{
                    flex: 1.3,
                    padding: '12px 0',
                    fontSize: 14, fontWeight: 700,
                    border: 'none',
                    borderRadius: 12,
                    background: '#0f172a',
                    color: '#fff',
                    cursor: scoreSaving ? 'not-allowed' : 'pointer',
                    transition: 'all 160ms ease',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {scoreSaving && <Spinner color="#ffffff" />}
                    {scoreSaving ? '保存中…' : (scoreModalEditing ? '保存修改' : '保存成绩')}
                  </span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body
      )}

      {/* ====== Liquid Glass 成功/失败反馈 overlay ====== */}
      {createPortal(
        <LiquidGlassFlash
          show={flashState.show}
          variant={flashState.variant}
          size={flashState.size}
          duration={flashState.duration}
          onComplete={() => setFlashState(f => ({ ...f, show: false }))}
        />,
        document.body
      )}
    </>
  );
}
