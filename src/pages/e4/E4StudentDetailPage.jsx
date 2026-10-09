import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getE4Student, listReportsForStudent, deleteReport } from '../../lib/e4Store.js';
import { fetchY4Markdown } from '../../lib/y4api.js';
import { pushRecentStudent } from '../../lib/e4Recent.js';
import { toast } from '../../lib/toast.js';
import E4Modal from '../../components/e4/E4Modal.jsx';
import StudentFormModal from '../../components/e4/StudentFormModal.jsx';
import Y4LinkModal from '../../components/e4/Y4LinkModal.jsx';
import PrintPreviewModal from '../../components/e4/PrintPreviewModal.jsx';
import PrepPrint from '../../components/e4/PrepPrint.jsx';
import FirstReportPrint from '../../components/e4/FirstReportPrint.jsx';
import ProgressPrint from '../../components/e4/ProgressPrint.jsx';

function IconBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export default function E4StudentDetailPage() {
  const { studentId } = useParams();
  const nav = useNavigate();
  const [student, setStudent] = useState(null);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [printTarget, setPrintTarget] = useState(null); // 打印预览浮层中的报告
  const [y4Open, setY4Open] = useState(false);
  const [y4Md, setY4Md] = useState('');
  const [y4Busy, setY4Busy] = useState(false);
  const [y4Error, setY4Error] = useState('');

  // 查看 Y4 原始报告（只读预览；按需拉取并缓存）
  async function openY4Report() {
    setY4Open(true);
    if (y4Md) return;
    setY4Busy(true);
    setY4Error('');
    try {
      const md = await fetchY4Markdown(student.y4_report_id);
      setY4Md(md || '');
    } catch (err) {
      setY4Error(err?.message || '读取 Y4 报告失败');
    } finally {
      setY4Busy(false);
    }
  }

  const load = useCallback(() => {
    getE4Student(studentId)
      .then((s) => {
        setStudent(s);
        if (!s) {
          setError('未找到该 E4 学生');
        } else {
          pushRecentStudent({ id: s.id, name: s.display_name });
        }
      })
      .catch((err) => setError(err.message));
    listReportsForStudent(studentId).then(setReports).catch(() => setReports([]));
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  // 会前准备 / 首次报告 / 过程中报告分开展示
  const prepReports = reports.filter((r) => r.report_type === 'prep');
  const firstReports = reports.filter((r) => r.report_type === 'first');
  const progressReports = reports.filter((r) => r.report_type === 'progress');

  const reportTitle = (r) =>
    r.report_type === 'prep' ? '首次学习力会议会前准备' : r.report_type === 'progress' ? '过程学习力报告' : '首次学习力分析报告';

  // 打印预览：浮层直接打开，不跳路由；内容缺失时提示
  function openPrintPreview(r) {
    const ready = r.report_type === 'prep'
      ? !!r.form_data?.prepRows
      : r.report_type === 'progress'
        ? !!r.form_data?.cover
        : !!r.form_data?.sections;
    if (!ready) {
      toast('报告内容尚未生成', { kind: 'error' });
      return;
    }
    setPrintTarget(r);
  }

  function openRowMenu(e, r) {
    e.preventDefault();
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 90),
      report: r,
    });
  }

  useEffect(() => {
    if (!ctxMenu) return undefined;
    const close = () => setCtxMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteReport(deleteTarget.id);
      toast('报告已删除', { kind: 'success' });
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err.message || '删除失败', { kind: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  if (error && !student) {
    return (
      <div className="e4-page">
        <button type="button" className="e4-back-link" onClick={() => nav('/e4/students')}><IconBack />返回学生中心</button>
        <div className="e4-inline-error">{error}</div>
      </div>
    );
  }
  if (!student) {
    return (
      <div className="e4-page" aria-busy="true" aria-label="加载学生档案">
        <span className="e4-skeleton" style={{ width: 92, height: 12 }} />
        <div className="e4-detail-head" style={{ marginTop: 18 }}>
          <div className="e4-detail-id">
            <span className="e4-skeleton" style={{ width: 44, height: 44, borderRadius: 11 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="e4-skeleton" style={{ width: 132, height: 18 }} />
              <span className="e4-skeleton" style={{ width: 190, height: 11 }} />
            </div>
          </div>
          <span className="e4-skeleton" style={{ width: 84, height: 28, borderRadius: 7 }} />
        </div>
        <div className="e4-detail-cards">
          {[0, 1].map((i) => (
            <section className="e4-info-card" key={i}>
              <div className="e4-info-card-head">
                <span className="e4-skeleton" style={{ width: 96, height: 14 }} />
                <span className="e4-skeleton" style={{ width: 92, height: 26, borderRadius: 7 }} />
              </div>
              <span className="e4-skeleton" style={{ width: '72%', height: 12 }} />
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="e4-page">
      <button type="button" className="e4-back-link" onClick={() => nav('/e4/students')}><IconBack />学生中心</button>

      <div className="e4-detail-head">
        <div className="e4-detail-id">
          <div className="e4-student-avatar e4-student-avatar-lg">{student.display_name?.charAt(0) || '?'}</div>
          <div>
            <h1 className="e4-page-title">{student.display_name}</h1>
            <p className="e4-page-subtitle">
              {[student.grade, student.school, student.gender, student.advisor?.full_name && `导师 ${student.advisor.full_name}`].filter(Boolean).join(' · ') || '资料待完善'}
            </p>
          </div>
        </div>
        <button type="button" className="e4-btn-ghost" onClick={() => setEditOpen(true)}>编辑资料</button>
      </div>

      {student.notes && <p className="e4-detail-notes">{student.notes}</p>}

      <div className="e4-detail-summary">
        <div className="e4-summary-cell">
          <span className="e4-summary-value">{prepReports.length}</span>
          <span className="e4-summary-label">会前准备</span>
        </div>
        <div className="e4-summary-cell">
          <span className="e4-summary-value">{firstReports.length}</span>
          <span className="e4-summary-label">分析报告</span>
        </div>
        <div className="e4-summary-cell">
          <span className="e4-summary-value">{progressReports.length}</span>
          <span className="e4-summary-label">过程报告</span>
        </div>
        <div className="e4-summary-cell">
          <span className="e4-summary-value e4-summary-y4">
            <i className={`e4-summary-dot ${student.y4_report_id ? 'is-on' : 'is-off'}`} />
            {student.y4_report_id ? '已关联' : '未关联'}
          </span>
          <span className="e4-summary-label">Y4 协议</span>
        </div>
      </div>

      <div className="e4-detail-cards">
        <section className="e4-info-card">
          <div className="e4-info-card-head">
            <h2>Y4 测评关联</h2>
            <button type="button" className="e4-btn-mini" onClick={() => setLinkOpen(true)}>
              <IconLink />
              {student.y4_report_id ? '更换关联' : '关联 Y4 报告'}
            </button>
          </div>
          {student.y4_report_id ? (
            <>
              <dl className="e4-def-list">
                <div><dt>Y4 学生</dt><dd>{student.y4_student_name || `#${student.y4_student_id}`}</dd></div>
                <div><dt>Y4 报告</dt><dd>#{student.y4_report_id}{student.y4_report_date ? ` · 测评日期 ${student.y4_report_date}` : ''}</dd></div>
              </dl>
              <button type="button" className="e4-btn-mini" onClick={openY4Report}>
                {y4Busy ? '加载中…' : '查看 Y4 原始报告'}
              </button>
            </>
          ) : (
            <p className="e4-card-hint">尚未关联 Y4 报告。首次报告需要基于一份 Y4 报告生成的 E4 协议。</p>
          )}
        </section>

        <section className="e4-info-card">
          <div className="e4-info-card-head"><h2>一表人才关联</h2></div>
          {student.tracker_profile_id ? (
            <dl className="e4-def-list">
              <div><dt>追踪学生</dt><dd>{student.tracker?.full_name || '已关联'}</dd></div>
            </dl>
          ) : (
            <p className="e4-card-hint">暂未关联。过程中报告（后续功能）将使用一表人才的追踪数据。</p>
          )}
        </section>
      </div>

      <section className="e4-report-section">
        <div className="e4-info-card-head">
          <h2>首次学习力会议 · 会前准备</h2>
          <button
            type="button"
            className="e4-btn-primary"
            disabled={!student.y4_report_id}
            onClick={() => nav(`/e4/students/${student.id}/new-prep`)}
            title={student.y4_report_id ? '' : '请先关联 Y4 报告'}
          >
            生成会前准备
          </button>
        </div>

        {prepReports.length === 0 && (
          <p className="e4-card-hint">
            结合 Y4 协议与成长地图生成会前准备：学科线索排序 + E1–E4 确认清单，会议中可边问边勾选速记。
          </p>
        )}

        <div className="e4-report-list">
          {prepReports.map((r) => (
            <div key={r.id} className="e4-report-row" onContextMenu={(e) => openRowMenu(e, r)}>
              <div className="e4-report-row-main">
                <span className="e4-report-name">
                  首次学习力会议会前准备
                  <span className={`e4-status-badge e4-status-${r.status}`}>
                    {r.status === 'final' ? '最终版' : '草稿'}
                  </span>
                </span>
                <span className="e4-report-meta">
                  {r.form_data?.prepCover?.meetingDate
                    ? `会议 ${r.form_data.prepCover.meetingDate}`
                    : '会议日期未填写'}
                  {r.created_at ? ` · 创建于 ${String(r.created_at).slice(0, 10)}` : ''}
                </span>
              </div>
              <div className="e4-report-row-actions">
                <button type="button" className="e4-btn-mini" onClick={() => nav(`/e4/prep/${r.id}`)}>
                  进入工作台
                </button>
                <button type="button" className="e4-btn-mini" onClick={() => openPrintPreview(r)}>
                  预览 / 下载 PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="e4-report-section">
        <div className="e4-info-card-head">
          <h2>学习力分析报告</h2>
          <button
            type="button"
            className="e4-btn-primary"
            disabled={!student.y4_report_id}
            onClick={() => nav(`/e4/students/${student.id}/new-first`)}
            title={student.y4_report_id ? '' : '请先关联 Y4 报告'}
          >
            生成首次报告
          </button>
        </div>

        {firstReports.length === 0 && <p className="e4-card-hint">还没有报告。首次会议后即可生成《首次学习力分析报告》。</p>}

        <div className="e4-report-list">
          {firstReports.map((r) => (
            <div key={r.id} className="e4-report-row" onContextMenu={(e) => openRowMenu(e, r)}>
              <div className="e4-report-row-main">
                <span className="e4-report-name">
                  首次学习力分析报告
                  <span className={`e4-status-badge e4-status-${r.status}`}>
                    {r.status === 'final' ? '最终版' : '草稿'}
                  </span>
                </span>
                <span className="e4-report-meta">
                  {r.meeting_date ? `会议 ${r.meeting_date} · ` : ''}{r.report_date ? `报告 ${r.report_date}` : '日期未填写'}
                </span>
              </div>
              <div className="e4-report-row-actions">
                <button type="button" className="e4-btn-mini" onClick={() => nav(`/e4/reports/${r.id}/build`)}>
                  {r.status === 'final' ? '查看 / 编辑' : '继续编辑'}
                </button>
                <button type="button" className="e4-btn-mini" onClick={() => openPrintPreview(r)}>
                  预览 / 下载 PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="e4-report-section">
        <div className="e4-info-card-head">
          <h2>过程中报告</h2>
          <button
            type="button"
            className="e4-btn-primary"
            disabled={!student.tracker_profile_id}
            onClick={() => nav(`/e4/students/${student.id}/new-progress`)}
            title={student.tracker_profile_id ? '' : '请先关联一表人才学生'}
          >
            生成过程报告
          </button>
        </div>

        {progressReports.length === 0 && (
          <p className="e4-card-hint">
            基于一表人才追踪数据生成的过程性学习力反馈，自动填入记录覆盖、时长、学科结构与自主占比，其余由导师完善。
          </p>
        )}

        <div className="e4-report-list">
          {progressReports.map((r) => (
            <div key={r.id} className="e4-report-row" onContextMenu={(e) => openRowMenu(e, r)}>
              <div className="e4-report-row-main">
                <span className="e4-report-name">
                  过程学习力报告
                  <span className={`e4-status-badge e4-status-${r.status}`}>
                    {r.status === 'final' ? '最终版' : '草稿'}
                  </span>
                </span>
                <span className="e4-report-meta">
                  {r.report_date ? `报告 ${r.report_date}` : '日期未填写'}{r.created_at ? ` · 创建于 ${String(r.created_at).slice(0, 10)}` : ''}
                </span>
              </div>
              <div className="e4-report-row-actions">
                <button type="button" className="e4-btn-mini" onClick={() => nav(`/e4/progress/${r.id}`)}>
                  {r.status === 'final' ? '查看 / 编辑' : '继续编辑'}
                </button>
                <button type="button" className="e4-btn-mini" onClick={() => openPrintPreview(r)}>
                  预览 / 下载 PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <StudentFormModal open={editOpen} initial={student} onClose={() => setEditOpen(false)} onSaved={load} />
      <Y4LinkModal
        open={linkOpen}
        student={student}
        // 已关联 Y4 学生但缺报告时（建档兜底路径留下的一半关联），
        // 打开直接进选报告那一步，不必重搜学生
        initialY4Student={
          student.y4_student_id && !student.y4_report_id
            ? { id: student.y4_student_id, name: student.y4_student_name }
            : null
        }
        onClose={() => setLinkOpen(false)}
        onSaved={load}
      />

      {ctxMenu && (
        <div
          className="e4-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="is-danger"
            onClick={() => { setDeleteTarget(ctxMenu.report); setCtxMenu(null); }}
          >
            <IconTrash />删除报告
          </button>
        </div>
      )}

      <E4Modal
        open={y4Open}
        onClose={() => setY4Open(false)}
        title="Y4 原始报告"
        subtitle={student.y4_student_name ? `${student.y4_student_name} · 报告 #${student.y4_report_id}` : `报告 #${student.y4_report_id}`}
        width={860}
      >
        {y4Error ? (
          <div className="e4-inline-error">{y4Error}</div>
        ) : y4Busy ? (
          <div className="e4-fetch-progress"><div className="e4-spinner" /><span>正在读取 Y4 报告…</span></div>
        ) : (
          <pre className="e4-md-preview">{y4Md || '（报告内容为空）'}</pre>
        )}
      </E4Modal>

      <E4Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="删除报告"
        subtitle={deleteTarget ? `删除「${reportTitle(deleteTarget)}」后不可恢复` : ''}
        width={400}
        footer={
          <>
            <button type="button" className="e4-btn-ghost" onClick={() => setDeleteTarget(null)}>取消</button>
            <button type="button" className="e4-btn-primary" disabled={deleting} onClick={confirmDelete}>
              {deleting ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: 'var(--e4-ink-2)', lineHeight: 1.6 }}>
          该报告（含会议纪要、会中速记与编辑内容）将被永久删除。
        </p>
      </E4Modal>

      <PrintPreviewModal
        open={!!printTarget}
        onClose={() => setPrintTarget(null)}
        title={
          printTarget?.report_type === 'prep'
            ? `${printTarget.form_data?.prepCover?.studentName || student?.display_name || '学生'} · 首次学习力会议会前准备`
            : printTarget?.report_type === 'progress'
              ? `${printTarget.form_data?.cover?.studentName || '学生'} · 过程学习力报告`
              : `${printTarget?.form_data?.cover?.studentName || '学生'} · 首次学习力分析报告`
        }
        badge={
          printTarget && printTarget.report_type !== 'prep' && printTarget.status === 'final' ? (
            <span className="e4-status-badge e4-status-final">最终版</span>
          ) : null
        }
      >
        {printTarget?.report_type === 'prep' ? (
          <PrepPrint report={printTarget} />
        ) : printTarget?.report_type === 'progress' ? (
          <ProgressPrint report={printTarget} />
        ) : printTarget ? (
          <FirstReportPrint report={printTarget} />
        ) : null}
      </PrintPreviewModal>
    </div>
  );
}
