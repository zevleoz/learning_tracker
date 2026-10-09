// E4《阶段学习力复盘报告》页面：
//   路由 A：/e4/students/:studentId/new-progress —— 校验一表人才关联 + 选复盘周期并生成
//   路由 B：/e4/progress/:reportId —— 两栏工作台（左 A4 可编辑预览 / 右侧说明）
// 量化字段由一表人才学习记录自动预填，可点改；定性字段由导师填写；全部自动保存。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getE4Student, getReport, listReportsForStudent, createProgressReport, updateReport,
} from '../../lib/e4Store.js';
import { fetchProgressSessions, fetchProgressSyllabus, aggregateProgress, ProgressDataError } from '../../lib/e4ProgressData.js';
import { buildProgressDraft, PROGRESS_MODULES, extractCarry } from '../../lib/e4ProgressTemplate.js';
import { todayISO } from '../../lib/date.js';
import { useAuth } from '../../lib/useAuth.js';
import { toast } from '../../lib/toast.js';
import { useMergedAutosave } from '../../lib/useAutosave.js';
import ProgressPrint from '../../components/e4/ProgressPrint.jsx';
import PrintPreviewModal from '../../components/e4/PrintPreviewModal.jsx';
import DatePicker from '../../components/ui/date-picker.jsx';

// 与其它 E4 工作台一致的日期控件外观（UI-2：不再使用原生 date input）
// 仅排版（尺寸/圆角/字号）；配色交给作用域化的 shadcn 变量，主题切换自动跟随
const dateFieldCls = 'h-auto rounded-[9px] px-3 py-[9px] text-[13.5px] font-normal';

