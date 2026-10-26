import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown, X } from 'lucide-react';
import DatePicker from '../ui/date-picker.jsx';
import GradeChips from './GradeChips.jsx';
import { SUBJECTIVE_STEPS } from '../../lib/rating.js';
import {
  CATEGORY_OPTS, FORM_PRESET_BY_CATEGORY, ALL_FORM_PRESET, OBJECTIVE_STEPS,
  DEFAULT_EVAL_STATE, CLEAR_GRADE_WARNING,
  computeDuration, startFromEnd, deriveFromEnd, evalStateFromRow, shouldWarnClearGrade,
  orderCoursesByRecent, defaultChapterUnit,
} from '../../lib/sessionRules.js';
import '../../styles/student-logging.css';

const DURATION_CHIPS = [25, 45, 60, 90, 120];
const COURSE_CHIP_LIMIT = 4;

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toTimeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

/* ============ Sheet：手机底部弹层 / 桌面右侧面板 ============ */
export function Sheet({ open, onClose, title, children, footer, headerExtra }) {
  const desktop = useMedia('(min-width: 900px)');
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef(null);
  const returnFocus = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocus.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    if (!desktop) document.body.style.overflow = 'hidden';
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      const el = returnFocus.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open, desktop]);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      // 日历等弹层自己处理 Esc；只有焦点仍在面板内时才关闭
      if (e.defaultPrevented) return;
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = panelRef.current.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  const offscreen = desktop ? { x: 'calc(100% + 24px)' } : { y: '100%' };
  const onscreen = desktop ? { x: 0 } : { y: 0 };
  const transition = reduce ? { duration: 0 } : { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.38 };
  const target = (typeof document !== 'undefined' && document.querySelector('.yb-student')) || document.body;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="yb-lg" key="yb-sheet">
          <motion.div
            className="yb-sheet-scrim"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            className="yb-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={offscreen} animate={onscreen} exit={offscreen}
            transition={transition}
          >
            <div className="yb-sheet__grab" aria-hidden="true" />
            <div className="yb-sheet__h">
              <h2 id={titleId}>{title}</h2>
              {headerExtra}
              <button type="button" className="yb-sheet__close" onClick={onClose} aria-label="关闭">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="yb-sheet__b">{children}</div>
            {footer && <div className="yb-sheet__f">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    target,
  );
}

