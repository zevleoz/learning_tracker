import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/useAuth.js';
import { toast } from '../lib/toast.js';

/* ---------- 常量定义 ---------- */

// 学习行为类别（category）
const CATEGORY_OPTS = [
  { key: 1, label: '复习' },
  { key: 2, label: '练习' },
  { key: 3, label: '学习' },
];

// 学习行为形式（预设 form，字符串；按学习行为类别分组；
// 额外的 "+其他/自定义" 通过 ADD_OTHER_SENTINEL 让用户新增，不与预设重复）
const ADD_OTHER_SENTINEL = '__ADD_OTHER__';
const FORM_PRESET_BY_CATEGORY = {
  3: ['自主预习', '校外线上', '校外线下'],       // 学习
  1: ['自主复习', '校外线上', '校外线下'],       // 复习
  2: ['自主练习', '校外线上', '校外线下', '课外作业', '学校作业'], // 练习
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

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function toTimeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtRecentDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const today = toDateStr(now);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const ds = toDateStr(d);
  const ts = toTimeStr(d);
  if (ds === today) return `今天 ${ts}`;
  if (ds === toDateStr(yest)) return `昨天 ${ts}`;
  return `${d.getMonth()+1}/${d.getDate()} ${ts}`;
}

/* ============ 渐变吸附式滑轨 GlassRail ============ */
function GlassRail({ steps, idx, onChange, disabled, labelFn }) {
  const n = steps.length;
  // 吸附点百分比（首尾留一点空间让 thumb 不贴边）
  const pct = (i) => {
    if (n === 1) return 50;
    return (i / (n - 1)) * 100;
  };
  const label = (labelFn || ((s) => s.label))(steps[idx]);
  return (
    <div className="glass-rail">
      <div className="glass-rail-track">
        {/* 吸附点 */}
        <div className="glass-rail-steps">
          {steps.map((_, i) => <span key={i} style={{ opacity: i === idx ? 1 : 0.55 }} />)}
        </div>
        {/* 隐藏的原生 input（用来接收滑动事件） */}
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={idx}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {/* 绝对定位 thumb */}
        <div className="glass-rail-thumb-wrap">
          <div
            className="glass-rail-thumb"
            style={{ left: `${pct(idx)}%` }}
          />
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
  const [category, setCategory] = useState(3); // 默认"学习"

  /* --- 评估方式 --- */
  const [evalType, setEvalType] = useState(1); // 1=主观 2=客观
  const [subjIdx, setSubjIdx] = useState(3);   // 默认"基本掌握" → 80
  const [objIdx, setObjIdx] = useState(9);     // 默认"B+"

  /* --- 备注 --- */
  const [notes, setNotes] = useState('');

  /* --- 提交状态 / 最近记录 --- */
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const [editingSessionId, setEditingSessionId] = useState(null);

  /* ========== 载入：课程 tree ========== */
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from('courses')
        .select('id, name, subject, chapters(id, name, units(id, name))')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (error) { console.error(error); return; }
      const list = (data || []).map(c => ({
        ...c,
        chapters: (c.chapters || []).sort((a,b)=>a.order_idx-b.order_idx)
          .map(ch => ({ ...ch, units: (ch.units || []).sort((x,y)=>x.order_idx-y.order_idx) })),
      }));
      setCourses(list);
      if (list.length) setCourseId(list[0].id);
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
      if (error) { console.error(error); return; }
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
          course:courses(id,name,subject),
          chapter:chapters(id,name),
          unit:units(id,name)
        `)
        .eq('student_id', user.id)
        .is('deleted_at', null)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) { console.error(error); return; }
      setRecent(data || []);
    })();
  }, [user]);

  /* ========== 添加自定义 学习行为形式 ========== */
  async function onAddCustomForm() {
    const name = customInput.trim();
    if (!name) return;
    if (FORM_PRESET.includes(name) || customForms.includes(name)) {
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
      alert('保存失败：' + e.message);
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
    if (!courseId || !chapterId || !unitId) { alert('请选择课程 / 章节 / 单元'); return; }
    if (!startStr || !endStr) { alert('请填写开始和结束时间'); return; }
    if (!formValue) { alert('请选择学习行为形式'); return; }

    const duration = computeDuration();
    if (!duration || duration <= 0) { alert('结束时间需晚于开始时间'); return; }

    // 组装 payload：根据评估方式只传对应字段，避免触发 check 约束
    const payload = {
      student_id: user.id,
      course_id: courseId,
      chapter_id: chapterId,
      unit_id: unitId,
      category,
      form: formValue,
      eval_type: evalType,
      duration_minutes: duration,
      notes: notes.trim() || null,
      session_date: dateStr,
      start_time: startStr + ':00',
      end_time: endStr + ':00',
      ...(evalType === 1
        ? { self_rating: SUBJECTIVE_STEPS[subjIdx].value }
        : { grade_label: OBJECTIVE_STEPS[objIdx].label }),
    };

    setBusy(true);
    try {
      const { error } = await supabase.from('learning_sessions').insert(payload);
      if (error) throw error;

      // 重置表单（保留课程选择）
      const d = new Date();
      setStartStr(toTimeStr(d));
      setEndStr('');
      setNotes('');
      setEvalType(1);
      setSubjIdx(3);
      setObjIdx(9);

      // 刷新列表
      const { data } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, end_time, duration_minutes,
          category, form, eval_type, self_rating, grade_label, notes,
          course:courses(id,name,subject),
          chapter:chapters(id,name),
          unit:units(id,name)
        `)
        .eq('student_id', user.id)
        .is('deleted_at', null)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
      setRecent(data || []);
    } catch (err) {
      const msg = err.message || '保存失败';
      const details = err.details ? `\n\n详情: ${err.details}` : '';
      const code = err.code ? `\n代码: ${err.code}` : '';
      if (msg.includes('self_rating') || msg.includes('not-null') || msg.includes('constraint')) {
        alert(
          '数据库字段需要调整：\n\n' +
          '请在 Supabase SQL Editor 执行这两条：\n\n' +
          'alter table public.learning_sessions alter column self_rating drop not null;\n' +
          'alter table public.learning_sessions alter column grade_label drop not null;\n\n' +
          msg + details + code
        );
      } else {
        alert(msg + details + code);
      }
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
    setCategory(r.category || 3);
    setFormValue(r.form || '');
    setEvalType(r.eval_type || 1);
    if (r.eval_type === 1) {
      const idx = SUBJECTIVE_STEPS.findIndex(s => s.value === r.self_rating);
      setSubjIdx(idx >= 0 ? idx : 3);
    } else {
      const idx = OBJECTIVE_STEPS.findIndex(s => s.label === r.grade_label);
      setObjIdx(idx >= 0 ? idx : 9);
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
    setCategory(3);
    setFormValue('');
    setEvalType(1);
    setSubjIdx(3);
    setObjIdx(9);
    setNotes('');
  }

  async function onSaveEdit() {
    if (!courseId || !chapterId || !unitId) { alert('请选择课程 / 章节 / 单元'); return; }
    if (!startStr || !endStr) { alert('请填写开始和结束时间'); return; }
    if (!formValue) { alert('请选择学习行为形式'); return; }

    const duration = computeDuration();
    if (!duration || duration <= 0) { alert('结束时间需晚于开始时间'); return; }

    const payload = {
      course_id: courseId,
      chapter_id: chapterId,
      unit_id: unitId,
      category,
      form: formValue,
      eval_type: evalType,
      duration_minutes: duration,
      notes: notes.trim() || null,
      session_date: dateStr,
      start_time: startStr + ':00',
      end_time: endStr + ':00',
      ...(evalType === 1
        ? { self_rating: SUBJECTIVE_STEPS[subjIdx].value, grade_label: null }
        : { grade_label: OBJECTIVE_STEPS[objIdx].label, self_rating: null }),
    };

    setBusy(true);
    try {
      const { error } = await supabase
        .from('learning_sessions')
        .update(payload)
        .eq('id', editingSessionId);
      if (error) throw error;
      toast('已更新', { kind: 'success' });

      // 重新拉取列表
      const { data } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, end_time, duration_minutes,
          category, form, eval_type, self_rating, grade_label, notes,
          course:courses(id,name,subject),
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
    } catch (err) {
      alert(err.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  /* ========== 删除（软删除）========== */
  async function onDelete(r) {
    if (!confirm('确认删除该学习记录？')) return;
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
      alert(err.message || '删除失败');
    } finally {
      setBusy(false);
    }
  }

  /* ========== helper 渲染 ========== */
  // 预设列表按学习行为类别切换；用户自定义项在任意类别下都可选择
  const currentPreset = FORM_PRESET_BY_CATEGORY[category] || FORM_PRESET_BY_CATEGORY[3];
  const customForCategory = customForms.filter(n => !ALL_FORM_PRESET.includes(n));
  const formOptions = [...currentPreset, ...customForCategory];

  // 当学习行为类别改变时，如果当前 formValue 不在新列表里，就清空，避免提交时漏选
  useEffect(() => {
    if (formValue && !formOptions.includes(formValue)) setFormValue('');
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps
  const catLabel = (k) => CATEGORY_OPTS.find(c => c.key === k)?.label || '';
  const evalLabel = (t, sr, gl) => {
    if (t === 1) return `主观：${SUBJECTIVE_STEPS.find(s => s.value === sr)?.label || '-'}`;
    return `客观：${gl || '-'}`;
  };
  const autoDur = computeDuration();

  /* ========== JSX ========== */
  return (
    <div className="learn-wrap animate-fade-in">

      <div className="page-title">
        <h1>记录</h1>
        <p>填写一次学习行为，数据积累帮你了解自己</p>
      </div>

      {/* ====== 表单卡片 ====== */}
      <div className="glass-sheet record-sheet">

        {/* ---- 1) 课程 / 章节 / 单元 ---- */}
        <div className="rec-block">
          <div className="rec-label">课程 / 章节 / 单元</div>
          <div className="three-col">
            <div className="field">
              <label>课程</label>
              <select className="input input-strong"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                disabled={busy}>
                <option value="">请选择</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="field">
              <label>章节</label>
              <select className="input input-strong"
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                disabled={busy || !activeCourse}>
                <option value="">{activeCourse ? '请选择' : '先选课程'}</option>
                {activeCourse?.chapters?.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
              </select>
            </div>

            <div className="field">
              <label>单元</label>
              <select className="input input-strong"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={busy || !activeChapter}>
                <option value="">{activeChapter ? '请选择' : '先选章节'}</option>
                {activeChapter?.units?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ---- 2) 日期 + 开始/结束时间 ---- */}
        <div className="rec-block">
          <div className="rec-label">时间</div>
          <div className="three-col">
            <div className="field">
              <label>日期</label>
              <input type="date" className="input input-strong"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                disabled={busy} />
            </div>
            <div className="field">
              <label>开始</label>
              <input type="time" className="input input-strong"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                disabled={busy} />
            </div>
            <div className="field">
              <label>结束</label>
              <input type="time" className="input input-strong"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                disabled={busy} />
            </div>
          </div>
          {autoDur ? (
            <div className="rec-hint">系统自动记录用时：<b>{autoDur}</b> 分钟</div>
          ) : (
            <div className="rec-hint rec-hint-dim">填写开始和结束后自动计算用时</div>
          )}
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
              <select className="input input-strong"
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

        {/* ---- 5) 评估方式 ---- */}
        <div className="rec-block">
          <div className="rec-label">评估方式</div>
          <div className="btn-row">
            <button type="button"
              className={'seg-btn' + (evalType === 1 ? ' active' : '')}
              onClick={() => setEvalType(1)} disabled={busy}>主观评估</button>
            <button type="button"
              className={'seg-btn' + (evalType === 2 ? ' active' : '')}
              onClick={() => setEvalType(2)} disabled={busy}>客观评估</button>
          </div>

          {evalType === 1 ? (
            <GlassRail
              steps={SUBJECTIVE_STEPS}
              idx={subjIdx}
              onChange={setSubjIdx}
              disabled={busy}
              labelFn={(s) => s.label}
            />
          ) : (
            <div>
              <GlassRail
                steps={OBJECTIVE_STEPS}
                idx={objIdx}
                onChange={setObjIdx}
                disabled={busy}
                labelFn={(s) => s.label}
              />
              {/* letter grade → 百分制 参考表 */}
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
              }}>
                {/* 首行标题，4 列合并 */}
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                  letter grade 对应的百分制区间（参考）
                </div>
                {['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'].map(g => (
                  <div key={g} style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '2px 4px',
                    background: g === OBJECTIVE_STEPS[objIdx]?.label
                      ? 'rgba(99,102,241,0.18)'
                      : 'transparent',
                    borderRadius: 6,
                  }}>
                    <span style={{ fontWeight: 700, color: g === OBJECTIVE_STEPS[objIdx]?.label ? '#4338ca' : '#475569' }}>
                      {g}
                    </span>
                    <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                      {GRADE_RANGES[g]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---- 6) 备注 ---- */}
        <div className="rec-block">
          <div className="rec-label">备注</div>
          <textarea
            rows="3"
            className="input input-strong"
            placeholder={evalType === 2
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
              {busy ? '保存中…' : '保存修改'}
            </button>
            <button type="button" className="btn btn-ghost btn-submit" onClick={onCancelEdit} disabled={busy}>
              取消编辑
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary btn-submit" onClick={onSubmit} disabled={busy}>
            {busy ? '保存中…' : '保存记录'}
          </button>
        )}
      </div>

      {/* ====== 最近记录 ====== */}
      <div className="recent-title">最近记录</div>
      {recent.length === 0 ? (
        <div className="glass recent-empty">还没有记录，从上面的表单开始吧</div>
      ) : (
        <div className="recent-list">
          {recent.map(r => (
            <div key={r.id} className="glass record-item"
              style={editingSessionId === r.id ? { border: '2px solid #6366f1', boxShadow: '0 2px 8px rgba(99,102,241,0.18)' } : {}}
            >
              <div className="record-main">
                <div className="record-course">{r.course?.name || '-'}</div>
                <div className="record-path">
                  {r.chapter?.name || '-'} · {r.unit?.name || '-'}
                </div>
                <div className="record-meta">
                  <span className="pill pill-soft">{catLabel(r.category)}</span>
                  <span className="pill pill-soft">{r.form}</span>
                  <span className="pill pill-soft">{evalLabel(r.eval_type, r.self_rating, r.grade_label)}</span>
                </div>
                {r.notes && <div className="record-notes">{r.notes}</div>}
              </div>
              <div className="record-right">
                <div className="record-minutes">{r.duration_minutes} 分钟</div>
                <div className="record-time">{fmtRecentDate(r.session_date)}</div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => onStartEdit(r)}
                    title="编辑"
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                  >✏️ 编辑</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => onDelete(r)}
                    title="删除"
                    style={{ padding: '4px 10px', fontSize: '12px', color: '#c05621' }}
                  >🗑️ 删除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
