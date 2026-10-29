import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from '../ui/date-picker.jsx';
import { SUBJECTIVE_STEPS } from '../../lib/rating.js';
import {
  CATEGORY_OPTS, FORM_PRESET_BY_CATEGORY, ALL_FORM_PRESET, OBJECTIVE_STEPS, GRADE_RANGES,
  DEFAULT_EVAL_STATE, CLEAR_GRADE_WARNING,
  computeDuration, deriveFromEnd, evalStateFromRow, shouldWarnClearGrade,
  orderCoursesByRecent, defaultChapterUnit, durationAnchor, endFromStart, startFromEnd,
} from '../../lib/sessionRules.js';
import '../../styles/student-classic.css';

// 旧版记录界面（我的 › 记录界面 › 旧版）：改版前「记录」页上的内嵌表单。
// 只换录入界面：保存、校验、冲突检查、暂存与 LogSheet 走同一个 onSave（规则见 sessionRules.js）。

const ADD_OTHER = '__add_other__';
const DURATION_SHORTCUTS = [30, 45, 60, 90, 120];

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toTimeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/* 可拖动的分档滑轨（改版前的 GlassRail） */
export function GlassRail({ steps, idx, onChange, disabled, label, tone = 'subj' }) {
  const n = steps.length;
  const trackRef = useRef(null);
  const dragging = useRef(false);
  const pct = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);

  function stepAt(clientX) {
    const el = trackRef.current;
    if (!el) return idx;
    const r = el.getBoundingClientRect();
    const usable = r.width - 40;
    if (usable <= 0) return idx;
    const ratio = Math.max(0, Math.min(1, (clientX - r.left - 20) / usable));
    return Math.round(ratio * (n - 1));
  }
  function onDown(e) {
    if (disabled) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 旧浏览器 */ }
    dragging.current = true;
    onChange(stepAt(e.clientX));
  }
  function onMove(e) { if (dragging.current && !disabled) onChange(stepAt(e.clientX)); }
  function onUp() { dragging.current = false; }

  return (
    <div className={`ybc-rail ${tone}${disabled ? ' off' : ''}`}>
      <div className="ybc-rail-track" ref={trackRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="ybc-rail-dots" aria-hidden="true">
          {steps.map((s, i) => <span key={s.label} style={{ opacity: i === idx ? 1 : 0.55 }} />)}
        </div>
        <input type="range" min={0} max={n - 1} step={1} value={idx} disabled={disabled}
          aria-label={label} aria-valuetext={steps[idx]?.label}
          onChange={(e) => onChange(Number(e.target.value))} />
        <span className="ybc-rail-thumb" style={{ left: `calc(20px + (100% - 40px) * ${pct(idx) / 100})` }} aria-hidden="true" />
      </div>
      <div className="ybc-rail-cur">{steps[idx]?.label}</div>
      {n <= 6 && (
        <div className="ybc-rail-ticks" aria-hidden="true">
          {steps.map((s, i) => <span key={s.label} className={i === idx ? 'on' : undefined}>{s.label}</span>)}
        </div>
      )}
    </div>
  );
}

