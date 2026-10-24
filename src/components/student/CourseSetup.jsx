import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { toast } from '../../lib/toast.js';
import { logger } from '../../lib/logger.js';
import '../../styles/student-auth.css';

// 固定的常见科目建议（不来自其他学生的课程）
export const COMMON_SUBJECTS = [
  '语文', '数学', '英语', '物理', '化学', '生物',
  '历史', '地理', '政治', 'AP 微积分', 'AP 统计', 'SAT 数学', '托福',
];

// 与 Syllabus.jsx 一致：1 = 校内课程，2 = 校外课程
const INSIDE = 1;
const OUTSIDE = 2;
const MAX_NAME = 50;

/**
 * 注册第 3 步：添加课程。
 * 仅在 signUp 返回 session 时才会渲染并写入 courses（调用方负责判断）。
 * props:
 *  - userId: 新用户 id（created_by）
 *  - onDone(count): 完成或跳过后回调，count 为实际创建的课程数
 */
export default function CourseSetup({ userId, onDone }) {
  const [courses, setCourses] = useState([]);   // [{ name, courseType }]
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const has = (list, name) => list.some((c) => c.name.toLowerCase() === name.toLowerCase());

  const withName = (list, rawName) => {
    const name = rawName.trim();
    return !name || has(list, name) ? list : [...list, { name, courseType: INSIDE }];
  };

  function onAdd() {
    if (has(courses, draft.trim())) {
      setError('该课程已在列表中');
      return;
    }
    setCourses((l) => withName(l, draft));
    setDraft('');
    setError('');
  }

  function setType(name, courseType) {
    setCourses((list) => list.map((c) => (c.name === name ? { ...c, courseType } : c)));
  }

  async function onFinish() {
    // 输入框里还没点“添加”的内容一并算上
    const list = withName(courses, draft);
    if (!list.length) return;
    setBusy(true);
    try {
      // 与 Syllabus.createCourse 同样的列：school_id 取自 profile
      let schoolId = null;
      try {
        const { data: profile } = await supabase
          .from('profiles').select('school_id').eq('id', userId).maybeSingle();
        schoolId = profile?.school_id || null;
      } catch (e) {
        logger.warn('CourseSetup profile lookup failed:', e);
      }
      const rows = list.map((c) => ({
        name: c.name,
        subject: '',
        course_type: c.courseType,
        school_id: schoolId,
        created_by: userId,
      }));
      const { error: insErr } = await supabase.from('courses').insert(rows);
      if (insErr) throw insErr;
      toast(`已添加 ${rows.length} 门课程`, { kind: 'success' });
      onDone?.(rows.length);
    } catch (err) {
      logger.error('CourseSetup insert failed:', err);
      setError('课程保存失败，请重试，或先跳过稍后再加');
      toast('课程保存失败，请重试', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = withName(courses, draft).length;
  const suggestions = COMMON_SUBJECTS.filter((s) => !has(courses, s));

  return (
    <div className="ya-form">
      <div className="ya-steps" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></div>
      <div className="ya-eyebrow">第 3 步，共 3 步 · 课程</div>
      <h1 className="ya-h1">这学期在学哪些课？</h1>
      <p className="ya-note">写下课程名就能开始记录。章节和单元，以后记录时随手添加。</p>

      <div className="ya-add-row">
        <input
          className="ya-input" type="text" value={draft} maxLength={MAX_NAME}
          aria-label="课程名称" placeholder="如：AP 化学"
          onChange={(e) => { setDraft(e.target.value); if (error) setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
        />
        <button type="button" className="ya-btn sm" onClick={onAdd} disabled={!draft.trim()}>添加</button>
      </div>

      {suggestions.length > 0 && (
        <div className="ya-chips">
          {suggestions.map((s) => (
            <button key={s} type="button" className="ya-chip" onClick={() => setCourses((l) => withName(l, s))}>
              ＋ {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="ya-error" role="alert">{error}</p>}

      {courses.length > 0 && (
        <ul className="ya-courses" aria-label="已添加的课程">
          {courses.map((c) => (
            <li key={c.name} className="ya-course">
              <div className="ya-course-t">
                <b>{c.name}</b>
                <span>{c.courseType === INSIDE ? '校内课程可以记录考试成绩' : '校外课程'}</span>
              </div>
              <div className="ya-seg" role="group" aria-label={`${c.name} 课程类型`}>
                <button type="button" aria-pressed={c.courseType === INSIDE} onClick={() => setType(c.name, INSIDE)}>校内</button>
                <button type="button" aria-pressed={c.courseType === OUTSIDE} onClick={() => setType(c.name, OUTSIDE)}>校外</button>
              </div>
              <button
                type="button" className="ya-x" aria-label={`移除 ${c.name}`}
                onClick={() => setCourses((l) => l.filter((x) => x.name !== c.name))}
              >×</button>
            </li>
          ))}
        </ul>
      )}

      <div className="ya-spacer" />
      <button type="button" className="ya-btn" onClick={onFinish} disabled={busy || pendingCount === 0}>
        {busy ? '保存中…' : pendingCount > 0 ? `完成，已添加 ${pendingCount} 门` : '完成'}
      </button>
      <div className="ya-foot small">
        <button type="button" className="ya-link" style={{ fontWeight: 400 }} onClick={() => onDone?.(0)} disabled={busy}>
          跳过，稍后在「我的课程」里添加
        </button>
      </div>
    </div>
  );
}