// A4 文档固定 210mm：左栏预览按容器宽度整体缩放，高度随内容联动
function ScaledDoc({ children }) {
  const wrapRef = useRef(null);
  const docRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const doc = docRef.current;
    if (!wrap || !doc) return undefined;
    const update = () => {
      const docW = doc.offsetWidth || 1;
      const s = Math.min(1, wrap.clientWidth / docW);
      setScale(s);
      setHeight(Math.ceil(doc.offsetHeight * s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    ro.observe(doc);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="e4-scaled-doc" style={height ? { height } : undefined}>
      <div ref={docRef} className="e4-scaled-doc-inner" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// 路由 A：/e4/students/:studentId/new-progress
// ----------------------------------------------------------------
function NewProgressFlow({ studentId }) {
  const nav = useNavigate();
  const { profile } = useAuth();
  const [student, setStudent] = useState(null);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState(todayISO(-29));
  const [endDate, setEndDate] = useState(todayISO());
  const [phase, setPhase] = useState('idle'); // idle | fetching

  useEffect(() => {
    getE4Student(studentId).then(setStudent).catch((e) => setError(e.message));
  }, [studentId]);

  const hasTracker = !!student?.tracker_profile_id;

  async function start() {
    if (!hasTracker) return;
    const s = String(startDate || '');
    const e = String(endDate || '');
    if (!s || !e) {
      setError('请选择复盘周期');
      return;
    }
    if (e < s) {
      setError('复盘周期的结束日期不能早于开始日期');
      return;
    }
    setPhase('fetching');
    setError('');
    try {
      const [sessions, syllabus, reports] = await Promise.all([
        fetchProgressSessions(student.tracker_profile_id, s, e),
        fetchProgressSyllabus(student.tracker_profile_id),
        listReportsForStudent(student.id).catch(() => []),
      ]);
      const aggregate = aggregateProgress(sessions, s, e, syllabus);

      // 报告期数 = 已有过程报告数 + 1
      const progressCount = (reports || []).filter((r) => r.report_type === 'progress').length;
      // 上阶段承接：取最新一份 first/progress 报告，字段按类型分派（见 extractCarry）
      const prior = [...(reports || [])]
        .filter((r) => r.report_type === 'first' || r.report_type === 'progress')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
      const carry = extractCarry(prior);

      const draft = buildProgressDraft(aggregate, student, {
        issueNumber: progressCount + 1,
        reportDate: todayISO(),
        periodStart: s,
        periodEnd: e,
        carry,
      });

      const report = await createProgressReport({
        e4StudentId: student.id,
        createdBy: profile.id,
        reportDate: todayISO(),
        formData: draft,
      });
      toast('过程报告已生成，量化数据已自动填入', { kind: 'success' });
      nav(`/e4/progress/${report.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ProgressDataError ? err.message : `生成过程报告失败：${err.message}`);
      setPhase('idle');
    }
  }

  return (
    <div className="e4-page">
      <button type="button" className="e4-back-link" onClick={() => nav(`/e4/students/${studentId}`)}>
        返回学生页面
      </button>
      <div className="e4-fetch-card">
        <h1 className="e4-page-title">生成过程学习力报告</h1>
        <p className="e4-page-subtitle">
          {student?.display_name || '该学生'}
          {student?.tracker?.full_name ? ` · 追踪 ${student.tracker.full_name}` : ''}
        </p>
        {student && !student.tracker_profile_id && (
          <div className="e4-inline-error">
            该学生尚未关联一表人才学生，无法读取学习记录。请先返回学生页面完成「一表人才关联」。
          </div>
        )}
        <div className="e4-fetch-body">
          <p>
            系统将读取该学生在一表人才中的学习记录，自动填入
            <strong> 记录覆盖、总时长、工作日/周末平均、学习日历、分学科时间结构与自主占比 </strong>
            等量化内容；其余观察与判断默认留空，由你在工作台中填写，所有内容均可手动调整。
          </p>
          <div className="e4-progress-period-field">
            <label className="e4-progress-period-label">复盘周期</label>
            <DatePicker value={startDate} onChange={setStartDate} className={dateFieldCls} placeholder="开始日期" />
            <span className="e4-progress-period-field-sep">至</span>
            <DatePicker value={endDate} onChange={setEndDate} className={dateFieldCls} placeholder="结束日期" />
          </div>
          {phase === 'fetching' && (
            <div className="e4-fetch-progress">
              <div className="e4-spinner" />
              <span>正在读取一表人才学习记录并生成报告…</span>
            </div>
          )}
          {error && <div className="e4-inline-error">{error}</div>}
        </div>
        <div className="e4-fetch-actions">
          <button type="button" className="e4-btn-ghost" onClick={() => nav(`/e4/students/${studentId}`)}>
            取消
          </button>
          <button type="button" className="e4-btn-primary" disabled={!hasTracker || phase === 'fetching'} onClick={start}>
            {phase === 'fetching' ? '生成中…' : '生成过程报告'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// 路由 B：/e4/progress/:reportId —— 工作台编辑页
// ----------------------------------------------------------------
function ProgressWorkbench({ reportId }) {
  const nav = useNavigate();
  const [report, setReport] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);

  // 最终版锁定（与其他 E4 工作台同策略；过程报告当前不提供定稿入口，防御性支持）
  const locked = report?.status === 'final';
  const { saveState, savedAt, persist } = useMergedAutosave(
    useCallback((patch) => updateReport(reportId, patch), [reportId])
  );

  useEffect(() => {
    getReport(reportId)
      .then((r) => {
        if (!r) {
          setLoadError('未找到该过程报告');
          return;
        }
        if (r.report_type !== 'progress' || !r.form_data?.cover) {
          setLoadError('该记录不是过程报告，或内容尚未生成');
          return;
        }
        setReport(r);
        setForm(r.form_data);
      })
      .catch((e) => setLoadError(e.message));
  }, [reportId]);

  useEffect(() => {
    if (!form || locked) return;
    persist({ form_data: form });
  }, [form, persist, locked]);

  // ProgressPrint 的 desc 协议统一写入口
  const updateField = useCallback((desc, value) => {
    setForm((f) => {
      const next = structuredClone(f);
      if (desc.area === 'cover') {
        next.cover[desc.key] = value;
      } else if (desc.area === 'p2') {
        next.p2[desc.key] = value;
      } else if (desc.area === 'scope') {
        next.p2.scope = { ...(next.p2.scope || {}), [desc.key]: value };
      } else if (desc.area === 'p3') {
        next.p3[desc.key] = value;
      } else if (desc.area === 'subject') {
        next.subjects[desc.index][desc.field] = value;
      } else if (desc.area === 'problem') {
        next.p4.problems[desc.index][desc.field] = value;
      } else if (desc.area === 'p5') {
        next.p5[desc.key] = value;
      } else if (desc.area === 'module') {
        next.p7.modules = { ...(next.p7.modules || {}) };
        next.p7.modules[desc.key] = { ...(next.p7.modules[desc.key] || {}), [desc.field]: value };
      } else if (desc.area === 'p8') {
        next.p8[desc.key] = value;
      } else if (desc.area === 'solution') {
        next.p8.solutions[desc.index][desc.field] = value;
      }
      return next;
    });
  }, []);

  const onTableOp = useCallback((op, payload) => {
    setForm((f) => {
      const next = structuredClone(f);
      if (op === 'addSubject' && (next.subjects?.length || 0) < 8) {
        next.subjects.push({ subject: '', totalMinsText: '0 分钟', sharePctText: '0%', structureText: '学0%  复0%  练0%', reviewMinsText: '0 分钟', practiceCountText: '0 次', evalText: '', autonomyPctText: '0%', experience: '', emotion: '', finding: '' });
      } else if (op === 'delSubject' && (next.subjects?.length || 0) > 1) {
        next.subjects.splice(payload.index, 1);
      } else if (op === 'addProblem') {
        next.p4.problems.push({ subject: '', issue: '' });
      } else if (op === 'delProblem' && (next.p4.problems?.length || 0) > 1) {
        next.p4.problems.splice(payload.index, 1);
      } else if (op === 'addSolution') {
        next.p8.solutions.push({ direction: '', arrangement: '' });
      } else if (op === 'delSolution' && (next.p8.solutions?.length || 0) > 1) {
        next.p8.solutions.splice(payload.index, 1);
      }
      return next;
    });
  }, []);

  // 待判断：四个 E4 模块中尚未给出状态的数量
  const pendingJudgments = useMemo(() => {
    const mods = form?.p7?.modules || {};
    return PROGRESS_MODULES.filter((m) => !mods[m.key]?.status).length;
  }, [form]);

  if (loadError) {
    return (
      <div className="e4-page">
        <div className="e4-inline-error">{loadError}</div>
      </div>
    );
  }
  if (!form || !report) {
    return (
      <div className="e4-page" aria-busy="true" aria-label="加载过程报告">
        <span className="e4-skeleton" style={{ width: 92, height: 12 }} />
        <span className="e4-skeleton" style={{ width: '100%', maxWidth: 520, height: 44, borderRadius: 10, marginTop: 16 }} />
        <span className="e4-skeleton" style={{ width: '100%', height: 160, borderRadius: 10, marginTop: 20 }} />
      </div>
    );
  }

  const studentName = form.cover?.studentName || '学生';

  return (
    <div className="e4-page e4-progress-page">
      {/* 吸顶 command bar */}
      <div className="e4-command-bar">
        <div className="e4-command-left">
          <button type="button" className="e4-back-link" onClick={() => nav(`/e4/students/${report.e4_student_id}`)}>
            返回学生页面
          </button>
          <span className="e4-prep-title">过程报告 · {studentName}</span>
        </div>
        <div className="e4-command-right">
          {pendingJudgments > 0 && (
            <span className="e4-pending-pill" title="尚未给出状态判断的 E4 模块">
              <i />待判断 {pendingJudgments}
            </span>
          )}
          <button type="button" className="e4-btn-mini" onClick={() => setPrintOpen(true)}>
            预览 / 下载 PDF
          </button>
          <div className={`e4-save-state ${saveState === 'saving' ? 'is-saving' : saveState === 'saved' ? 'is-saved' : ''}`}>
            {saveState === 'saving' ? (
              <><span className="e4-save-spinner" />保存中…</>
            ) : saveState === 'saved' ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                已自动保存{savedAt ? ` ${savedAt}` : ''}
              </>
            ) : (
              '更改将自动保存'
            )}
          </div>
        </div>
      </div>

      <div className="e4-progress-workbench">
        <div className="e4-progress-preview">
          <ScaledDoc>
            <ProgressPrint report={{ ...report, form_data: form }} editable={!locked} onPatch={updateField} onTableOp={onTableOp} />
          </ScaledDoc>
        </div>
        <aside className="e4-prep-panel">
          <div className="e4-prep-panel-head">
            <h2>编写指引</h2>
          </div>
          <p className="e4-prep-panel-hint">
            量化数据已从一表人才自动填入，点击任意单元格即可改写；观察、情绪与判断请依据复盘会议填写。
          </p>
          <div className="e4-progress-guide-list">
            {PROGRESS_MODULES.map((m) => {
              const done = !!form.p7?.modules?.[m.key]?.status;
              return (
                <div key={m.key} className={`e4-progress-guide-row ${done ? 'is-done' : ''}`}>
                  <span className={`e4-progress-guide-dot tint-${m.tint}`}><i /></span>
                  <span className="e4-progress-guide-name">{m.cn}</span>
                  <span className="e4-progress-guide-hint">{m.judgmentHint}</span>
                  {done && <span className="e4-progress-guide-done">已判断</span>}
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      <PrintPreviewModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        title={`${studentName} · 过程学习力报告`}
      >
        <ProgressPrint report={{ ...report, form_data: form }} />
      </PrintPreviewModal>
    </div>
  );
}

export default function E4ProgressPage() {
  const { studentId, reportId } = useParams();
  if (studentId) return <NewProgressFlow studentId={studentId} />;
  return <ProgressWorkbench reportId={reportId} />;
}