const ClassicLogForm = forwardRef(function ClassicLogForm({
  open, mode = 'new', editRow = null, preset = null, onCancelEdit,
  courses = [], loadingCourses = false, recent = [], customForms = [],
  onAddCustomForm, onSave, busy = false,
}, ref) {
  const editing = open && mode === 'edit' && !!editRow;

  const [courseId, setCourseId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [dateStr, setDateStr] = useState(toDateStr(new Date()));
  const [startStr, setStartStr] = useState(toTimeStr(new Date()));
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
  // 学生亲手填过的时间（最近的在前）：快速时长不覆盖它们，见 durationAnchor
  const [typed, setTyped] = useState(['start']);

  const orderedCourses = useMemo(() => orderCoursesByRecent(courses, recent), [courses, recent]);
  const courseById = useMemo(() => new Map(courses.map(c => [c.id, c])), [courses]);
  const activeCourse = courseById.get(courseId);
  const activeChapter = activeCourse?.chapters?.find(c => c.id === chapterId);

  function pickCourseDefaults(cid) {
    const d = defaultChapterUnit(courseById.get(cid), recent);
    setChapterId(d.chapterId); setUnitId(d.unitId);
  }

  // 编辑 / 预填（＋、再记一次、提醒链接）时重置表单；离开编辑回到新建（同改版前「取消编辑」）。
  // 新建保存成功后由 submit 自己重置，这里不动，课程 / 类别 / 形式保留。
  const wasEditing = useRef(false);
  useEffect(() => {
    setErrors({});
    setAddingCustom(false);
    setCustomInput('');
    if (editing) {
      wasEditing.current = true;
      const r = editRow;
      setCourseId(r.course_id || '');
      setChapterId(r.chapter_id || '');
      setUnitId(r.unit_id || '');
      setDateStr(String(r.session_date || toDateStr(new Date())));
      setStartStr(String(r.start_time || '').slice(0, 5));
      setEndStr(String(r.end_time || '').slice(0, 5));
      setTyped(['start']);
      setCategory(r.category || 1);
      setFormValue(r.form || '');
      const ev = evalStateFromRow(r);
      setSubjIdx(ev.subjIdx); setObjIdx(ev.objIdx); setObjDeferred(ev.objDeferred);
      setIsObjNA(ev.isObjNA); setEditHadGrade(ev.editHadGrade);
      setNotes(r.notes || '');
      return;
    }
    const leavingEdit = wasEditing.current;
    wasEditing.current = false;
    const p = open ? (preset || {}) : null;
    if (!p && !leavingEdit) return;
    const q = p || {};
    if (q.courseId && courseById.has(q.courseId)) {
      setCourseId(q.courseId);
      const ch = q.chapterId && (courseById.get(q.courseId)?.chapters || []).find(c => c.id === q.chapterId);
      if (ch) { setChapterId(ch.id); setUnitId((ch.units || []).some(u => u.id === q.unitId) ? q.unitId : ''); }
      else pickCourseDefaults(q.courseId);
    }
    const now = new Date();
    const derived = q.durationMinutes > 0 ? deriveFromEnd(now, q.durationMinutes) : null;
    if (derived) { setDateStr(derived.dateStr); setStartStr(derived.startStr); setEndStr(derived.endStr); setTyped([]); }
    else { setDateStr(toDateStr(now)); setStartStr(toTimeStr(now)); setEndStr(''); setTyped(['start']); }
    if ([1, 2, 3].includes(q.category)) setCategory(q.category);
    else if (leavingEdit) setCategory(1);
    const knownForms = [...ALL_FORM_PRESET, ...customForms, ...recent.map(r => r.form)];
    if (q.form && knownForms.includes(q.form)) setFormValue(q.form);
    else if (leavingEdit) setFormValue('');
    setSubjIdx(DEFAULT_EVAL_STATE.subjIdx); setObjIdx(DEFAULT_EVAL_STATE.objIdx);
    setObjDeferred(false); setIsObjNA(false); setEditHadGrade(false);
    setNotes('');
  }, [open, mode, editRow, preset]); // eslint-disable-line react-hooks/exhaustive-deps

  // 课程晚于表单加载完成时补选第一门（与改版前一致：默认第一门 / 最近用过的课）
  useEffect(() => {
    if (courseId || !orderedCourses.length || editing) return;
    setCourseId(orderedCourses[0].id);
    pickCourseDefaults(orderedCourses[0].id);
  }, [orderedCourses]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentPreset = FORM_PRESET_BY_CATEGORY[category] || FORM_PRESET_BY_CATEGORY[1];
  const customForCategory = customForms.filter(n => !ALL_FORM_PRESET.includes(n));
  const formOptions = [...currentPreset, ...customForCategory];
  if (formValue && !formOptions.includes(formValue)) formOptions.push(formValue);

  function pickCategory(k) {
    setCategory(k);
    const next = [...(FORM_PRESET_BY_CATEGORY[k] || []), ...customForCategory];
    if (formValue && !next.includes(formValue)) setFormValue('');
  }
  function typeTime(which, v) {
    (which === 'start' ? setStartStr : setEndStr)(v);
    setTyped(t => [which, ...t.filter(x => x !== which)]);
  }
  // 快速时长：以学生最近填的时间为准往后 / 往前推，不覆盖它
  function applyShortcut(mins) {
    if (durationAnchor(typed) === 'start' && startStr) {
      const end = endFromStart(startStr, mins);
      if (end) { setEndStr(end); setTyped(['start']); }
      return;
    }
    const end = endStr || toTimeStr(new Date());
    const r = startFromEnd(end, dateStr, mins);
    if (!r) return;
    setEndStr(end); setStartStr(r.startStr); setTyped(['end']);
  }

  async function addCustom() {
    const name = customInput.trim();
    if (!name) return;
    const ok = await onAddCustomForm?.(name);
    if (ok) { setFormValue(name); setAddingCustom(false); setCustomInput(''); }
  }

  async function submit() {
    setErrors({});
    const res = await onSave?.({
      courseId, chapterId, unitId, category, formValue, notes,
      dateStr, startStr, endStr, subjIdx, objIdx, objDeferred, isObjNA,
    });
    if (res && res.errors) { setErrors(res.errors); return; }
    // 新建保存成功后（与改版前一致）：保留课程 / 类别 / 形式，时间与评价回到默认
    if (res && res.ok && !editing) {
      setStartStr(toTimeStr(new Date())); setEndStr(''); setTyped(['start']); setNotes('');
      setSubjIdx(DEFAULT_EVAL_STATE.subjIdx); setObjIdx(DEFAULT_EVAL_STATE.objIdx);
      setObjDeferred(false); setIsObjNA(false);
    }
  }

  const autoDur = computeDuration(startStr, endStr);
  const objMode = isObjNA ? 'na' : objDeferred ? 'later' : 'now';
  function setObjMode(m) {
    setObjDeferred(m === 'later');
    setIsObjNA(m === 'na');
  }

  const notesBlock = (
    <div className="ybc-block">
      <label className="ybc-label" htmlFor="ybc-notes">备注</label>
      <textarea id="ybc-notes" className="ybc-input ybc-notes" rows={3}
        placeholder={category === 3
          ? '这次分数的解释：哪一部分丢分最多？是知识点没掌握、审题粗心还是时间不够？下次怎么改进？'
          : '关于这次学习的补充说明：专注度如何？哪些点掌握了，哪些还需要再巩固？'}
        value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
    </div>
  );

  return (
    <section ref={ref} className={`ybc ${editing ? 'is-editing' : ''}`} aria-label={editing ? '编辑记录' : '记录学习'} tabIndex={-1}>
      {editing && (
        <div className="ybc-editing">
          <span>正在编辑一条记录</span>
          <button type="button" onClick={onCancelEdit} disabled={busy}>取消编辑</button>
        </div>
      )}
      {loadingCourses && !courses.length ? (
        <p className="ybc-hint">加载课程中…</p>
      ) : courses.length === 0 ? (
        <div className="ybc-empty">
          <b>还没有课程</b>
          需要先创建课程大纲，才能记录学习行为。
          <div><a href="/me/courses" className="yb-btn sm">去创建课程</a></div>
        </div>
      ) : (
        <>
          <div className="ybc-block">
            <div className="ybc-label">课程 / 章节 / 单元</div>
            <div className="ybc-three">
              <label className="ybc-field">
                <span>课程</span>
                <select className={`ybc-input ${errors.course ? 'err' : ''}`} value={courseId} disabled={busy}
                  onChange={(e) => { setCourseId(e.target.value); pickCourseDefaults(e.target.value); }}>
                  <option value="">请选择</option>
                  {orderedCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {errors.course && <em className="ybc-err">{errors.course}</em>}
              </label>
              <label className="ybc-field">
                <span>章节 <small>可选</small></span>
                <select className="ybc-input" value={chapterId} disabled={busy || !activeCourse}
                  onChange={(e) => { setChapterId(e.target.value); setUnitId(''); }}>
                  <option value="">{activeCourse ? '不选' : '先选课程'}</option>
                  {activeCourse?.chapters?.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                </select>
              </label>
              <label className="ybc-field">
                <span>单元 <small>可选</small></span>
                <select className="ybc-input" value={unitId} disabled={busy || !activeChapter}
                  onChange={(e) => setUnitId(e.target.value)}>
                  <option value="">{activeChapter ? '不选' : '先选章节'}</option>
                  {activeChapter?.units?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="ybc-block">
            <div className="ybc-label">时间</div>
            <div className="ybc-three">
              <label className="ybc-field">
                <span>日期</span>
                <DatePicker value={dateStr} onChange={setDateStr} disabled={busy}
                  className="h-11 rounded-xl text-sm font-normal" placeholder="选择日期" />
              </label>
              <label className="ybc-field">
                <span>开始</span>
                <input type="time" className={`ybc-input ${errors.time ? 'err' : ''}`} value={startStr}
                  onChange={(e) => typeTime('start', e.target.value)} disabled={busy} />
              </label>
              <label className="ybc-field">
                <span>结束</span>
                <input type="time" className={`ybc-input ${errors.time ? 'err' : ''}`} value={endStr}
                  onChange={(e) => typeTime('end', e.target.value)} disabled={busy} />
              </label>
            </div>
            {errors.time && <em className="ybc-err" role="alert">{errors.time}</em>}
            <p className="ybc-hint">
              {autoDur ? <>系统自动记录用时：<b className="num">{autoDur}</b> 分钟</> : '填写开始和结束后自动计算用时'}
            </p>
            <div className="ybc-shortcuts" role="group" aria-label="快速设置时长">
              <span>快速设置时长：</span>
              {DURATION_SHORTCUTS.map(m => (
                <button key={m} type="button" onClick={() => applyShortcut(m)} disabled={busy}
                  aria-pressed={autoDur === m}>{m}分钟</button>
              ))}
            </div>
          </div>

          <div className="ybc-two">
            <div className="ybc-block">
              <div className="ybc-label">学习行为类别</div>
              <div className="ybc-cats" role="radiogroup" aria-label="学习行为类别">
                {CATEGORY_OPTS.map(o => (
                  <button key={o.key} type="button" role="radio" aria-checked={category === o.key}
                    onClick={() => pickCategory(o.key)} disabled={busy}>{o.label}</button>
                ))}
              </div>
            </div>
            <div className="ybc-block">
              <div className="ybc-label">学习行为形式</div>
              {!addingCustom ? (
                <select className={`ybc-input ${errors.form ? 'err' : ''}`} value={formValue} disabled={busy}
                  aria-label="学习行为形式"
                  onChange={(e) => { if (e.target.value === ADD_OTHER) setAddingCustom(true); else setFormValue(e.target.value); }}>
                  <option value="">请选择</option>
                  {formOptions.map(n => <option key={n} value={n}>{n}</option>)}
                  <option value={ADD_OTHER}>＋ 其他 / 自定义…</option>
                </select>
              ) : (
                <div className="ybc-custom">
                  <input type="text" className="ybc-input" placeholder="填写一个新的形式名称，如：家教辅导"
                    aria-label="新的学习行为形式" value={customInput} autoFocus disabled={busy}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
                  <button type="button" className="yb-btn sm" onClick={addCustom} disabled={busy}>添加</button>
                  <button type="button" className="yb-btn sm quiet" onClick={() => { setAddingCustom(false); setCustomInput(''); }} disabled={busy}>取消</button>
                </div>
              )}
              {errors.form && <em className="ybc-err">{errors.form}</em>}
            </div>
          </div>

          <div className="ybc-two">
            <div className="ybc-block">
              <div className="ybc-label">主观评价 <small>* 必填</small></div>
              <GlassRail steps={SUBJECTIVE_STEPS} idx={subjIdx} onChange={setSubjIdx} disabled={busy} label="主观评价" />
            </div>
            {category === 3 ? (
              <div className="ybc-block">
                <div className="ybc-label">客观评价 <small>（可选）</small></div>
                <div className="ybc-mode" role="radiogroup" aria-label="客观评价填写方式">
                  {[['now', '现在填写'], ['later', '稍后补充'], ['na', 'N/A 不适用']].map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={objMode === k}
                      onClick={() => setObjMode(k)} disabled={busy}>{l}</button>
                  ))}
                </div>
                {objMode === 'later' ? (
                  <p className="ybc-note">已选择稍后补充。可在「待补填」里补填客观评价。</p>
                ) : (
                  <>
                    <GlassRail steps={OBJECTIVE_STEPS} idx={objIdx} tone="obj" label="客观评价"
                      onChange={(v) => { setObjIdx(v); setIsObjNA(false); }} disabled={busy || isObjNA} />
                    <div className={`ybc-legend ${isObjNA ? 'off' : ''}`}>
                      <div className="cap">letter grade 对应的百分制区间（参考）</div>
                      {[...OBJECTIVE_STEPS].reverse().map(s => (
                        <div key={s.label} className={!isObjNA && OBJECTIVE_STEPS[objIdx]?.label === s.label ? 'on' : undefined}>
                          <b>{s.label}</b><span className="num">{GRADE_RANGES[s.label]}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {shouldWarnClearGrade({ editing, editHadGrade, objDeferred, category }) && (
                  <p className="ybc-note warn">{CLEAR_GRADE_WARNING}</p>
                )}
              </div>
            ) : notesBlock}
          </div>

          {category === 3 && notesBlock}

          <div className="ybc-actions">
            <button type="button" className="yb-btn ybc-submit" onClick={submit} disabled={busy}>
              {busy ? '保存中…' : editing ? '保存修改' : '保存记录'}
            </button>
            {editing && (
              <button type="button" className="yb-btn ghost ybc-submit" onClick={onCancelEdit} disabled={busy}>取消编辑</button>
            )}
          </div>
        </>
      )}
    </section>
  );
});

export default ClassicLogForm;
