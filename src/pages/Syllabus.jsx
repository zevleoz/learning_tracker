import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';

export default function Syllabus() {
  const [courses, setCourses] = useState([]);
  const [schoolName, setSchoolName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDesktop, setIsDesktop] = useState(window.matchMedia('(min-width: 768px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('school_name')
        .eq('id', user.id)
        .maybeSingle();
      const mySchool = profile?.school_name;
      if (mySchool) setSchoolName(mySchool);

      const { data: cs } = await supabase
        .from('courses')
        .select(`
          id, name, subject, source, created_by,
          chapters:chapters(id, name, order_idx, units(id, name, order_idx))
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      const sorted = (cs || []).filter((c) => {
        if (c.created_by === user.id) return true;
        if (!mySchool) return false;
        return true;
      }).map((c) => ({
        ...c,
        _isOwn: c.created_by === user.id,
        chapters: (c.chapters || [])
          .sort((a, b) => (a.order_idx || 0) - (b.order_idx || 0))
          .map((ch) => ({
            ...ch,
            units: (ch.units || [])
              .sort((a, b) => (a.order_idx || 0) - (b.order_idx || 0))
          }))
      }));
      setCourses(sorted);
      setLoading(false);
    })();
  }, []);

  /* ===== 添加课程 ===== */
  async function createCourse({ name, courseType }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return toast('请先登录', { kind: 'error' });

    const trimmedName = name.trim();
    if (!trimmedName) return toast('请填写课程名称', { kind: 'error' });

    const existing = courses.find(c => c.name === trimmedName);
    if (existing) return toast('该课程名称已存在', { kind: 'error' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .maybeSingle();

    const { error, data: created } = await supabase
      .from('courses')
      .insert({
        name: trimmedName,
        subject: '',
        course_type: courseType,
        school_id: profile?.school_id || null,
        created_by: user.id
      })
      .select()
      .single();

    if (error) return toast(error.message, { kind: 'error' });
    toast('课程已创建', { kind: 'success' });
    setCourses((prev) => [{ ...created, _isOwn: true, chapters: [] }, ...prev]);
  }

  /* ===== 添加章节 ===== */
  async function addChapter(courseId, name) {
    const course = courses.find((c) => c.id === courseId);
    const nextIdx = (course?.chapters?.length || 0) + 1;

    const { error, data: ch } = await supabase
      .from('chapters')
      .insert({ course_id: courseId, name: name.trim(), order_idx: nextIdx })
      .select('id, name, order_idx')
      .single();

    if (error) return toast(error.message, { kind: 'error' });
    toast('章节已添加', { kind: 'success' });
    setCourses((prev) => prev.map((c) =>
      c.id === courseId
        ? { ...c, chapters: [...(c.chapters || []), { ...ch, units: [] }] }
        : c
    ));
  }

  /* ===== 添加单元 ===== */
  async function addUnit(courseId, chapterId, name) {
    const course = courses.find((c) => c.id === courseId);
    const chapter = course?.chapters?.find((ch) => ch.id === chapterId);
    const nextIdx = (chapter?.units?.length || 0) + 1;

    const { error, data: u } = await supabase
      .from('units')
      .insert({ chapter_id: chapterId, name: name.trim(), order_idx: nextIdx })
      .select('id, name, order_idx')
      .single();

    if (error) return toast(error.message, { kind: 'error' });
    toast('单元已添加', { kind: 'success' });

    setCourses((prev) => prev.map((c) =>
      c.id === courseId
        ? {
            ...c,
            chapters: c.chapters.map((ch) =>
              ch.id === chapterId
                ? { ...ch, units: [...(ch.units || []), u] }
                : ch
            )
          }
        : c
    ));
  }

  /* ========== 编辑 ========== */
  async function updateCourse(courseId, { name, courseType }) {
    const { error } = await supabase
      .from('courses')
      .update({ name: name.trim(), course_type: courseType })
      .eq('id', courseId);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已更新', { kind: 'success' });
    setCourses(prev => prev.map(c => c.id === courseId ? { ...c, name: name.trim(), course_type: courseType } : c));
  }

  async function updateChapter(chapterId, name, courseId) {
    const { error } = await supabase
      .from('chapters')
      .update({ name: name.trim() })
      .eq('id', chapterId);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已更新', { kind: 'success' });
    setCourses(prev => prev.map(c => c.id === courseId ? { ...c, chapters: c.chapters.map(ch => ch.id === chapterId ? { ...ch, name: name.trim() } : ch) } : c));
  }

  async function updateUnit(unitId, name, chapterId, courseId) {
    const { error } = await supabase
      .from('units')
      .update({ name: name.trim() })
      .eq('id', unitId);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已更新', { kind: 'success' });
    setCourses(prev => prev.map(c => c.id === courseId ? { ...c, chapters: c.chapters.map(ch => ch.id === chapterId ? { ...ch, units: (ch.units || []).map(u => u.id === unitId ? { ...u, name: name.trim() } : u) } : ch) } : c));
  }

  /* ========== 删除（软删除）========== */
  async function deleteCourse(courseId) {
    if (!confirm('确认删除该课程及其所有章节/单元？')) return;
    const { error } = await supabase
      .from('courses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', courseId);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已删除', { kind: 'success' });
    setCourses(prev => prev.filter(c => c.id !== courseId));
  }

  async function deleteChapter(chapterId, courseId) {
    if (!confirm('确认删除该章节及其所有单元？')) return;
    const { error } = await supabase
      .from('chapters')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', chapterId);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已删除', { kind: 'success' });
    setCourses(prev => prev.map(c => c.id === courseId ? { ...c, chapters: (c.chapters || []).filter(ch => ch.id !== chapterId) } : c));
  }

  async function deleteUnit(unitId, chapterId, courseId) {
    if (!confirm('确认删除该单元？')) return;
    const { error } = await supabase
      .from('units')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', unitId);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已删除', { kind: 'success' });
    setCourses(prev => prev.map(c => c.id === courseId ? { ...c, chapters: (c.chapters || []).map(ch => ch.id === chapterId ? { ...ch, units: (ch.units || []).filter(u => u.id !== unitId) } : ch) } : c));
  }

  const myCourses = courses.filter((c) => c._isOwn);
  const sharedCourses = courses.filter((c) => !c._isOwn);

  if (isDesktop) {
    return (
      <DesktopTree
        myCourses={myCourses}
        sharedCourses={sharedCourses}
        loading={loading}
        schoolName={schoolName}
        onAddCourse={createCourse}
        onAddChapter={addChapter}
        onAddUnit={addUnit}
        onUpdateCourse={updateCourse}
        onDeleteCourse={deleteCourse}
        onUpdateChapter={updateChapter}
        onDeleteChapter={deleteChapter}
        onUpdateUnit={updateUnit}
        onDeleteUnit={deleteUnit}
      />
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-title">
        <h1>课程大纲</h1>
        <p>
          {schoolName
            ? <>所在学校：<strong style={{ color: 'var(--brand)' }}>{schoolName}</strong> · 与同学共享课程</>
            : '在这里管理你的课程 → 章节 → 单元'}
        </p>
      </div>

      <AddCourseCard onSubmit={createCourse} />

      {loading ? (
        <div className="empty-state">
          <div className="empty-state-icon">⏳</div>
          <h3>加载中…</h3>
        </div>
      ) : (
        <>
          {myCourses.length > 0 && (
            <>
              <SectionLabel title="我创建的课程" count={myCourses.length} />
              {myCourses.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  onAddChapter={addChapter}
                  onAddUnit={addUnit}
                  onUpdateCourse={updateCourse}
                  onDeleteCourse={deleteCourse}
                  onUpdateChapter={updateChapter}
                  onDeleteChapter={deleteChapter}
                  onUpdateUnit={updateUnit}
                  onDeleteUnit={deleteUnit}
                  canEdit
                />
              ))}
            </>
          )}

          {sharedCourses.length > 0 && (
            <>
              <SectionLabel title="同校同学创建的课程" count={sharedCourses.length} />
              {sharedCourses.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  onAddChapter={addChapter}
                  onAddUnit={addUnit}
                  shared
                />
              ))}
            </>
          )}

          {courses.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📖</div>
              <h3>还没有任何课程</h3>
              <p>点击上方 "添加新课程" 创建第一个课程吧！</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============ 分区标签 ============ */
function SectionLabel({ title, count }) {
  return (
    <div className="section-label">
      <span>{title}</span>
      <span className="count">{count}</span>
    </div>
  );
}

/* ============ 添加课程卡片 ============ */
function AddCourseCard({ onSubmit }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [courseType, setCourseType] = useState(1);

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      return toast('请填写课程名称', { kind: 'error' });
    }
    onSubmit({ name, courseType });
    setName(''); setCourseType(1);
    setExpanded(false);
  }

  if (!expanded) {
    return (
      <button
        className="btn btn-primary"
        onClick={() => setExpanded(true)}
        style={{ marginBottom: '14px' }}
      >
        <span style={{ marginRight: '6px' }}>+</span>添加新课程
      </button>
    );
  }

  return (
    <div className="glass" style={{ padding: '20px 22px', marginBottom: '14px' }}>
      <div className="course-card-header">
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-strong)' }}>
          添加新课程
        </div>
        <button
          onClick={() => { setExpanded(false); setName(''); setCourseType(1); }}
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px 12px' }}
        >
          取消
        </button>
      </div>

      <form onSubmit={submit}>
        <div className="field">
          <label>课程名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：AP 微积分 BC"
            autoFocus
          />
        </div>
        <div className="field">
          <label>课程类型</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setCourseType(1)}
              style={{
                flex: 1,
                padding: '10px 14px',
                fontSize: '14px',
                borderRadius: '10px',
                border: '2px solid',
                borderColor: courseType === 1 ? '#10b981' : 'rgba(0,0,0,0.12)',
                background: courseType === 1 ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.7)',
                color: courseType === 1 ? '#059669' : '#475569',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 150ms ease',
              }}
            >
              🏫 校内
            </button>
            <button
              type="button"
              onClick={() => setCourseType(2)}
              style={{
                flex: 1,
                padding: '10px 14px',
                fontSize: '14px',
                borderRadius: '10px',
                border: '2px solid',
                borderColor: courseType === 2 ? '#f59e0b' : 'rgba(0,0,0,0.12)',
                background: courseType === 2 ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.7)',
                color: courseType === 2 ? '#d97706' : '#475569',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 150ms ease',
              }}
            >
              🎓 校外
            </button>
          </div>
        </div>
        <button type="submit" className="btn btn-primary">创建课程</button>
      </form>
    </div>
  );
}

/* ============ 单个课程卡片 ============ */
function CourseCard({
  course, onAddChapter, onAddUnit, shared, canEdit,
  onUpdateCourse, onDeleteCourse,
  onUpdateChapter, onDeleteChapter,
  onUpdateUnit, onDeleteUnit,
}) {
  const [addingChapter, setAddingChapter] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(course.name);
  const [editCourseType, setEditCourseType] = useState(course.course_type || 1);

  function submitCourseEdit(e) {
    e.preventDefault();
    if (!editName.trim()) {
      return toast('请填写课程名称', { kind: 'error' });
    }
    onUpdateCourse(course.id, { name: editName, courseType: editCourseType });
    setEditing(false);
  }

  const courseTypeLabel = editCourseType === 2 ? '校外课程' : '校内课程';

  return (
    <div className="course-card">
      <div className="course-card-header">
        {editing ? (
          <div style={{ flex: 1 }}>
            <form onSubmit={submitCourseEdit} style={{ display: 'grid', gap: '6px' }}>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="课程名称"
                style={inputStyle}
              />
              <select
                value={editCourseType}
                onChange={(e) => setEditCourseType(Number(e.target.value))}
                style={inputStyle}
              >
                <option value={1}>校内课程</option>
                <option value={2}>校外课程</option>
              </select>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" type="submit">保存</button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => { setEditing(false); setEditName(course.name); setEditCourseType(course.course_type || 1); }}
                >取消</button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <div className="course-card-title">{course.name}</div>
            <div className="course-card-subject">{(course.course_type === 2 ? '校外课程' : '校内课程')}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {!editing && (
            <span className={'pill ' + (shared ? 'gold' : 'red')}>
              {shared ? '同校共享' : `${course.chapters?.length || 0} 个章节`}
            </span>
          )}
          {canEdit && !editing && (
            <IconBtn title="编辑课程" onClick={() => setEditing(true)}>
              <Pencil size={14} strokeWidth={2.2} />
            </IconBtn>
          )}
          {canEdit && !editing && (
            <IconBtn title="删除课程" onClick={() => onDeleteCourse(course.id)}>
              <Trash2 size={14} strokeWidth={2.2} />
            </IconBtn>
          )}
        </div>
      </div>

      <hr className="hr-soft" />

      {/* 章节列表 */}
      {course.chapters && course.chapters.length > 0 ? (
        course.chapters.map((ch, idx) => (
          <ChapterRow
            key={ch.id}
            chapter={ch}
            index={idx}
            courseId={course.id}
            chapterId={ch.id}
            onAddUnit={onAddUnit}
            onUpdate={canEdit ? onUpdateChapter : undefined}
            onDelete={canEdit ? onDeleteChapter : undefined}
            onUpdateUnit={canEdit ? onUpdateUnit : undefined}
            onDeleteUnit={canEdit ? onDeleteUnit : undefined}
            canEdit={canEdit}
          />
        ))
      ) : (
        <div className="chapter-empty">还没有章节</div>
      )}

      {/* 添加章节 */}
      {addingChapter ? (
        <InlineInput
          placeholder="如：函数与导数"
          onSubmit={(name) => { onAddChapter(course.id, name); setAddingChapter(false); }}
          onCancel={() => setAddingChapter(false)}
        />
      ) : (
        <button className="btn-add" onClick={() => setAddingChapter(true)}>
          <span>+</span> 添加章节
        </button>
      )}
    </div>
  );
}

/* ============ 单个章节行 ============ */
function ChapterRow({
  chapter, index, courseId, onAddUnit,
  onUpdate, onDelete,
  onUpdateUnit, onDeleteUnit, canEdit,
}) {
  const [addingUnit, setAddingUnit] = useState(false);
  const [editingChapter, setEditingChapter] = useState(false);
  const [editingChapterName, setEditingChapterName] = useState(chapter.name);
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [editingUnitName, setEditingUnitName] = useState('');
  const unitCount = chapter.units?.length || 0;

  function submitChapter(e) {
    e.preventDefault();
    if (!editingChapterName.trim()) return toast('请填写章节名称', { kind: 'error' });
    onUpdate(chapter.id, editingChapterName, courseId);
    setEditingChapter(false);
  }

  function startEditUnit(u) {
    setEditingUnitId(u.id);
    setEditingUnitName(u.name);
  }

  function submitUnitEdit(e, unitId) {
    e.preventDefault();
    if (!editingUnitName.trim()) return toast('请填写单元名称', { kind: 'error' });
    onUpdateUnit(unitId, editingUnitName, chapter.id, courseId);
    setEditingUnitId(null);
  }

  return (
    <div className="chapter-row">
      <div className="chapter-head">
        <span className="chapter-index">第 {index + 1} 章</span>

        {editingChapter ? (
          <form onSubmit={submitChapter} style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1 }}>
            <input
              value={editingChapterName}
              onChange={(e) => setEditingChapterName(e.target.value)}
              placeholder="章节名称"
              style={inputStyle}
            />
            <button className="btn btn-primary btn-sm" type="submit">保存</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditingChapter(false)}>取消</button>
          </form>
        ) : (
          <div style={{
            fontSize: '14px', fontWeight: 600, color: 'var(--text-strong)',
            lineHeight: 1.4, flex: 1
          }}>{chapter.name}</div>
        )}

        {unitCount > 0 && !editingChapter && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
            {unitCount} 个单元
          </span>
        )}
        {canEdit && !editingChapter && (
          <IconBtn title="编辑章节" onClick={() => setEditingChapter(true)}>
            <Pencil size={12} strokeWidth={2.2} />
          </IconBtn>
        )}
        {canEdit && !editingChapter && (
          <IconBtn title="删除章节" onClick={() => onDelete(chapter.id, courseId)}>
            <Trash2 size={12} strokeWidth={2.2} />
          </IconBtn>
        )}
      </div>

      {unitCount > 0 && (
        <div className="unit-list">
          {chapter.units.map((u) => (
            <div key={u.id} className="unit-row" style={{ alignItems: 'center' }}>
              <span style={{
                color: 'var(--gold)', fontWeight: 700,
                flexShrink: 0, fontSize: '12px', marginTop: '2px'
              }}>·</span>
              {editingUnitId === u.id ? (
                <form
                  onSubmit={(e) => submitUnitEdit(e, u.id)}
                  style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1 }}
                >
                  <input
                    value={editingUnitName}
                    onChange={(e) => setEditingUnitName(e.target.value)}
                    placeholder="单元名称"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button className="btn btn-primary btn-sm" type="submit">保存</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => setEditingUnitId(null)}
                  >取消</button>
                </form>
              ) : (
                <span style={{ flex: 1 }}>{u.name}</span>
              )}
              {canEdit && editingUnitId !== u.id && (
                <>
                  <IconBtn title="编辑单元" onClick={() => startEditUnit(u)}>
                    <Pencil size={11} strokeWidth={2.2} />
                  </IconBtn>
                  <IconBtn title="删除单元" onClick={() => onDeleteUnit(u.id, chapter.id, courseId)}>
                    <Trash2 size={11} strokeWidth={2.2} />
                  </IconBtn>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {addingUnit ? (
        <div style={{ marginLeft: '44px', marginTop: unitCount > 0 ? '6px' : '0' }}>
          <InlineInput
            placeholder="如：导数的定义"
            small
            onSubmit={(name) => { onAddUnit(courseId, chapter.id, name); setAddingUnit(false); }}
            onCancel={() => setAddingUnit(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setAddingUnit(true)}
          style={{
            marginLeft: '44px',
            marginTop: '2px',
            padding: '5px 10px',
            fontSize: '12px',
            color: 'var(--text-soft)',
            background: 'transparent',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            transition: 'background 140ms ease, color 140ms ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
            e.currentTarget.style.color = 'var(--brand)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-soft)';
          }}
        >
          <span style={{ fontSize: '13px', lineHeight: 1 }}>+</span> 添加单元
        </button>
      )}
    </div>
  );
}

/* ============ 内联输入框（回车提交/Esc 取消） ============ */
function InlineInput({ placeholder, onSubmit, onCancel, small, initialValue }) {
  const [value, setValue] = useState(initialValue || '');

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (value.trim()) onSubmit(value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setValue('');
      onCancel();
    }
  }

  function handleBlur() {
    if (value.trim()) onSubmit(value.trim());
    else onCancel();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        autoFocus
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: small ? '8px 12px' : '10px 14px',
          fontSize: small ? '13px' : '14px',
          border: '1px solid rgba(15,23,42,0.1)',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.55)',
          outline: 'none',
          fontFamily: 'inherit',
          boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.6), inset -1px -1px 0 rgba(15,23,42,0.04), 0 0 0 3px rgba(193,39,45,0.1)',
          transition: 'all 160ms ease',
          color: 'var(--text-strong)'
        }}
      />
      <div style={{
        fontSize: '10px',
        color: 'var(--text-muted)',
        marginTop: '4px',
        display: 'flex',
        gap: '6px',
        padding: '0 2px'
      }}>
        <span>回车提交</span><span>·</span><span>Esc 取消</span>
      </div>
    </form>
  );
}

/* ============ 工具：小图标按钮 ============ */
function IconBtn({ children, onClick, title, style }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '4px 6px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '13px',
        lineHeight: 1,
        color: 'var(--text-soft)',
        transition: 'background 140ms ease, transform 140ms ease',
        ...(style || {})
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.7)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

/* ============ 工具：通用输入框样式 ============ */
const inputStyle = {
  padding: '8px 12px',
  fontSize: '14px',
  border: '1px solid rgba(15,23,42,0.12)',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.7)',
  outline: 'none',
  fontFamily: 'inherit',
  color: 'var(--text-strong)'
};

/* ============ 桌面端：现代化课程管理视图 ============ */
function DesktopTree({
  myCourses, sharedCourses, loading, schoolName,
  onAddCourse, onAddChapter, onAddUnit,
  onUpdateCourse, onDeleteCourse,
  onUpdateChapter, onDeleteChapter,
  onUpdateUnit, onDeleteUnit,
}) {
  const [addingCourse, setAddingCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseType, setNewCourseType] = useState(1);

  function handleAddCourse() {
    if (!newCourseName.trim()) return;
    onAddCourse({ name: newCourseName, courseType: newCourseType });
    setNewCourseName('');
    setNewCourseType(1);
    setAddingCourse(false);
  }

  return (
    <div className="desktop-course-page">
      <div className="animate-fade-in">
        <div className="page-title">
          <h1>课程大纲</h1>
          <p>
            {schoolName
              ? <>所在学校：<strong style={{ color: 'var(--brand)' }}>{schoolName}</strong> · 与同学共享课程</>
              : '在这里管理你的课程 → 章节 → 单元'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
          {addingCourse ? (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                value={newCourseName}
                onChange={(e) => setNewCourseName(e.target.value)}
                placeholder="课程名称"
                autoFocus
                style={{
                  padding: '10px 14px',
                  fontSize: '14px',
                  border: '1px solid rgba(0,0,0,0.12)',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.8)',
                  outline: 'none',
                  fontFamily: 'inherit',
                  width: '200px',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddCourse();
                  if (e.key === 'Escape') setAddingCourse(false);
                }}
              />
              <button
                onClick={() => setNewCourseType(newCourseType === 1 ? 2 : 1)}
                style={{
                  padding: '6px 14px',
                  fontSize: '13px',
                  borderRadius: '999px',
                  border: '2px solid',
                  borderColor: newCourseType === 1 ? '#10b981' : '#f59e0b',
                  background: newCourseType === 1 ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                  color: newCourseType === 1 ? '#059669' : '#d97706',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 150ms ease',
                }}
              >
                {newCourseType === 1 ? '🏫 校内' : '🎓 校外'}
              </button>
              <button
                onClick={handleAddCourse}
                className="btn btn-primary"
              >确认</button>
              <button
                onClick={() => { setAddingCourse(false); setNewCourseName(''); }}
                className="btn btn-ghost"
              >取消</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingCourse(true)}
              className="btn btn-primary"
            >
              + 添加新课程
            </button>
          )}
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">⏳</div>
            <h3>加载中…</h3>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '20px' }}>
            {myCourses.length > 0 && (
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  <span>我创建的课程</span>
                  <span style={{
                    fontSize: '11px',
                    background: 'rgba(255,255,255,0.5)',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    color: 'var(--text-soft)',
                  }}>{myCourses.length}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  {myCourses.map((c) => (
                    <DesktopCourseCard
                      key={c.id}
                      course={c}
                      canEdit
                      onAddChapter={onAddChapter}
                      onAddUnit={onAddUnit}
                      onUpdateCourse={onUpdateCourse}
                      onDeleteCourse={onDeleteCourse}
                      onUpdateChapter={onUpdateChapter}
                      onDeleteChapter={onDeleteChapter}
                      onUpdateUnit={onUpdateUnit}
                      onDeleteUnit={onDeleteUnit}
                    />
                  ))}
                </div>
              </div>
            )}

            {sharedCourses.length > 0 && (
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  <span>同校共享课程</span>
                  <span style={{
                    fontSize: '11px',
                    background: 'rgba(255,255,255,0.5)',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    color: 'var(--text-soft)',
                  }}>{sharedCourses.length}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  {sharedCourses.map((c) => (
                    <DesktopCourseCard
                      key={c.id}
                      course={c}
                      shared
                      onAddChapter={onAddChapter}
                      onAddUnit={onAddUnit}
                    />
                  ))}
                </div>
              </div>
            )}

            {myCourses.length === 0 && sharedCourses.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">📖</div>
                <h3>还没有任何课程</h3>
                <p>点击上方 "添加新课程" 创建第一个课程吧！</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- 桌面端添加按钮样式 ---- */
const desktopAddBtnStyle = {
  padding: '5px 10px',
  fontSize: '12px',
  color: 'var(--text-soft)',
  background: 'transparent',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  transition: 'background 140ms ease, color 140ms ease',
};

const SUBJECT_COLORS = {
  '数学': { bg: 'rgba(99, 102, 241, 0.1)', text: '#4f46e5', border: 'rgba(99, 102, 241, 0.25)' },
  '物理': { bg: 'rgba(34, 197, 94, 0.1)', text: '#16a34a', border: 'rgba(34, 197, 94, 0.25)' },
  '英语': { bg: 'rgba(249, 115, 22, 0.1)', text: '#ea580c', border: 'rgba(249, 115, 22, 0.25)' },
  '历史': { bg: 'rgba(168, 85, 247, 0.1)', text: '#9333ea', border: 'rgba(168, 85, 247, 0.25)' },
  '化学': { bg: 'rgba(236, 72, 153, 0.1)', text: '#db2777', border: 'rgba(236, 72, 153, 0.25)' },
  '生物': { bg: 'rgba(6, 182, 212, 0.1)', text: '#0891b2', border: 'rgba(6, 182, 212, 0.25)' },
};

function DesktopCourseCard({
  course, canEdit, shared,
  onAddChapter, onAddUnit,
  onUpdateCourse, onDeleteCourse,
  onUpdateChapter, onDeleteChapter,
  onUpdateUnit, onDeleteUnit,
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [addingChapter, setAddingChapter] = useState(false);
  const [editNameSignal, setEditNameSignal] = useState(0);

  const chapterCount = course.chapters?.length || 0;
  const unitCount = (course.chapters || []).reduce(
    (sum, ch) => sum + (ch.units?.length || 0), 0
  );

  const subjectStyle = SUBJECT_COLORS[course.subject] || {
    bg: 'rgba(148, 163, 184, 0.1)',
    text: '#64748b',
    border: 'rgba(148, 163, 184, 0.25)',
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--glass)',
        WebkitBackdropFilter: 'var(--blur-card)',
        backdropFilter: 'var(--blur-card)',
        border: '1px solid var(--edge-soft)',
        borderRadius: '16px',
        overflow: 'hidden',
        transition: 'all 200ms ease',
        boxShadow: hovered
          ? '0 4px 20px rgba(15, 23, 42, 0.08)'
          : '0 2px 8px rgba(15, 23, 42, 0.04)',
        borderColor: hovered ? 'rgba(99, 102, 241, 0.2)' : 'var(--edge-soft)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '16px 20px',
        gap: '12px',
      }}>
        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? '折叠' : '展开'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '14px',
            color: 'var(--text-soft)',
            transition: 'transform 150ms ease',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            flexShrink: 0,
          }}
        >
          ▾
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <DesktopInlineEdit
              value={course.name}
              canEdit={canEdit}
              editSignal={editNameSignal}
              onSave={(name) => onUpdateCourse(course.id, { name, subject: course.subject })}
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-strong)',
                cursor: canEdit ? 'pointer' : 'default',
                borderBottom: canEdit ? '2px dashed transparent' : 'none',
                paddingBottom: '2px',
                transition: 'border-color 150ms ease',
              }}
              hoverStyle={{ borderBottomColor: 'rgba(99, 102, 241, 0.4)' }}
            />
            {canEdit && (
              <span style={{
                fontSize: '12px',
                color: '#94a3b8',
                opacity: hovered ? 1 : 0.5,
                transition: 'opacity 150ms ease',
              }}>点击编辑</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontSize: '12px',
              fontWeight: 500,
              padding: '4px 10px',
              borderRadius: '999px',
              background: subjectStyle.bg,
              color: subjectStyle.text,
              border: `1px solid ${subjectStyle.border}`,
            }}>{course.subject}</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {chapterCount} 章节 · {unitCount} 单元
            </span>
            {shared && (
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: '999px',
                background: 'rgba(251, 191, 36, 0.1)',
                color: '#b45309',
                border: '1px solid rgba(251, 191, 36, 0.25)',
              }}>同校共享</span>
            )}
          </div>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setEditNameSignal((s) => s + 1)}
              title="编辑课程"
              style={{
                background: 'rgba(255,255,255,0.6)',
                border: 'none',
                cursor: 'pointer',
                padding: '8px 12px',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#64748b',
                transition: 'all 150ms ease',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#6366f1';
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
                e.currentTarget.style.color = '#64748b';
              }}
            >
              <Pencil size={13} strokeWidth={2.2} />
              编辑
            </button>
            <button
              onClick={() => onDeleteCourse(course.id)}
              title="删除课程"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: 'none',
                cursor: 'pointer',
                padding: '8px 12px',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#dc2626',
                transition: 'all 150ms ease',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ef4444';
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.08)';
                e.currentTarget.style.color = '#dc2626';
              }}
            >
              <Trash2 size={13} strokeWidth={2.2} />
              删除
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{
          borderTop: '1px solid var(--edge-soft)',
          padding: '8px 20px 16px',
          background: 'rgba(15,23,42,0.02)',
        }}>
          {chapterCount > 0 ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              {course.chapters.map((ch, idx) => (
                <DesktopChapterBlock
                  key={ch.id}
                  chapter={ch}
                  index={idx}
                  courseId={course.id}
                  canEdit={canEdit}
                  onAddUnit={onAddUnit}
                  onUpdate={onUpdateChapter}
                  onDelete={onDeleteChapter}
                  onUpdateUnit={onUpdateUnit}
                  onDeleteUnit={onDeleteUnit}
                />
              ))}
            </div>
          ) : (
            <div style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              padding: '12px 0',
              textAlign: 'center',
              border: '2px dashed var(--edge-soft)',
              borderRadius: '12px',
              marginBottom: '8px',
            }}>
              还没有章节
            </div>
          )}

          {canEdit && (
            addingChapter ? (
              <div style={{ marginTop: '8px' }}>
                <InlineInput
                  placeholder="输入章节名称，如：函数与导数"
                  onSubmit={(name) => { onAddChapter(course.id, name); setAddingChapter(false); }}
                  onCancel={() => setAddingChapter(false)}
                />
              </div>
            ) : (
              <button
                onClick={() => setAddingChapter(true)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '14px',
                  color: 'var(--text-soft)',
                  background: 'rgba(255,255,255,0.4)',
                  border: '2px dashed var(--edge-soft)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 150ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
                  e.currentTarget.style.borderColor = '#6366f1';
                  e.currentTarget.style.color = '#6366f1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.4)';
                  e.currentTarget.style.borderColor = 'var(--edge-soft)';
                  e.currentTarget.style.color = 'var(--text-soft)';
                }}
              >
                <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span>
                添加章节
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function DesktopChapterBlock({
  chapter, index, courseId, canEdit,
  onAddUnit, onUpdate, onDelete,
  onUpdateUnit, onDeleteUnit,
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const [editSignal, setEditSignal] = useState(0);

  const unitCount = chapter.units?.length || 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'rgba(255,255,255,0.5)',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid rgba(15,23,42,0.06)',
        transition: 'border-color 150ms ease',
        borderColor: hovered ? 'rgba(99,102,241,0.2)' : 'rgba(15,23,42,0.06)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        gap: '10px',
      }}>
        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? '折叠' : '展开'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            fontSize: '12px',
            color: 'var(--text-soft)',
            transition: 'transform 150ms ease',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            flexShrink: 0,
          }}
        >
          ▾
        </button>

        <span style={{
          fontSize: '11px',
          fontWeight: 700,
          color: '#7f1d1d',
          background: 'rgba(193, 39, 45, 0.08)',
          border: '1px solid rgba(193, 39, 45, 0.2)',
          padding: '3px 10px',
          borderRadius: '999px',
          flexShrink: 0,
        }}>第 {index + 1} 章</span>

        <DesktopInlineEdit
          value={chapter.name}
          canEdit={canEdit}
          editSignal={editSignal}
          onSave={(name) => onUpdate(chapter.id, name, courseId)}
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-strong)',
            flex: 1,
            cursor: canEdit ? 'pointer' : 'default',
            borderBottom: canEdit ? '2px dashed transparent' : 'none',
            paddingBottom: '1px',
            transition: 'border-color 150ms ease',
          }}
          hoverStyle={{ borderBottomColor: 'rgba(99, 102, 241, 0.4)' }}
        />

        <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
          {unitCount} 单元
        </span>

        {canEdit && (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setEditSignal((s) => s + 1)}
              title="编辑章节"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#94a3b8',
                transition: 'all 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#6366f1';
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#94a3b8';
              }}
            >
              <Pencil size={12} strokeWidth={2.2} />
            </button>
            <button
              onClick={() => onDelete(chapter.id, courseId)}
              title="删除章节"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#ef4444',
                transition: 'all 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ef4444';
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#ef4444';
              }}
            >
              <Trash2 size={12} strokeWidth={2.2} />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(15,23,42,0.06)',
          padding: '8px 16px 12px',
          marginLeft: '28px',
        }}>
          {unitCount > 0 ? (
            <div style={{ display: 'grid', gap: '4px' }}>
              {chapter.units.map((u) => (
                <DesktopUnitRow
                  key={u.id}
                  unit={u}
                  chapterId={chapter.id}
                  courseId={courseId}
                  canEdit={canEdit}
                  onUpdate={onUpdateUnit}
                  onDelete={onDeleteUnit}
                />
              ))}
            </div>
          ) : (
            <div style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              padding: '8px 0',
              textAlign: 'center',
              border: '1px dashed rgba(15,23,42,0.1)',
              borderRadius: '8px',
              marginBottom: '8px',
            }}>
              还没有单元
            </div>
          )}

          {canEdit && (
            addingUnit ? (
              <div style={{ marginTop: '8px' }}>
                <InlineInput
                  placeholder="输入单元名称，如：导数的定义"
                  small
                  onSubmit={(name) => { onAddUnit(courseId, chapter.id, name); setAddingUnit(false); }}
                  onCancel={() => setAddingUnit(false)}
                />
              </div>
            ) : (
              <button
                onClick={() => setAddingUnit(true)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '12px',
                  color: 'var(--text-soft)',
                  background: 'rgba(255,255,255,0.6)',
                  border: '1px dashed var(--edge-soft)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 150ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
                  e.currentTarget.style.borderColor = '#6366f1';
                  e.currentTarget.style.color = '#6366f1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
                  e.currentTarget.style.borderColor = 'var(--edge-soft)';
                  e.currentTarget.style.color = 'var(--text-soft)';
                }}
              >
                <span style={{ fontSize: '14px', lineHeight: 1 }}>+</span>
                添加单元
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function DesktopUnitRow({ unit, chapterId, courseId, canEdit, onUpdate, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const [editSignal, setEditSignal] = useState(0);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: '8px',
        transition: 'background 150ms ease',
        background: hovered ? 'rgba(99,102,241,0.05)' : 'transparent',
      }}
    >
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: '#6366f1',
        marginRight: '10px',
        flexShrink: 0,
      }}></span>

      <DesktopInlineEdit
        value={unit.name}
        canEdit={canEdit}
        editSignal={editSignal}
        onSave={(name) => onUpdate(unit.id, name, chapterId, courseId)}
        style={{
          fontSize: '13px',
          color: 'var(--text-main)',
          flex: 1,
          cursor: canEdit ? 'pointer' : 'default',
          borderBottom: canEdit ? '1px dashed transparent' : 'none',
          paddingBottom: '1px',
          transition: 'border-color 150ms ease',
        }}
        hoverStyle={{ borderBottomColor: 'rgba(99, 102, 241, 0.4)' }}
      />

      {canEdit && (
        <div style={{ display: 'flex', gap: '2px', opacity: hovered ? 1 : 0, transition: 'opacity 150ms ease' }}>
          <button
            onClick={() => setEditSignal((s) => s + 1)}
            title="编辑单元"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#94a3b8',
              transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#6366f1';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#94a3b8';
            }}
          >
            <Pencil size={11} strokeWidth={2.2} />
          </button>
          <button
            onClick={() => onDelete(unit.id, chapterId, courseId)}
            title="删除单元"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#ef4444',
              transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#ef4444';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#ef4444';
            }}
          >
            <Trash2 size={11} strokeWidth={2.2} />
          </button>
        </div>
      )}
    </div>
  );
}

function DesktopInlineEdit({ value, canEdit, editSignal, onSave, style, hoverStyle }) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const submitGuard = useRef(false);

  useEffect(() => {
    if (editSignal > 0) {
      setEditing(true);
    }
  }, [editSignal]);

  useEffect(() => {
    if (!editing) {
      setInputValue(value);
      submitGuard.current = false;
    }
  }, [editing, value]);

  function handleSave() {
    if (submitGuard.current) return;
    submitGuard.current = true;
    const trimmed = inputValue.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    }
  }

  if (!canEdit) {
    return <span style={style}>{value}</span>;
  }

  if (editing) {
    return (
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        autoFocus
        style={{
          ...style,
          borderBottom: '2px solid #6366f1',
          outline: 'none',
          backgroundColor: 'transparent',
          fontFamily: 'inherit',
          padding: '0',
          margin: '0',
        }}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={style}
      onMouseEnter={(e) => {
        if (hoverStyle) {
          Object.assign(e.currentTarget.style, hoverStyle);
        }
      }}
      onMouseLeave={(e) => {
        Object.assign(e.currentTarget.style, style);
      }}
    >
      {value}
    </span>
  );
}
