import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import DatePicker from '../ui/date-picker.jsx';
import GradeChips from './GradeChips.jsx';
import { SUBJECTIVE_STEPS } from '../../lib/rating.js';
import {
  CATEGORY_OPTS, FORM_PRESET_BY_CATEGORY, ALL_FORM_PRESET, OBJECTIVE_STEPS,
  DEFAULT_EVAL_STATE, CLEAR_GRADE_WARNING,
  computeDuration, startFromEnd, deriveFromEnd, evalStateFromRow, shouldWarnClearGrade,
  orderCoursesByRecent, defaultChapterUnit, resolveTimes, parseTimeShorthand, shiftTime,
} from '../../lib/sessionRules.js';
import { useMediaQuery } from '../../lib/useMediaQuery.js';
import { useSegDrag } from '../../lib/segDrag.js';
import '../../styles/student-logging.css';

const DURATION_CHIPS = [25, 45, 60, 90, 120];
const COURSE_CHIP_LIMIT = 4;

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/* ============ 单选分段控件（radiogroup，方向键切换；手机可横滑选择） ============ */
function RadioSeg({ options, value, onChange, label, disabled }) {
  const refs = useRef([]);
  const drag = useSegDrag({
    disabled,
    onPick: (i) => { if (options[i]) onChange(options[i].value); },
  });
  function onKeyDown(e, i) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  }
  return (
    <div
      className="yb-seg"
      role="radiogroup"
      aria-label={label}
      data-no-swipe
      ref={drag.ref}
      onPointerDown={drag.onPointerDown}
    >
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
            onClick={() => { if (!drag.shouldSkipClick()) onChange(o.value); }}
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

/* ============ 主观评价：五档刻度（可拖动，也可点标签） ============ */
const SUBJ_N = SUBJECTIVE_STEPS.length;

function SubjectiveScale({ idx, onChange, disabled, labelId }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);
  // 圆点左右各留 10px，与 stepAt 的换算保持一致
  const pos = (i) => `calc(10px + (100% - 20px) * ${(SUBJ_N === 1 ? 0.5 : i / (SUBJ_N - 1))})`;

  function pick(next) {
    const step = Math.min(SUBJ_N - 1, Math.max(0, next));
    if (step === idx) return;
    navigator.vibrate?.(8);   // 仅部分安卓支持；不支持时为 undefined
    onChange(step);
  }
  // 与 GlassRail 相同的指针换算：左右各留 10px 给圆点，落点吸到最近一档
  function stepAt(clientX) {
    const el = trackRef.current;
    if (!el) return idx;
    const r = el.getBoundingClientRect();
    const usable = r.width - 20;
    if (usable <= 0) return idx;
    const ratio = Math.max(0, Math.min(1, (clientX - r.left - 10) / usable));
    return Math.round(ratio * (SUBJ_N - 1));
  }
  function onDown(e) {
    if (disabled) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 旧浏览器 */ }
    dragging.current = true;
    pick(stepAt(e.clientX));
  }
  function onMove(e) { if (dragging.current) pick(stepAt(e.clientX)); }
  function onUp() { dragging.current = false; }
  function onKeyDown(e) {
    if (disabled) return;
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); pick(idx + step); return; }
    if (e.key === 'Home') { e.preventDefault(); pick(0); }
    if (e.key === 'End') { e.preventDefault(); pick(SUBJ_N - 1); }
  }

  return (
    <div className={`yb-subj${disabled ? ' off' : ''}`}>
      <div
        ref={trackRef}
        className="yb-subj__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={SUBJ_N - 1}
        aria-valuenow={idx}
        aria-valuetext={SUBJECTIVE_STEPS[idx].label}
        aria-disabled={disabled || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKeyDown}
      >
        <span className="yb-subj__fill" style={{ width: pos(idx) }} aria-hidden="true" />
        <span className="yb-subj__thumb" style={{ left: pos(idx) }} aria-hidden="true" />
      </div>
      <div className="yb-scale" role="radiogroup" aria-labelledby={labelId}>
        {SUBJECTIVE_STEPS.map((s, i) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={i === idx}
            aria-label={s.label}
            tabIndex={i === idx ? 0 : -1}
            className={i === idx ? 'on' : undefined}
            // 标签对准滑轨上的停点：两端贴边，中间居中，不换行
            style={i === 0 ? { left: 0 } : i === SUBJ_N - 1 ? { right: 0 } : { left: pos(i), transform: 'translateX(-50%)' }}
            disabled={disabled}
            onClick={() => onChange(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============ 章节 / 单元：两个下拉 ============ */
function ChapterUnitSelects({ course, chapterId, unitId, onChange, disabled }) {
  if (!course) return null;
  const chapters = course.chapters || [];
  if (!chapters.length) {
    return <p className="yb-note">这门课还没有章节，可在「课程」里补充大纲（章节可不选）。</p>;
  }
  const ch = chapters.find(c => c.id === chapterId);
  const units = ch?.units || [];
  // 章节 / 单元已被删除时保留原值，别因为改个备注就清掉
  const missingChapter = !!chapterId && !ch;
  const missingUnit = !!unitId && !units.some(u => u.id === unitId);

  return (
    <div className="yb-cu">
      <label className="yb-cu__f">
        <span>章节</span>
        <select
          className="yb-input"
          value={chapterId}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value, '')}
        >
          <option value="">不选章节</option>
          {missingChapter && <option value={chapterId}>已删除的章节</option>}
          {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="yb-cu__f">
        <span>单元</span>
        <select
          className="yb-input"
          value={unitId}
          disabled={disabled || !ch}
          onChange={(e) => onChange(chapterId, e.target.value)}
        >
          <option value="">整章</option>
          {missingUnit && <option value={unitId}>已删除的单元</option>}
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
    </div>
  );
}

/* ============ 时间输入（桌面用文本快捷键，手机保留原生 time） ============ */
function TimeTextInput({ value, onCommit, disabled, className, label }) {
  const [draft, setDraft] = useState(value || '');
  const [bad, setBad] = useState(false);
  const focused = useRef(false);

  // 失焦 / 外部改值时显示规范化的 HH:MM；正在输入时不覆盖草稿
  useEffect(() => {
    if (focused.current) return;
    setDraft(value || '');
    setBad(false);
  }, [value]);

  function change(text) {
    setDraft(text);
    const v = parseTimeShorthand(text);
    if (v) { setBad(false); onCommit(v); }
    else setBad(!!text.trim());
  }
  function onKeyDown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const base = parseTimeShorthand(draft) || value;
    if (!base) return;
    const next = shiftTime(base, e.key === 'ArrowUp' ? 5 : -5);
    setDraft(next); setBad(false); onCommit(next);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={`${className}${bad ? ' err' : ''}`}
      aria-label={label}
      aria-invalid={bad || undefined}
      placeholder="如 1430"
      value={draft}
      disabled={disabled}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setDraft(value || ''); setBad(false); }}
      onChange={(e) => change(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/* ============ 记一笔表单 ============ */
// 只负责录入状态与界面；校验、冲突检查和写库由调用方的 onSave 完成（规则见 sessionRules.js）。
// layout='sheet' 为手机底部弹层（单列），layout='two-col' 为桌面记录页内嵌表单（按行对齐）。
const LogForm = forwardRef(function LogForm({
  layout = 'sheet', open = true, mode = 'new', editRow = null, preset = null,
  courses = [], loadingCourses = false, recent = [], customForms = [],
  onAddCustomForm, onSave, onClose, onCancelEdit, busy = false,
}, ref) {
  // 内嵌表单常驻页面（切 tab 也不卸载），未保存的草稿留在组件 state 里
  const active = open || layout === 'two-col';
  const editing = mode === 'edit' && !!editRow;
  const subjLabelId = useId();
  const rootRef = useRef(null);
  const finePointer = useMediaQuery('(pointer: fine)');

  const [courseId, setCourseId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [unitId, setUnitId] = useState('');
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
  // 学生亲手填过的时间（由早到晚，最多 2 个）：选时长时不覆盖它们，见 resolveTimes
  const [typed, setTyped] = useState([]);
  // 打开时的表单快照：关闭前判断「有没有改过东西」
  const initialRef = useRef(null);

  // 开始 / 时长 / 结束 的推演全部交给 resolveTimes（规则见 sessionRules.js）
  function applyEdit(field, value) {
    const next = resolveTimes({ start: startStr, end: endStr, minutes: duration, typed }, { field, value, now: new Date() });
    setStartStr(next.start);
    setEndStr(next.end);
    setTyped(next.typed);
    if (editing) return;
    // 以结束为准往前推开始、且推过午夜时，session_date 取开始所在日；时长改小后可还原
    if (!next.auto.includes('start') || !next.start || !next.end || !next.minutes) return;
    const base = autoShiftBase.current || dateStr;
    const r = startFromEnd(next.end, base, next.minutes);
    if (!r) return;
    if (r.dateStr !== base) {
      autoShiftBase.current = base;
      setDateStr(r.dateStr);
    } else if (autoShiftBase.current) {
      autoShiftBase.current = null;
      setDateStr(base);
    }
  }
  function pickDate(v) { autoShiftBase.current = null; setDateStr(v); }

  function syncInitial(patch) {
    if (initialRef.current) initialRef.current = { ...initialRef.current, ...patch };
  }
  // 与打开时的快照相比：课程 / 章节 / 时间 / 类别 / 形式 / 评价 / 备注 任一不同即为「改过」
  function isDirty() {
    const i = initialRef.current;
    if (!i) return false;
    return courseId !== i.courseId || chapterId !== i.chapterId || unitId !== i.unitId
      || dateStr !== i.dateStr || startStr !== i.startStr || endStr !== i.endStr
      || category !== i.category || formValue !== i.formValue
      || subjIdx !== i.subjIdx || objIdx !== i.objIdx
      || objDeferred !== i.objDeferred || isObjNA !== i.isObjNA || notes !== i.notes;
  }
  // 有未保存的改动时先确认再关，避免误触 scrim / Esc 丢记录
  function requestClose() {
    if (isDirty() && !window.confirm('放弃这条记录？')) return;
    onClose?.();
  }

  async function submit() {
    if (busy) return;
    setErrors({});
    const res = await onSave?.({
      courseId, chapterId, unitId, category, formValue, notes,
      dateStr, startStr, endStr, subjIdx, objIdx, objDeferred, isObjNA,
    });
    if (res && res.errors) setErrors(res.errors);
    // 宽屏内嵌表单保存新记录后不会关闭：像旧版一样清空时间、备注和评价，保留课程 / 章节 / 日期 / 类别 / 形式
    if (res?.ok && layout === 'two-col' && !editing) resetAfterSave();
  }

  function resetAfterSave() {
    const d = autoShiftBase.current || dateStr;
    autoShiftBase.current = null;
    setDateStr(d);
    setStartStr(''); setEndStr(''); setTyped([]);
    setNotes('');
    setSubjIdx(DEFAULT_EVAL_STATE.subjIdx); setObjIdx(DEFAULT_EVAL_STATE.objIdx);
    setObjDeferred(DEFAULT_EVAL_STATE.objDeferred); setIsObjNA(DEFAULT_EVAL_STATE.isObjNA);
    initialRef.current = {
      ...initialRef.current,
      courseId, chapterId, unitId, category, formValue, dateStr: d,
      startStr: '', endStr: '', notes: '',
      subjIdx: DEFAULT_EVAL_STATE.subjIdx, objIdx: DEFAULT_EVAL_STATE.objIdx,
      objDeferred: DEFAULT_EVAL_STATE.objDeferred, isObjNA: DEFAULT_EVAL_STATE.isObjNA,
    };
  }

  useImperativeHandle(ref, () => ({
    requestClose,
    submit,
    focus: () => {
      rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      rootRef.current?.focus?.({ preventScroll: true });
    },
  })); // eslint-disable-line react-hooks/exhaustive-deps

  // 焦点在弹层外时，桌面 Esc 由 Layout 广播 'yb:close-log'；统一走 requestClose，别绕过确认
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    if (!open) return undefined;
    const onCloseLog = () => requestCloseRef.current();
    window.addEventListener('yb:close-log', onCloseLog);
    return () => window.removeEventListener('yb:close-log', onCloseLog);
  }, [open]);

  // 打开时按 新建 / 编辑 / 预填 重置表单；同时留一份快照给「关前确认」
  useEffect(() => {
    if (!active) return;
    autoShiftBase.current = null;
    setErrors({});
    setAddingCustom(false);
    setCustomInput('');
    let next;
    if (editing) {
      const r = editRow;
      const course = courseById.get(r.course_id);
      const ch = (course?.chapters || []).find(c => c.id === r.chapter_id);
      const ev = evalStateFromRow(r);
      next = {
        courseId: r.course_id || '',
        // 章节 / 课程已被删除时找不到 ch：保留记录原来的 chapter_id / unit_id，别因为改个备注就清掉
        chapterId: ch ? ch.id : (r.chapter_id || ''),
        // 只按记录本身的 unit_id 回填；没有单元时保持为空（STU-2）
        unitId: r.unit_id || '',
        dateStr: String(r.session_date || toDateStr(new Date())),
        startStr: String(r.start_time || '').slice(0, 5),
        endStr: String(r.end_time || '').slice(0, 5),
        category: r.category || 1,
        formValue: r.form || '',
        subjIdx: ev.subjIdx, objIdx: ev.objIdx, objDeferred: ev.objDeferred,
        isObjNA: ev.isObjNA, editHadGrade: ev.editHadGrade,
        notes: r.notes || '',
        // 编辑时两个时间都当作亲手填过：不会因为点时长把已有时间改掉；
        // 最近填的是开始（'end','start' 由早到晚），点时长保留开始、改结束
        typed: ['end', 'start'],
      };
    } else {
      const p = preset || {};
      const cid = (p.courseId && courseById.has(p.courseId)) ? p.courseId : (orderedCourses[0]?.id || '');
      const course = courseById.get(cid);
      const presetCh = p.chapterId && (course?.chapters || []).find(c => c.id === p.chapterId);
      let chapterId;
      let unitId;
      if (presetCh) {
        chapterId = presetCh.id;
        unitId = (presetCh.units || []).some(u => u.id === p.unitId) ? p.unitId : '';
      } else {
        const d = defaultChapterUnit(course, recent);
        chapterId = d.chapterId; unitId = d.unitId;
      }
      const todayStr = toDateStr(new Date());
      const derived = p.durationMinutes > 0 ? deriveFromEnd(new Date(), p.durationMinutes) : null;
      if (derived && derived.dateStr !== todayStr) autoShiftBase.current = todayStr;
      const cat = [1, 2, 3].includes(p.category) ? p.category : 1;
      // 预填的形式只接受该类别的预设、学生自己的自定义形式或最近记录里出现过的形式
      const knownForms = [...(FORM_PRESET_BY_CATEGORY[cat] || []), ...customForms, ...recent.map(r => r.form)];
      next = {
        courseId: cid,
        chapterId, unitId,
        dateStr: derived ? derived.dateStr : todayStr,
        startStr: derived ? derived.startStr : '',
        endStr: derived ? derived.endStr : '',
        category: cat,
        formValue: p.form && knownForms.includes(p.form) ? p.form : '',
        subjIdx: DEFAULT_EVAL_STATE.subjIdx, objIdx: DEFAULT_EVAL_STATE.objIdx,
        objDeferred: DEFAULT_EVAL_STATE.objDeferred, isObjNA: DEFAULT_EVAL_STATE.isObjNA,
        editHadGrade: false,
        notes: '',
        // 预填的时间来自时长，不算亲手填过（显示为「自动」）
        typed: [],
      };
    }
    setCourseId(next.courseId);
    setChapterId(next.chapterId);
    setUnitId(next.unitId);
    setDateStr(next.dateStr);
    setStartStr(next.startStr);
    setEndStr(next.endStr);
    setCategory(next.category);
    setFormValue(next.formValue);
    setSubjIdx(next.subjIdx); setObjIdx(next.objIdx); setObjDeferred(next.objDeferred);
    setIsObjNA(next.isObjNA); setEditHadGrade(next.editHadGrade);
    setNotes(next.notes);
    setTyped(next.typed);
    initialRef.current = next;
  }, [active, editRow, preset, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 课程在打开后才加载完成（如 ?log=1 进入）：按预填或第一门课补选，编辑时补回章节
  useEffect(() => {
    if (!active || !orderedCourses.length) return;
    if (editing) {
      if (!chapterId && editRow.chapter_id) {
        const ch = (courseById.get(editRow.course_id)?.chapters || []).find(c => c.id === editRow.chapter_id);
        if (ch) { setChapterId(ch.id); syncInitial({ chapterId: ch.id }); }
      }
      return;
    }
    if (courseId) return;
    const want = preset?.courseId;
    const cid = want && courseById.has(want) ? want : orderedCourses[0].id;
    setCourseId(cid);
    const course = courseById.get(cid);
    const presetCh = cid === want && preset?.chapterId && (course?.chapters || []).find(c => c.id === preset.chapterId);
    let chId;
    let unId;
    if (presetCh) {
      chId = presetCh.id;
      unId = (presetCh.units || []).some(u => u.id === preset.unitId) ? preset.unitId : '';
    } else {
      const d = defaultChapterUnit(course, recent);
      chId = d.chapterId; unId = d.unitId;
    }
    setChapterId(chId);
    setUnitId(unId);
    syncInitial({ courseId: cid, chapterId: chId, unitId: unId });
  }, [active, orderedCourses]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const duration = computeDuration(startStr, endStr);
  // 哪些字段是系统填的（自动）——与保存前的推演同一套规则
  const auto = resolveTimes({ start: startStr, end: endStr, minutes: duration, typed }, {}).auto;
  const isAuto = (f) => auto.includes(f);
  const lastTyped = typed[typed.length - 1];
  const objMode = isObjNA ? 'na' : objDeferred ? 'later' : 'now';
  function setObjMode(m) {
    if (m === 'now') { setObjDeferred(false); setIsObjNA(false); }
    if (m === 'later') { setObjDeferred(true); setIsObjNA(false); }
    if (m === 'na') { setObjDeferred(false); setIsObjNA(true); }
  }

  // 课程不多时用按钮，一点即选；超过 COURSE_CHIP_LIMIT 门改用下拉（最近用过的排前），免得按钮挤成好几行
  const courseAsSelect = orderedCourses.length > COURSE_CHIP_LIMIT;

  function onFormKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!busy) submit();
    }
  }

  const timeInput = (which) => {
    const v = which === 'start' ? startStr : endStr;
    const cls = `yb-input${errors.time ? ' err' : ''}${isAuto(which) ? ' is-auto' : ''}`;
    return finePointer ? (
      <TimeTextInput
        value={v}
        onCommit={(next) => applyEdit(which, next)}
        disabled={busy}
        className={cls}
        label={which === 'start' ? '开始' : '结束'}
      />
    ) : (
      <input
        type="time"
        className={cls}
        aria-label={which === 'start' ? '开始' : '结束'}
        value={v}
        onChange={(e) => applyEdit(which, e.target.value)}
        disabled={busy}
      />
    );
  };

  /* --- 字段 --- */
  const chapterUnit = (
    <ChapterUnitSelects
      course={activeCourse}
      chapterId={chapterId}
      unitId={unitId}
      disabled={busy}
      onChange={(c, u) => { setChapterId(c); setUnitId(u); }}
    />
  );
  const courseField = courseAsSelect ? (
    <div className="yb-field">
      <div className="yb-course-row">
        <label className="yb-cu__f">
          <span>课程</span>
          <select
            className={`yb-input${errors.course ? ' err' : ''}`}
            value={courseId}
            disabled={busy}
            onChange={(e) => pickCourse(e.target.value)}
          >
            {!courseId && <option value="">选择课程</option>}
            {orderedCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {chapterUnit}
      </div>
      {errors.course && <span className="yb-err">{errors.course}</span>}
    </div>
  ) : (
    <div className="yb-field">
      <div className="yb-label" id={`${subjLabelId}-course`}>课程</div>
      <div className="yb-chips" role="group" aria-labelledby={`${subjLabelId}-course`}>
        {orderedCourses.map(c => (
          <button key={c.id} type="button" className="yb-chip" aria-pressed={c.id === courseId}
            onClick={() => pickCourse(c.id)} disabled={busy}>
            {c.name}
          </button>
        ))}
      </div>
      {errors.course && <span className="yb-err">{errors.course}</span>}
      {chapterUnit}
    </div>
  );

  const timeField = (
    <div className="yb-field">
      <div className="yb-label">
        <span>时间{duration ? <> · <b className="num">{duration} 分钟</b></> : null}</span>
        <span>{startStr && endStr ? `${startStr}–${endStr}` : lastTyped === 'start' && startStr ? '选时长，按开始时间往后推' : '选时长，结束按现在、开始往前推'}</span>
      </div>
      <div className="yb-times">
        <label className="yb-times__date">
          日期
          <DatePicker
            value={dateStr}
            onChange={pickDate}
            disabled={busy}
            className="h-[38px] rounded-xl text-sm font-normal"
            placeholder="选择日期"
          />
        </label>
        <div className="yb-timerow">
          <div className="yb-timecol">
            <div className="yb-timecol__h">
              <span>开始{isAuto('start') && <span className="yb-auto">自动</span>}</span>
              <button type="button" className="yb-now" onClick={() => applyEdit('nowStart')} disabled={busy}>现在</button>
            </div>
            {timeInput('start')}
          </div>
          <div className="yb-timecol">
            <div className="yb-timecol__h"><span>时长{isAuto('minutes') && <span className="yb-auto">自动</span>}</span></div>
            <input
              className={`yb-input yb-dur-input${isAuto('minutes') ? ' is-auto' : ''}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              aria-label="时长（分钟）"
              placeholder="分钟"
              value={duration ?? ''}
              onChange={(e) => applyEdit('minutes', e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="yb-timecol">
            <div className="yb-timecol__h">
              <span>结束{isAuto('end') && <span className="yb-auto">自动</span>}</span>
              <button type="button" className="yb-now" onClick={() => applyEdit('nowEnd')} disabled={busy}>现在</button>
            </div>
            {timeInput('end')}
          </div>
        </div>
      </div>
      <div className="yb-chips" role="group" aria-label="常用时长">
        {DURATION_CHIPS.map(m => (
          <button key={m} type="button" className="yb-chip num" aria-pressed={duration === m}
            onClick={() => applyEdit('minutes', m)} disabled={busy}>
            {m}<span className="yb-sr"> 分钟</span>
          </button>
        ))}
      </div>
      {errors.time && <span className="yb-err" role="alert">{errors.time}</span>}
    </div>
  );

  const categoryField = (
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
  );

  const subjectiveField = (
    <div className="yb-field">
      <div className="yb-label">
        <span id={subjLabelId}><span>主观评价</span> · <span className="em">{SUBJECTIVE_STEPS[subjIdx].label}</span></span>
        <span>必填</span>
      </div>
      <SubjectiveScale idx={subjIdx} onChange={setSubjIdx} disabled={busy} labelId={subjLabelId} />
    </div>
  );

  const objectiveField = category === 3 ? (
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
  ) : null;

  const notesField = (
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
  );

  const saveBar = courses.length > 0 ? (
    <div className="yb-form__save">
      <button type="button" className="yb-btn block" onClick={submit} disabled={busy}>
        {busy ? '保存中…' : (
          <>
            {editing ? '保存修改' : '保存记录'}
            {duration ? <span className="sub"> · {duration} 分钟</span> : null}
          </>
        )}
      </button>
    </div>
  ) : null;

  const body = loadingCourses && !courses.length ? (
    <p className="yb-note">加载课程中…</p>
  ) : courses.length === 0 ? (
    <div className="yb-empty">
      <b>还没有课程</b>
      需要先创建课程大纲，才能记录学习行为。
      <div><a href="/syllabus" className="yb-btn sm">去创建课程</a></div>
    </div>
  ) : layout === 'two-col' ? (
    // 桌面：一行一组、左右对齐（课程 → 时间 → 类别·形式 | 主观评价 → 客观评价 → 备注）
    <>
      {courseField}
      {timeField}
      <div className="yb-form__pair">
        {categoryField}
        {subjectiveField}
      </div>
      {objectiveField}
      {notesField}
    </>
  ) : (
    <>
      {courseField}
      {timeField}
      {categoryField}
      {subjectiveField}
      {objectiveField}
      {notesField}
    </>
  );

  return (
    <section
      ref={rootRef}
      className={`yb-form yb-form--${layout}${editing ? ' is-editing' : ''}`}
      aria-label={editing ? '编辑记录表单' : '记一下表单'}
      tabIndex={-1}
      onKeyDown={onFormKeyDown}
    >
      {layout === 'two-col' && (
        <div className="yb-form__h">
          <h2>{editing ? '编辑记录' : '记一下'}</h2>
          {editing && (
            <button type="button" className="yb-form__cancel" onClick={onCancelEdit} disabled={busy}>取消编辑</button>
          )}
        </div>
      )}
      {body}
      {saveBar}
    </section>
  );
});

export default LogForm;