/* ============ 单选分段控件（radiogroup，方向键切换） ============ */
export function RadioSeg({ options, value, onChange, label, disabled }) {
  const refs = useRef([]);
  function onKeyDown(e, i) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  }
  return (
    <div className="yb-seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.dot && <span className={`yb-dot ${o.dot}`} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============ 主观评价：五档刻度 ============ */
function SubjectiveScale({ idx, onChange, disabled, labelId }) {
  const refs = useRef([]);
  function onKeyDown(e, i) {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = Math.min(SUBJECTIVE_STEPS.length - 1, Math.max(0, i + step));
    refs.current[next]?.focus();
    onChange(next);
  }
  return (
    <div>
      <div className="yb-scale" role="radiogroup" aria-labelledby={labelId}>
        {SUBJECTIVE_STEPS.map((s, i) => (
          <button
            key={s.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={i === idx}
            aria-label={s.label}
            tabIndex={i === idx ? 0 : -1}
            className={i <= idx ? 'on' : undefined}
            disabled={disabled}
            onClick={() => onChange(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <i style={{ height: 10 + i * 6 }} />
          </button>
        ))}
      </div>
      <div className="yb-scale-l" aria-hidden="true">
        <span>{SUBJECTIVE_STEPS[0].label}</span>
        <span>{SUBJECTIVE_STEPS[SUBJECTIVE_STEPS.length - 1].label}</span>
      </div>
    </div>
  );
}

/* ============ 章节 / 单元：单个可搜索选择器 ============ */
function ChapterUnitPicker({ course, chapterId, unitId, onPick, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const listId = useId();
  useEffect(() => { setOpen(false); setQ(''); }, [course?.id]);

  const chapters = course?.chapters || [];
  const ch = chapters.find(c => c.id === chapterId);
  const un = ch?.units?.find(u => u.id === unitId);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (s) => !needle || String(s || '').toLowerCase().includes(needle);
    const out = [];
    for (const c of chapters) {
      const units = (c.units || []).filter(u => hit(u.name) || hit(c.name));
      if (hit(c.name) || units.length) {
        out.push({ kind: 'ch', id: c.id, chapterId: c.id, unitId: '', name: c.name });
        for (const u of units) out.push({ kind: 'un', id: u.id, chapterId: c.id, unitId: u.id, name: u.name, parent: c.name });
      }
    }
    return out;
  }, [chapters, q]);

  if (!course) return null;
  if (!chapters.length) {
    return <p className="yb-note">这门课还没有章节，可在「课程」里补充大纲（章节可不选）。</p>;
  }

  return (
    <div className="yb-field">
      <button
        type="button"
        className="yb-crumb"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
      >
        <span className="yb-sr">章节 / 单元：</span>
        {ch ? (
          <>
            <span>{ch.name}</span>
            <b>{un ? un.name : '整章'}</b>
          </>
        ) : <span>选择章节 / 单元（可选）</span>}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="yb-picker" id={listId}>
          <input
            className="yb-input"
            type="search"
            placeholder="搜索章节或单元"
            aria-label="搜索章节或单元"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <ul role="listbox" aria-label="章节与单元">
            <li>
              <button type="button" role="option" aria-selected={!chapterId}
                onClick={() => { onPick('', ''); setOpen(false); }}>不选章节</button>
            </li>
            {rows.map(r => {
              const selected = r.kind === 'ch' ? (chapterId === r.chapterId && !unitId) : unitId === r.unitId;
              return (
                <li key={`${r.kind}-${r.id}`} className={r.kind}>
                  <button type="button" role="option" aria-selected={selected}
                    onClick={() => { onPick(r.chapterId, r.unitId); setOpen(false); }}>
                    {r.name}
                    {r.kind === 'ch' && <small>整章</small>}
                  </button>
                </li>
              );
            })}
            {rows.length === 0 && <li><p className="yb-note" style={{ padding: '8px 10px' }}>没有匹配的章节或单元</p></li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ============ 记一笔 ============ */
// 只负责录入状态与界面；校验、冲突检查和写库由调用方的 onSave 完成（规则见 sessionRules.js）。
export default function LogSheet({
  open, onClose, mode = 'new', editRow = null, preset = null,
  courses = [], loadingCourses = false, recent = [], customForms = [],
  onAddCustomForm, onSave, busy = false,
}) {
  const editing = mode === 'edit' && !!editRow;
  const subjLabelId = useId();

  const [courseId, setCourseId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [dateStr, setDateStr] = useState(toDateStr(new Date()));
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [category, setCategory] = useState(1);
  const [formValue, setFormValue] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [subjIdx, setSubjIdx] = useState(DEFAULT_EVAL_STATE.subjIdx);
  const [objIdx, setObjIdx] = useState(DEFAULT_EVAL_STATE.objIdx);
  const [objDeferred, setObjDeferred] = useState(false);
  const [isObjNA, setIsObjNA] = useState(false);
  const [editHadGrade, setEditHadGrade] = useState(false);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});

  const orderedCourses = useMemo(() => orderCoursesByRecent(courses, recent), [courses, recent]);
  const courseById = useMemo(() => new Map(courses.map(c => [c.id, c])), [courses]);
  const activeCourse = courseById.get(courseId);

  // 新建时按时长往前推开始时间；推过午夜则 session_date 取前一天（开始所在日）。
  // autoShiftBase 记着自动前移之前的日期，改成不跨午夜的时长时可以还原；手动改日期后不再自动改。
  const autoShiftBase = useRef(null);
  function applyDuration(mins, endAnchor = endStr) {
    const end = endAnchor || toTimeStr(new Date());
    const base = autoShiftBase.current || dateStr;
    const r = startFromEnd(end, base, mins);
    if (!r) return;
    setEndStr(end);
    setStartStr(r.startStr);
    if (editing) return;
    if (r.dateStr !== base) { autoShiftBase.current = base; setDateStr(r.dateStr); }
    else if (autoShiftBase.current) { autoShiftBase.current = null; setDateStr(base); }
  }
  function pickDate(v) { autoShiftBase.current = null; setDateStr(v); }

  // 打开时按 新建 / 编辑 / 预填 重置表单
  useEffect(() => {
    if (!open) return;
    autoShiftBase.current = null;
    setErrors({});
    setAddingCustom(false);
    setCustomInput('');
    setShowAllCourses(false);
    if (editing) {
      const r = editRow;
      setCourseId(r.course_id || '');
      const course = courseById.get(r.course_id);
      const ch = (course?.chapters || []).find(c => c.id === r.chapter_id);
      setChapterId(ch ? ch.id : '');
      // 只按记录本身的 unit_id 回填；没有单元时保持为空（STU-2）
      setUnitId(r.unit_id || '');
      setDateStr(String(r.session_date || toDateStr(new Date())));
      setStartStr(String(r.start_time || '').slice(0, 5));
      setEndStr(String(r.end_time || '').slice(0, 5));
      setCategory(r.category || 1);
      setFormValue(r.form || '');
      const ev = evalStateFromRow(r);
      setSubjIdx(ev.subjIdx); setObjIdx(ev.objIdx); setObjDeferred(ev.objDeferred);
      setIsObjNA(ev.isObjNA); setEditHadGrade(ev.editHadGrade);
      setNotes(r.notes || '');
      return;
    }
    const p = preset || {};
    const cid = (p.courseId && courseById.has(p.courseId)) ? p.courseId : (orderedCourses[0]?.id || '');
    setCourseId(cid);
    const course = courseById.get(cid);
    const presetCh = p.chapterId && (course?.chapters || []).find(c => c.id === p.chapterId);
    if (presetCh) {
      setChapterId(presetCh.id);
      setUnitId((presetCh.units || []).some(u => u.id === p.unitId) ? p.unitId : '');
    } else {
      const d = defaultChapterUnit(course, recent);
      setChapterId(d.chapterId); setUnitId(d.unitId);
    }
    autoShiftBase.current = null;
    const todayStr = toDateStr(new Date());
    setDateStr(todayStr);
    const derived = p.durationMinutes > 0 ? deriveFromEnd(new Date(), p.durationMinutes) : null;
    if (derived) {
      setEndStr(derived.endStr); setStartStr(derived.startStr); setDateStr(derived.dateStr);
      if (derived.dateStr !== todayStr) autoShiftBase.current = todayStr;
    } else {
      setStartStr(''); setEndStr('');
    }
    const cat = [1, 2, 3].includes(p.category) ? p.category : 1;
    setCategory(cat);
    // 预填的形式只接受该类别的预设、学生自己的自定义形式或最近记录里出现过的形式
    const knownForms = [...(FORM_PRESET_BY_CATEGORY[cat] || []), ...customForms, ...recent.map(r => r.form)];
    setFormValue(p.form && knownForms.includes(p.form) ? p.form : '');
    setSubjIdx(DEFAULT_EVAL_STATE.subjIdx); setObjIdx(DEFAULT_EVAL_STATE.objIdx);
    setObjDeferred(DEFAULT_EVAL_STATE.objDeferred); setIsObjNA(DEFAULT_EVAL_STATE.isObjNA);
    setEditHadGrade(false);
    setNotes('');
  }, [open, editRow, preset]); // eslint-disable-line react-hooks/exhaustive-deps

  // 课程在打开后才加载完成（如 ?log=1 进入）：按预填或第一门课补选，编辑时补回章节
  useEffect(() => {
    if (!open || !orderedCourses.length) return;
    if (editing) {
      if (!chapterId && editRow.chapter_id) {
        const ch = (courseById.get(editRow.course_id)?.chapters || []).find(c => c.id === editRow.chapter_id);
        if (ch) setChapterId(ch.id);
      }
      return;
    }
    if (courseId) return;
    const want = preset?.courseId;
    const cid = want && courseById.has(want) ? want : orderedCourses[0].id;
    setCourseId(cid);
    const course = courseById.get(cid);
    const presetCh = cid === want && preset?.chapterId && (course?.chapters || []).find(c => c.id === preset.chapterId);
    if (presetCh) {
      setChapterId(presetCh.id);
      setUnitId((presetCh.units || []).some(u => u.id === preset.unitId) ? preset.unitId : '');
    } else {
      const d = defaultChapterUnit(course, recent);
      setChapterId(d.chapterId); setUnitId(d.unitId);
    }
  }, [open, orderedCourses]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickCourse(id) {
    if (id === courseId) return;
    setCourseId(id);
    const d = defaultChapterUnit(courseById.get(id), recent);
    setChapterId(d.chapterId); setUnitId(d.unitId);
    setErrors(e => ({ ...e, course: undefined }));
  }

  const currentPreset = FORM_PRESET_BY_CATEGORY[category] || FORM_PRESET_BY_CATEGORY[1];
  const customForCategory = customForms.filter(n => !ALL_FORM_PRESET.includes(n));
  const formOptions = [...currentPreset, ...customForCategory];
  if (formValue && !formOptions.includes(formValue)) formOptions.push(formValue);

  function pickCategory(k) {
    setCategory(k);
    // 切换类别时，若当前形式不在新列表里就清空，避免提交时漏选
    const next = [...(FORM_PRESET_BY_CATEGORY[k] || []), ...customForCategory];
    if (formValue && !next.includes(formValue)) setFormValue('');
  }

  async function addCustom() {
    const name = customInput.trim();
    if (!name) return;
    const ok = await onAddCustomForm?.(name);
    if (ok) {
      setFormValue(name);
      setAddingCustom(false);
      setCustomInput('');
      setErrors(e => ({ ...e, form: undefined }));
    }
  }

  async function submit() {
    setErrors({});
    const res = await onSave?.({
      courseId, chapterId, unitId, category, formValue, notes,
      dateStr, startStr, endStr, subjIdx, objIdx, objDeferred, isObjNA,
    });
    if (res && res.errors) setErrors(res.errors);
  }

  const duration = computeDuration(startStr, endStr);
  const objMode = isObjNA ? 'na' : objDeferred ? 'later' : 'now';
  function setObjMode(m) {
    if (m === 'now') { setObjDeferred(false); setIsObjNA(false); }
    if (m === 'later') { setObjDeferred(true); setIsObjNA(false); }
    if (m === 'na') { setObjDeferred(false); setIsObjNA(true); }
  }

  const visibleCourses = showAllCourses ? orderedCourses : orderedCourses.slice(0, COURSE_CHIP_LIMIT);
  if (!showAllCourses && activeCourse && !visibleCourses.includes(activeCourse)) {
    visibleCourses.push(activeCourse);
  }

  const footer = courses.length > 0 ? (
    <button type="button" className="yb-btn block" onClick={submit} disabled={busy}>
      {busy ? '保存中…' : (
        <>
          {editing ? '保存修改' : '保存记录'}
          {duration ? <span className="sub"> · {duration} 分钟</span> : null}
        </>
      )}
    </button>
  ) : null;

  return (
    <Sheet open={open} onClose={onClose} title={editing ? '编辑记录' : '记一笔'} footer={footer}>
      {loadingCourses && !courses.length ? (
        <p className="yb-note">加载课程中…</p>
      ) : courses.length === 0 ? (
        <div className="yb-empty">
          <b>还没有课程</b>
          需要先创建课程大纲，才能记录学习行为。
          <div><a href="/syllabus" className="yb-btn sm">去创建课程</a></div>
        </div>
      ) : (
        <>
          {/* 课程 */}
          <div className="yb-field">
            <div className="yb-label" id={`${subjLabelId}-course`}>课程</div>
            <div className="yb-chips" role="group" aria-labelledby={`${subjLabelId}-course`}>
              {visibleCourses.map(c => (
                <button key={c.id} type="button" className="yb-chip" aria-pressed={c.id === courseId}
                  onClick={() => pickCourse(c.id)} disabled={busy}>
                  {c.name}
                </button>
              ))}
              {orderedCourses.length > COURSE_CHIP_LIMIT && (
                <button type="button" className="yb-chip ghost" aria-expanded={showAllCourses}
                  onClick={() => setShowAllCourses(s => !s)}>
                  {showAllCourses ? '收起' : '更多'}
                </button>
              )}
            </div>
            {errors.course && <span className="yb-err">{errors.course}</span>}
            <ChapterUnitPicker
              course={activeCourse}
              chapterId={chapterId}
              unitId={unitId}
              disabled={busy}
              onPick={(c, u) => { setChapterId(c); setUnitId(u); }}
            />
          </div>

          {/* 时长优先；开始/结束仍可改，照常写入 start_time / end_time / duration_minutes */}
          <div className="yb-field">
            <div className="yb-label">
              <span>时长{duration ? <> · <b className="num">{duration} 分钟</b></> : null}</span>
              <span>{startStr && endStr ? `${startStr}–${endStr}` : '选时长，开始时间按现在往前推'}</span>
            </div>
            <div className="yb-chips" role="group" aria-label="常用时长">
              {DURATION_CHIPS.map(m => (
                <button key={m} type="button" className="yb-chip num" aria-pressed={duration === m}
                  onClick={() => applyDuration(m)} disabled={busy}>
                  {m}<span className="yb-sr"> 分钟</span>
                </button>
              ))}
              <input
                className="yb-input yb-dur-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                aria-label="时长（分钟）"
                placeholder="分钟"
                value={duration ?? ''}
                onChange={(e) => applyDuration(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="yb-times">
              <label>
                日期
                <DatePicker
                  value={dateStr}
                  onChange={pickDate}
                  disabled={busy}
                  className="h-[38px] rounded-xl text-sm font-normal"
                  placeholder="选择日期"
                />
              </label>
              <label>
                开始
                <input type="time" className={`yb-input ${errors.time ? 'err' : ''}`}
                  value={startStr} onChange={(e) => setStartStr(e.target.value)} disabled={busy} />
              </label>
              <label>
                结束
                <input type="time" className={`yb-input ${errors.time ? 'err' : ''}`}
                  value={endStr} onChange={(e) => setEndStr(e.target.value)} disabled={busy} />
              </label>
            </div>
            {errors.time && <span className="yb-err" role="alert">{errors.time}</span>}
          </div>

          {/* 类别 · 形式 */}
          <div className="yb-field">
            <div className="yb-label">类别 · 形式</div>
            <RadioSeg
              label="学习行为类别"
              value={category}
              onChange={pickCategory}
              disabled={busy}
              options={CATEGORY_OPTS.map(o => ({ value: o.key, label: o.label, dot: `c${o.key}` }))}
            />
            <div className="yb-chips" role="group" aria-label="学习行为形式">
              {formOptions.map(n => (
                <button key={n} type="button" className="yb-chip" aria-pressed={formValue === n}
                  onClick={() => { setFormValue(n); setErrors(e => ({ ...e, form: undefined })); }} disabled={busy}>
                  {n}
                </button>
              ))}
              {!addingCustom && (
                <button type="button" className="yb-chip ghost" onClick={() => setAddingCustom(true)} disabled={busy}>
                  ＋ 自定义
                </button>
              )}
            </div>
            {addingCustom && (
              <div className="yb-row">
                <input type="text" className="yb-input grow"
                  placeholder="填写一个新的形式名称，如：家教辅导"
                  aria-label="新的学习行为形式"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  disabled={busy}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                />
                <button type="button" className="yb-btn sm" onClick={addCustom} disabled={busy}>添加</button>
                <button type="button" className="yb-btn sm quiet" onClick={() => { setAddingCustom(false); setCustomInput(''); }} disabled={busy}>取消</button>
              </div>
            )}
            {errors.form && <span className="yb-err">{errors.form}</span>}
          </div>

          {/* 主观评价：必填 */}
          <div className="yb-field">
            <div className="yb-label">
              <span id={subjLabelId}><span>主观评价</span> · <span className="em">{SUBJECTIVE_STEPS[subjIdx].label}</span></span>
              <span>必填</span>
            </div>
            <SubjectiveScale idx={subjIdx} onChange={setSubjIdx} disabled={busy} labelId={subjLabelId} />
          </div>

          {/* 客观评价：仅练习，可选 */}
          {category === 3 && (
            <div className="yb-field">
              <div className="yb-label"><span>客观评价</span><span>仅练习 · 可选</span></div>
              <RadioSeg
                label="客观评价填写方式"
                value={objMode}
                onChange={setObjMode}
                disabled={busy}
                options={[
                  { value: 'now', label: '现在填写' },
                  { value: 'later', label: '稍后补充' },
                  { value: 'na', label: 'N/A 不适用' },
                ]}
              />
              {objMode === 'now' && (
                <GradeChips
                  value={OBJECTIVE_STEPS[objIdx]?.label}
                  onChange={(g) => { const i = OBJECTIVE_STEPS.findIndex(s => s.label === g); if (i >= 0) { setObjIdx(i); setIsObjNA(false); } }}
                  disabled={busy}
                />
              )}
              {objMode === 'later' && (
                <p className="yb-note">已选择稍后补充。可在「待补填」里一键补填客观评价。</p>
              )}
              {objMode === 'na' && (
                <p className="yb-note">这次练习没有可评的结果，不会出现在待补填里。</p>
              )}
              {shouldWarnClearGrade({ editing, editHadGrade, objDeferred, category }) && (
                <p className="yb-note warn">{CLEAR_GRADE_WARNING}</p>
              )}
            </div>
          )}

          {/* 备注 */}
          <div className="yb-field">
            <label className="yb-label" htmlFor={`${subjLabelId}-notes`}>备注（可选）</label>
            <textarea
              id={`${subjLabelId}-notes`}
              rows={2}
              className="yb-input"
              placeholder={category === 3 && objMode === 'now'
                ? '这次分数的解释：哪部分丢分最多？下次怎么改进？'
                : '比如：专注度如何，哪些点还要再巩固'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </div>
        </>
      )}
    </Sheet>
  );
}
