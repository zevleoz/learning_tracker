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
        .select('school:schools(name)')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.school?.name) setSchoolName(profile.school.name);

      const { data: cs } = await supabase
        .from('courses')
        .select(`
          id, name, subject, source, created_by,
          chapters:chapters(id, name, order_idx, units(id, name, order_idx))
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      const sorted = (cs || []).map((c) => ({
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
  async function createCourse({ name, subject }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return toast('请先登录', { kind: 'error' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .maybeSingle();

    const { error, data: created } = await supabase
      .from('courses')
      .insert({
        name: name.trim(),
        subject: subject.trim(),
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
  async function updateCourse(courseId, { name, subject }) {
    const { error } = await supabase
      .from('courses')
      .update({ name: name.trim(), subject: subject.trim() })
      .eq('id', courseId);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已更新', { kind: 'success' });
    setCourses(prev => prev.map(c => c.id === courseId ? { ...c, name: name.trim(), subject: subject.trim() } : c));
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
  const [subject, setSubject] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!name.trim() || !subject.trim()) {
      return toast('请填写课程名称和学科', { kind: 'error' });
    }
    onSubmit({ name, subject });
    setName(''); setSubject('');
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
          onClick={() => { setExpanded(false); setName(''); setSubject(''); }}
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
          <label>学科</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="如：数学、物理、英语、历史"
          />
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
  const [editSubject, setEditSubject] = useState(course.subject);

  function submitCourseEdit(e) {
    e.preventDefault();
    if (!editName.trim() || !editSubject.trim()) {
      return toast('请填写课程名称和学科', { kind: 'error' });
    }
    onUpdateCourse(course.id, { name: editName, subject: editSubject });
    setEditing(false);
  }

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
              <input
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="学科"
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" type="submit">保存</button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => { setEditing(false); setEditName(course.name); setEditSubject(course.subject); }}
                >取消</button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <div className="course-card-title">{course.name}</div>
            <div className="course-card-subject">{course.subject}</div>
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

/* ============ 桌面端：树形表格视图 ============ */
function DesktopTree({
  myCourses, sharedCourses, loading, schoolName,
  onAddCourse, onAddChapter, onAddUnit,
  onUpdateCourse, onDeleteCourse,
  onUpdateChapter, onDeleteChapter,
  onUpdateUnit, onDeleteUnit,
}) {
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

      <AddCourseCard onSubmit={onAddCourse} />

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
              <DesktopTreeTable
                courses={myCourses}
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
            </>
          )}

          {sharedCourses.length > 0 && (
            <>
              <SectionLabel title="同校同学创建的课程" count={sharedCourses.length} />
              <DesktopTreeTable
                courses={sharedCourses}
                onAddChapter={onAddChapter}
                onAddUnit={onAddUnit}
              />
            </>
          )}

          {myCourses.length === 0 && sharedCourses.length === 0 && (
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

/* ---- 桌面表格容器 ---- */
function DesktopTreeTable({
  courses, canEdit,
  onAddChapter, onAddUnit,
  onUpdateCourse, onDeleteCourse,
  onUpdateChapter, onDeleteChapter,
  onUpdateUnit, onDeleteUnit,
}) {
  return (
    <div style={{
      background: 'var(--glass)',
      WebkitBackdropFilter: 'var(--blur-card)',
      backdropFilter: 'var(--blur-card)',
      border: '1px solid var(--edge-soft)',
      borderRadius: '18px',
      overflow: 'hidden',
      marginBottom: '12px',
      boxShadow:
        'inset 1px 1px 0 rgba(255,255,255,0.55),' +
        'inset -1px -1px 0 rgba(15,23,42,0.05),' +
        '0 1px 2px rgba(15,23,42,0.03),' +
        '0 6px 16px rgba(15,23,42,0.04)',
    }}>
      {/* 表头 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1.5fr',
        gap: '12px',
        padding: '10px 18px',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderBottom: '1px solid var(--edge-soft)',
        background: 'rgba(255,255,255,0.2)',
      }}>
        <div>课程名</div>
        <div>学科</div>
        <div style={{ textAlign: 'right' }}>章节</div>
      </div>
      {/* 课程行 */}
      {courses.map((c, idx) => (
        <DesktopCourseRow
          key={c.id}
          course={c}
          canEdit={canEdit}
          isLast={idx === courses.length - 1}
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
  );
}

/* ---- 桌面课程行 ---- */
function DesktopCourseRow({
  course, canEdit, isLast,
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

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--edge-soft)' }}>
      {/* 课程行 */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1.5fr',
          gap: '12px',
          padding: '14px 18px',
          alignItems: 'center',
          background: hovered ? 'rgba(255,255,255,0.25)' : 'transparent',
          transition: 'background 140ms ease',
        }}
      >
        {/* 课程名 + 展开箭头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              transition: 'transform 140ms ease',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              flexShrink: 0,
            }}
          >
            ▾
          </button>
          <DesktopInlineEdit
            value={course.name}
            canEdit={canEdit}
            editSignal={editNameSignal}
            onSave={(name) => onUpdateCourse(course.id, { name, subject: course.subject })}
            style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-strong)' }}
          />
        </div>
        {/* 学科 */}
        <div>
          <DesktopInlineEdit
            value={course.subject}
            canEdit={canEdit}
            onSave={(subject) => onUpdateCourse(course.id, { name: course.name, subject })}
            style={{ fontSize: '13px', color: 'var(--text-soft)' }}
          />
        </div>
        {/* 章节摘要 + 操作 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
          <span className="pill">
            {chapterCount} 章 · {unitCount} 单元
          </span>
          {canEdit && (
            <div style={{
              display: 'flex',
              gap: '2px',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 140ms ease',
            }}>
              <IconBtn title="编辑课程" onClick={() => setEditNameSignal((s) => s + 1)}>
                <Pencil size={14} strokeWidth={2.2} />
              </IconBtn>
              <IconBtn title="删除课程" onClick={() => onDeleteCourse(course.id)}>
                <Trash2 size={14} strokeWidth={2.2} />
              </IconBtn>
            </div>
          )}
        </div>
      </div>

      {/* 展开的章节区域 */}
      {expanded && (
        <div style={{ padding: '4px 18px 14px 42px' }}>
          {chapterCount > 0 ? (
            course.chapters.map((ch, idx) => (
              <DesktopChapterRow
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
            ))
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '8px 0' }}>
              还没有章节
            </div>
          )}

          {/* 添加章节 */}
          {canEdit && (
            addingChapter ? (
              <div style={{ marginTop: '6px' }}>
                <InlineInput
                  placeholder="如：函数与导数"
                  small
                  onSubmit={(name) => { onAddChapter(course.id, name); setAddingChapter(false); }}
                  onCancel={() => setAddingChapter(false)}
                />
              </div>
            ) : (
              <button
                onClick={() => setAddingChapter(true)}
                style={desktopAddBtnStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
                  e.currentTarget.style.color = 'var(--brand)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-soft)';
                }}
              >
                <span style={{ fontSize: '13px', lineHeight: 1 }}>+</span> 添加章节
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ---- 桌面章节行 ---- */
function DesktopChapterRow({
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
    <div style={{ marginBottom: '2px' }}>
      {/* 章节头 */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          borderRadius: '8px',
          background: hovered ? 'rgba(255,255,255,0.4)' : 'transparent',
          transition: 'background 140ms ease',
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? '折叠' : '展开'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            fontSize: '11px',
            color: 'var(--text-soft)',
            transition: 'transform 140ms ease',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            flexShrink: 0,
          }}
        >
          ▾
        </button>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          color: '#7f1d1d',
          background: 'var(--brand-soft)',
          border: '1px solid rgba(193, 39, 45, 0.22)',
          padding: '3px 8px',
          borderRadius: '6px',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>第 {index + 1} 章</span>
        <DesktopInlineEdit
          value={chapter.name}
          canEdit={canEdit}
          editSignal={editSignal}
          onSave={(name) => onUpdate(chapter.id, name, courseId)}
          style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}
        />
        {unitCount > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {unitCount} 单元
          </span>
        )}
        {canEdit && (
          <div style={{
            display: 'flex',
            gap: '2px',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 140ms ease',
          }}>
            <IconBtn title="编辑章节" onClick={() => setEditSignal((s) => s + 1)}>
              <Pencil size={12} strokeWidth={2.2} />
            </IconBtn>
            <IconBtn title="删除章节" onClick={() => onDelete(chapter.id, courseId)}>
              <Trash2 size={12} strokeWidth={2.2} />
            </IconBtn>
          </div>
        )}
      </div>

      {/* 展开的单元列表 */}
      {expanded && (
        <div style={{
          marginLeft: '38px',
          paddingLeft: '10px',
          borderLeft: '1px solid rgba(15,23,42,0.06)',
        }}>
          {unitCount > 0 && chapter.units.map((u) => (
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

          {/* 添加单元 */}
          {canEdit && (
            addingUnit ? (
              <div style={{ marginTop: '4px' }}>
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
                style={desktopAddBtnStyle}
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
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ---- 桌面单元行 ---- */
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
        gap: '8px',
        padding: '4px 8px',
        borderRadius: '8px',
        background: hovered ? 'rgba(255,255,255,0.5)' : 'transparent',
        transition: 'background 140ms ease',
      }}
    >
      <span style={{ color: 'var(--gold)', fontWeight: 700, flexShrink: 0, fontSize: '12px' }}>·</span>
      <DesktopInlineEdit
        value={unit.name}
        canEdit={canEdit}
        editSignal={editSignal}
        onSave={(name) => onUpdate(unit.id, name, chapterId, courseId)}
        style={{ fontSize: '13px', color: 'var(--text-soft)', flex: 1 }}
      />
      {canEdit && (
        <div style={{
          display: 'flex',
          gap: '2px',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 140ms ease',
        }}>
          <IconBtn title="编辑单元" onClick={() => setEditSignal((s) => s + 1)}>
            <Pencil size={11} strokeWidth={2.2} />
          </IconBtn>
          <IconBtn title="删除单元" onClick={() => onDelete(unit.id, chapterId, courseId)}>
            <Trash2 size={11} strokeWidth={2.2} />
          </IconBtn>
        </div>
      )}
    </div>
  );
}

/* ---- 桌面端行内编辑（点击文字 / 点编辑按钮触发） ---- */
function DesktopInlineEdit({ value, canEdit, onSave, placeholder, style, editSignal = 0 }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const committedRef = useRef(false);

  // 外部 value 变化时同步 draft
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // 通过 editSignal（编辑按钮）触发编辑
  useEffect(() => {
    if (editSignal > 0) {
      committedRef.current = false;
      setDraft(value);
      setEditing(true);
    }
  }, [editSignal]);

  function start() {
    committedRef.current = false;
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  function cancel() {
    committedRef.current = true;
    setDraft(value);
    setEditing(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  if (!canEdit) {
    return <span style={style}>{value}</span>;
  }

  if (!editing) {
    return (
      <span
        onClick={start}
        style={{ cursor: 'text', borderBottom: '1px dashed transparent', ...style }}
        onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = 'rgba(193,39,45,0.25)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; }}
      >
        {value}
      </span>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
      placeholder={placeholder}
      style={{
        ...inputStyle,
        padding: '4px 8px',
        fontSize: style?.fontSize || '14px',
        fontWeight: style?.fontWeight || 500,
        width: '100%',
        maxWidth: '320px',
      }}
    />
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
