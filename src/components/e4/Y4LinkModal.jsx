import { useEffect, useState } from 'react';
import E4Modal from './E4Modal.jsx';
import { listStudents, listReports, Y4ApiError } from '../../lib/y4api.js';
import { updateE4Student } from '../../lib/e4Store.js';
import { toast } from '../../lib/toast.js';

// 手动把 E4 学生关联到 Y4 学生及其某一份报告
export default function Y4LinkModal({ open, onClose, onSaved, student }) {
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setQuery('');
    setChosen(null);
    setReports([]);
    setSelectedReport(null);
    setError('');
  }, [open]);

  // 打开时加载完整列表（约几十人，客户端过滤）
  useEffect(() => {
    if (!open || step !== 1) return;
    let cancelled = false;
    setLoadingList(true);
    setError('');
    listStudents()
      .then((all) => {
        if (!cancelled) setStudents(all);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Y4ApiError ? err.message : 'Y4 学生列表加载失败');
      })
      .finally(() => !cancelled && setLoadingList(false));
    return () => {
      cancelled = true;
    };
  }, [open, step]);

  function openReports(y4Student) {
    setChosen(y4Student);
    setSelectedReport(null);
    setStep(2);
    setLoadingReports(true);
    setError('');
    listReports(y4Student.id)
      .then(setReports)
      .catch((err) => setError(err instanceof Y4ApiError ? err.message : 'Y4 报告列表加载失败'))
      .finally(() => setLoadingReports(false));
  }

  function backToStep1() {
    setStep(1);
    setChosen(null);
    setSelectedReport(null);
  }

  async function confirmLink() {
    const report = reports.find((r) => r.id === selectedReport);
    if (!chosen || !report) return;
    setSaving(true);
    try {
      // 仅补全空白档案字段，导师手填过的值永不覆盖
      const blankFill = {};
      if (!student.gender && chosen.gender) blankFill.gender = chosen.gender;
      if (!student.grade && chosen.grade) blankFill.grade = chosen.grade;
      if (!student.school && chosen.school) blankFill.school = chosen.school;
      await updateE4Student(student.id, {
        y4_student_id: chosen.id,
        y4_report_id: report.id,
        y4_student_name: chosen.name,
        y4_report_date: report.report_date || null,
        ...blankFill,
      });
      toast('Y4 报告已关联', { kind: 'success' });
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message || '关联失败', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const filtered = query.trim()
    ? students.filter((s) => String(s.name || '').toLowerCase().includes(query.trim().toLowerCase()))
    : students;

  const stepBar = (
    <div className="e4-modal-steps">
      <span className={`e4-modal-step ${step === 1 ? 'active' : 'done'}`}>
        <i>1</i>选择 Y4 学生
      </span>
      <span className="e4-modal-step-line" />
      <span className={`e4-modal-step ${step === 2 ? 'active' : ''}`}>
        <i>2</i>选择报告并确认
      </span>
    </div>
  );

  return (
    <E4Modal
      open={open}
      onClose={onClose}
      title="关联 Y4 报告"
      subtitle={stepBar}
      footer={
        step === 2 ? (
          <>
            <button type="button" className="e4-btn-ghost" onClick={backToStep1} disabled={saving}>
              返回上一步
            </button>
            <button
              type="button"
              className="e4-btn-primary"
              disabled={!selectedReport || saving || loadingReports}
              onClick={confirmLink}
            >
              {saving ? '关联中…' : '确认关联'}
            </button>
          </>
        ) : null
      }
      width={620}
    >
      {error && <div className="e4-inline-error">{error}</div>}

      {step === 1 && (
        <>
          <input
            className="e4-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按姓名搜索 Y4 学生"
            autoFocus
          />
          <div className="e4-y4-list">
            {loadingList && [0, 1, 2, 3, 4].map((i) => (
              <div className="e4-y4-item is-skeleton" key={i}>
                <div className="e4-y4-item-main">
                  <span className="e4-skeleton" style={{ width: 80 + (i % 3) * 22, height: 13 }} />
                  <span className="e4-skeleton" style={{ width: 150 + (i % 2) * 40, height: 11 }} />
                </div>
              </div>
            ))}
            {!loadingList && filtered.length === 0 && <div className="e4-list-hint">没有匹配的 Y4 学生</div>}
            {!loadingList && filtered.map((s) => (
              <button type="button" key={s.id} className="e4-y4-item" onClick={() => openReports(s)}>
                <div className="e4-y4-item-main">
                  <span className="e4-y4-name">{s.name}</span>
                  <span className="e4-y4-meta">
                    {[s.grade, s.school].filter(Boolean).join(' · ') || '年级学校未填写'}
                  </span>
                </div>
                <span className="e4-y4-side">
                  {s.report_count > 0 ? `${s.report_count} 份报告${s.latest_report_date ? ` · 最新 ${s.latest_report_date}` : ''}` : '暂无报告'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <div className="e4-y4-list">
          {loadingReports && [0, 1, 2].map((i) => (
            <div className="e4-y4-item is-skeleton" key={i}>
              <span className="e4-y4-radio" />
              <div className="e4-y4-item-main">
                <span className="e4-skeleton" style={{ width: 110 + i * 18, height: 13 }} />
                <span className="e4-skeleton" style={{ width: 160, height: 11 }} />
              </div>
            </div>
          ))}
          {!loadingReports && reports.length === 0 && (
            <div className="e4-list-hint">该 Y4 学生名下暂无报告，无法生成首次报告。</div>
          )}
          {!loadingReports && reports.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`e4-y4-item ${selectedReport === r.id ? 'is-selected' : ''}`}
              disabled={saving}
              onClick={() => setSelectedReport(r.id)}
            >
              <span className="e4-y4-radio" />
              <div className="e4-y4-item-main">
                <span className="e4-y4-name">Y4 报告 #{r.id}</span>
                <span className="e4-y4-meta">生成于 {r.created_at?.slice(0, 10) || '未知日期'}</span>
              </div>
              <span className="e4-y4-side">{r.report_date ? `测评日期 ${r.report_date}` : ''}</span>
            </button>
          ))}
          <p className="e4-form-footnote">选中一份报告后点击右下角「确认关联」。关联后可在学生页面重新选择。</p>
        </div>
      )}
    </E4Modal>
  );
}
