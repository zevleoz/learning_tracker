import { useEffect, useState } from 'react';
import E4Modal from './E4Modal.jsx';
import { createE4Student, updateE4Student, listTrackerStudents } from '../../lib/e4Store.js';
import { useAuth } from '../../lib/useAuth.js';
import { toast } from '../../lib/toast.js';

const EMPTY = {
  display_name: '', gender: '', grade: '', school: '', notes: '',
  tracker_profile_id: '', tracker_name: '',
};

export default function StudentFormModal({ open, onClose, onSaved, initial = null }) {
  const { profile } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [trackerQuery, setTrackerQuery] = useState('');
  const [trackerResults, setTrackerResults] = useState([]);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        display_name: initial.display_name || '',
        gender: initial.gender || '',
        grade: initial.grade || '',
        school: initial.school || '',
        notes: initial.notes || '',
        tracker_profile_id: initial.tracker_profile_id || '',
        tracker_name: initial.tracker?.full_name || '',
      });
    } else {
      setForm(EMPTY);
    }
    setTrackerQuery('');
    setTrackerResults([]);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      listTrackerStudents(trackerQuery)
        .then(setTrackerResults)
        .catch(() => setTrackerResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [trackerQuery, open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.display_name.trim()) {
      toast('请填写学生姓名', { kind: 'error' });
      return;
    }
    setSaving(true);
    const payload = {
      display_name: form.display_name.trim(),
      gender: form.gender || null,
      grade: form.grade.trim() || null,
      school: form.school.trim() || null,
      notes: form.notes.trim() || null,
      tracker_profile_id: form.tracker_profile_id || null,
    };
    try {
      if (initial) {
        await updateE4Student(initial.id, payload);
        toast('学生资料已更新', { kind: 'success' });
      } else {
        await createE4Student({ ...payload, advisor_id: profile.id, created_by: profile.id });
        toast('E4 学生已创建', { kind: 'success' });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message || '保存失败', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <E4Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑 E4 学生' : '新建 E4 学生'}
      subtitle="E4 以学生为中心建档；Y4 报告在建档后手动关联"
      footer={
        <>
          <button type="button" className="e4-btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="e4-btn-primary" disabled={saving} onClick={submit}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="e4-form-grid">
        <label className="e4-field e4-field-full">
          <span>学生姓名（E4 报告中使用的名字，可填化名）</span>
          <input value={form.display_name} onChange={set('display_name')} placeholder="例如：Leo" maxLength={100} />
        </label>
        <label className="e4-field">
          <span>性别</span>
          <select value={form.gender} onChange={set('gender')}>
            <option value="">未填写</option>
            <option value="男">男</option>
            <option value="女">女</option>
          </select>
        </label>
        <label className="e4-field">
          <span>年级</span>
          <input value={form.grade} onChange={set('grade')} placeholder="例如：初一" maxLength={30} />
        </label>
        <label className="e4-field e4-field-full">
          <span>学校</span>
          <input value={form.school} onChange={set('school')} placeholder="例如：星河湾" maxLength={100} />
        </label>

        <div className="e4-field e4-field-full">
          <span>关联一表人才学生（选填，供后续过程中报告使用）</span>
          {form.tracker_profile_id ? (
            <div className="e4-linked-chip">
              <span>{form.tracker_name}</span>
              <button
                type="button"
                className="e4-chip-clear"
                onClick={() => setForm((f) => ({ ...f, tracker_profile_id: '', tracker_name: '' }))}
              >
                取消关联
              </button>
            </div>
          ) : (
            <>
              <input
                value={trackerQuery}
                onChange={(e) => setTrackerQuery(e.target.value)}
                placeholder="搜索一表人才学生姓名"
              />
              {trackerResults.length > 0 && (
                <div className="e4-search-list">
                  {trackerResults.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className="e4-search-item"
                      onClick={() =>
                        setForm((f) => ({ ...f, tracker_profile_id: s.id, tracker_name: s.full_name }))
                      }
                    >
                      {s.full_name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <label className="e4-field e4-field-full">
          <span>备注</span>
          <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="导师内部备注（不会印入报告）" />
        </label>
      </div>
    </E4Modal>
  );
}
