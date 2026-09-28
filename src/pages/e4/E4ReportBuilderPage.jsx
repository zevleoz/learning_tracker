import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  getE4Student, getReport, createFirstReport, updateReport,
} from '../../lib/e4Store.js';
import { fetchProtocol, Y4ApiError } from '../../lib/y4api.js';
import { parseE4Protocol } from '../../lib/e4ProtocolParser.js';
import {
  DIMENSIONS, DIMENSION_ORDER, JUDGMENT_STATES,
  buildReportDraft, deriveConfirmedIssues,
} from '../../lib/e4ReportTemplate.js';
import { useAuth } from '../../lib/useAuth.js';
import { toast } from '../../lib/toast.js';
import { summarizeMeetingNotes, generateCellNote } from '../../lib/llm.js';
import FirstReportPrint from '../../components/e4/FirstReportPrint.jsx';
import PrintPreviewModal from '../../components/e4/PrintPreviewModal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STEPS = [
  { id: 'meta', label: '会议信息' },
  { id: 'matrix', label: '核对矩阵' },
  { id: 'judgment', label: '综合判断' },
  { id: 'finish', label: '完成' },
];

// ----------------------------------------------------------------
// 路由 A：/e4/students/:studentId/new-first —— 拉取协议并建档
// ----------------------------------------------------------------
function NewFirstFlow({ studentId }) {
  const nav = useNavigate();
  const { profile } = useAuth();
  const [student, setStudent] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | fetching | error
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    getE4Student(studentId).then(setStudent).catch((e) => setError(e.message));
  }, [studentId]);

  async function start() {
    if (!student?.y4_report_id) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('fetching');
    setError('');
    try {
      const md = await fetchProtocol(student.y4_report_id, { signal: controller.signal });
      const draft = buildReportDraft(parseE4Protocol(md));
      const report = await createFirstReport({
        e4StudentId: student.id,
        createdBy: profile.id,
        protocolMd: md,
        formData: draft,
      });
      toast('E4 协议已生成，开始填写报告', { kind: 'success' });
      nav(`/e4/reports/${report.id}/build`, { replace: true });
    } catch (err) {
      if (err.name === 'AbortError') {
        setPhase('idle');
        return;
      }
      setError(err instanceof Y4ApiError ? err.message : `拉取 E4 协议失败：${err.message}`);
      setPhase('error');
    }
  }

  return (
    <div className="e4-page">
      <button type="button" className="e4-back-link" onClick={() => nav(`/e4/students/${studentId}`)}>
        返回学生页面
      </button>
      <div className="e4-fetch-card">
        <h1 className="e4-page-title">生成首次学习力分析报告</h1>
        <p className="e4-page-subtitle">
          {student?.display_name || '该学生'} · Y4 报告 #{student?.y4_report_id || '—'}
        </p>
        {!student?.y4_report_id && (
          <div className="e4-inline-error">该学生尚未关联 Y4 报告，请先返回学生页面完成关联。</div>
        )}
        <div className="e4-fetch-body">
          <p>
            点击后将实时调用 Y4 AI 生成该学生的 <strong>E4 评估协议</strong>，
            通常需要 10–30 秒。协议会作为快照保存，之后再次编辑不会重复调用。
          </p>
          {phase === 'fetching' && (
            <div className="e4-fetch-progress">
              <div className="e4-spinner" />
              <span>正在生成 E4 协议，请稍候，期间不要关闭页面…</span>
            </div>
          )}
          {error && <div className="e4-inline-error">{error}</div>}
        </div>
        <div className="e4-fetch-actions">
          <button type="button" className="e4-btn-ghost" onClick={() => nav(`/e4/students/${studentId}`)}>
            取消
          </button>
          {phase === 'fetching' ? (
            <button type="button" className="e4-btn-ghost" onClick={() => abortRef.current?.abort()}>
              取消拉取
            </button>
          ) : (
            <button type="button" className="e4-btn-primary" disabled={!student?.y4_report_id} onClick={start}>
              生成 E4 协议并开始
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// 路由 B：/e4/reports/:reportId/build —— 编辑既有报告
// ----------------------------------------------------------------
function BuildFlow({ reportId }) {
  const nav = useNavigate();
  const [report, setReport] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState('meta');
  const [form, setForm] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [reportDate, setReportDate] = useState(todayISO());
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [savedAt, setSavedAt] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [jFilter, setJFilter] = useState('全部'); // 核对矩阵筛选：全部 / 各判断状态 / 待核实
  const [aiGenerating, setAiGenerating] = useState(false);
  const [activeRowId, setActiveRowId] = useState(null); // 键盘当前焦点行（纪要侧栏联动）
  const [aiCellRowId, setAiCellRowId] = useState(null); // 矩阵中单行 AI 生成中
  const [aiDocKey, setAiDocKey] = useState(''); // 最终文档中某个区域 AI 生成中（desc 序列化）
  const [evidence, setEvidence] = useState([]); // 最近一次 AI 生成的纪要原文证据（侧栏高亮）
  const [openRows, setOpenRows] = useState({}); // 矩阵行展开状态提升到父级：支持全部展开/收起
  const matrixPanelRef = useRef(null);
  const saveTimer = useRef(null);
  const firstSave = useRef(true);

  useEffect(() => {
    getReport(reportId)
      .then((r) => {
        if (!r) {
          setLoadError('未找到该报告');
          return;
        }
        setReport(r);
        setForm(r.form_data && r.form_data.sections ? r.form_data : buildReportDraft(parseE4Protocol(r.protocol_md || '')));
        setMinutes(r.minutes_text || '');
        setMeetingDate(r.meeting_date || '');
        setReportDate(r.report_date || todayISO());
      })
      .catch((e) => setLoadError(e.message));
  }, [reportId]);

  const persist = useCallback((patch) => {
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateReport(reportId, patch);
        setSaveState('saved');
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      } catch {
        setSaveState('idle');
        toast('自动保存失败，请检查网络', { kind: 'error' });
      }
    }, firstSave.current ? 0 : 700);
    firstSave.current = false;
  }, [reportId]);

  // 表单变化 → 自动保存
  useEffect(() => {
    if (!form) return;
    persist({ form_data: form });
  }, [form, persist]);

  useEffect(() => {
    if (!report) return;
    persist({ minutes_text: minutes });
  }, [minutes, report, persist]);

  useEffect(() => {
    if (!report) return;
    persist({ meeting_date: meetingDate || null, report_date: reportDate || null });
  }, [meetingDate, reportDate, report, persist]);

  const updateCover = (patch) => setForm((f) => ({ ...f, cover: { ...f.cover, ...patch } }));

  // 从协议重新生成草稿：模板/协议更新后用于刷新已建档的报告（会覆盖导师手改内容）
  const rebuildFromProtocol = () => {
    if (!report) return;
    setForm(buildReportDraft(parseE4Protocol(report.protocol_md || '')));
    setRebuildOpen(false);
    toast('已按协议重建草稿，请复核后保存', { kind: 'success' });
  };

  const updateRow = (dim, rowId, key, value) =>
    setForm((f) => ({
      ...f,
      sections: {
        ...f.sections,
        [dim]: {
          ...f.sections[dim],
          rows: f.sections[dim].rows.map((r) => (r.rowId === rowId ? { ...r, [key]: value } : r)),
        },
      },
    }));

  // 会议看板键盘流：仅行头获得焦点时响应
  // ↑↓ 移动焦点 · 1-4 设判断 · J 跳到下一条待核实 · Enter 展开（在行组件内处理）
  const onMatrixKeyDown = useCallback((e) => {
    const head = e.target.closest?.('.e4-matrix-row-head');
    const panel = matrixPanelRef.current;
    if (!head || !panel) return;
    const heads = Array.from(panel.querySelectorAll('.e4-matrix-row-head'));
    const i = heads.indexOf(document.activeElement);
    if (i === -1) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? heads[Math.min(i + 1, heads.length - 1)]
        : heads[Math.max(i - 1, 0)];
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (/^[1-4]$/.test(e.key)) {
      e.preventDefault();
      const rowEl = head.closest('.e4-matrix-row');
      const { dim, rowid } = rowEl?.dataset || {};
      if (dim && rowid) updateRow(dim, rowid, 'judgment', JUDGMENT_STATES[Number(e.key) - 1]);
      return;
    }

    if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      const rows = Array.from(panel.querySelectorAll('.e4-matrix-row[data-pending="true"]'));
      if (!rows.length) {
        toast('所有排查项都已填写会议核实情况', { kind: 'success' });
        return;
      }
      const after = rows.find((r) => heads.indexOf(r.querySelector('.e4-matrix-row-head')) > i);
      const target = after || rows[0];
      const targetHead = target.querySelector('.e4-matrix-row-head');
      targetHead.focus();
      targetHead.scrollIntoView({ block: 'center' });
    }
  }, [form]);

  // AI：把会议纪要总结成每个排查项的「会议核实情况」
  const handleGenerateMeetingNotes = useCallback(async () => {
    if (!minutes || !minutes.trim()) {
      toast('请先在「会议信息」步骤粘贴会议纪要', { kind: 'error' });
      return;
    }
    if (!form) return;
    const allRows = DIMENSION_ORDER.flatMap((c) =>
      form.sections[c].rows.map((r) => ({ rowId: r.rowId, label: r.label, y4Clue: r.y4Clue }))
    );
    if (allRows.length === 0) {
      toast('当前没有可生成佐证的排查项', { kind: 'error' });
      return;
    }
    setAiGenerating(true);
    try {
      const notes = await summarizeMeetingNotes(minutes, allRows);
      let filled = 0;
      for (const code of DIMENSION_ORDER) {
        for (const r of form.sections[code].rows) {
          const v = notes[r.rowId];
          if (v && v.trim()) {
            updateRow(code, r.rowId, 'meetingNote', v.trim());
            filled += 1;
          }
        }
      }
      if (filled === 0) {
        toast('未从纪要中提取到相关佐证，请手动补充');
      } else {
        toast(`已为 ${filled} 项生成会议佐证，请逐行复核`, { kind: 'success' });
      }
    } catch (e) {
      toast(`AI 生成失败：${e.message || '未知错误'}`, { kind: 'error' });
    } finally {
      setAiGenerating(false);
    }
  }, [minutes, form]);

  // 区域级 AI 通用执行器：成功后写回、在纪要侧栏高亮证据
  const runCellAI = useCallback(async ({ field, label, y4Clue = '', current = '' }) => {
    if (!minutes.trim()) {
      toast('请先在「会议信息」步骤粘贴会议纪要', { kind: 'error' });
      return null;
    }
    const result = await generateCellNote({ minutes, label, field, y4Clue, current });
    if (result.evidence?.length) {
      setEvidence(result.evidence);
      setMinutesOpen(true);
    }
    return result;
  }, [minutes]);

  // 矩阵：AI 补单行
  const handleRowAi = useCallback(async (dim, row) => {
    setAiCellRowId(row.rowId);
    try {
      const result = await runCellAI({
        field: 'meetingNote',
        label: row.label,
        y4Clue: row.y4Clue,
        current: row.meetingNote,
      });
      if (!result) return;
      if (result.note) {
        updateRow(dim, row.rowId, 'meetingNote', result.note);
        toast('已生成该项会议佐证，请复核', { kind: 'success' });
      } else {
        toast('纪要中没有找到与该项相关的内容');
      }
    } catch (e) {
      toast(`AI 生成失败：${e.message || '未知错误'}`, { kind: 'error' });
    } finally {
      setAiCellRowId(null);
    }
  }, [runCellAI]);

  // 最终文档：把区域 desc 映射成 AI 任务，返回 DocField 需要的 {busy,onGenerate}
  const aiForDoc = useCallback((d, ctx) => {
    const spec = (() => {
      if (d.area === 'row' && d.key === 'meetingNote') {
        return { field: 'meetingNote', label: ctx?.label || '', y4Clue: ctx?.y4Clue || '', current: ctx?.value || '' };
      }
      if (d.area === 'narrative') return { field: 'narrative', label: ctx?.label || '' };
      if (d.area === 's07' && d.key === 'familyQuote') return { field: 'quote', label: '家庭最初反映' };
      if (d.area === 's07' && d.key === 'studentQuote') return { field: 'quote', label: '学生自己的理解' };
      if (d.area === 'issueText') return { field: 'narrative', label: `已确认关键问题 · ${ctx?.dimension || ''}` };
      if (d.area === 'solutionField') return { field: 'solution', label: d.key === 'direction' ? '问题解决方案 · 成长方向' : '问题解决方案 · 简要安排' };
      return null;
    })();
    if (!spec || !spec.label) return null;
    const key = JSON.stringify(d);
    return {
      busy: aiDocKey === key,
      onGenerate: async () => {
        setAiDocKey(key);
        try {
          const result = await runCellAI(spec);
          if (result?.note) {
            handleDocPatch(d, result.note);
            toast('该区域已由 AI 生成，请复核', { kind: 'success' });
          } else if (result) {
            toast('纪要中没有找到可用于该区域的内容');
          }
        } catch (e) {
          toast(`AI 生成失败：${e.message || '未知错误'}`, { kind: 'error' });
        } finally {
          setAiDocKey('');
        }
      },
    };
  }, [aiDocKey, runCellAI]);

  const updateNarrative = (dim, key, value) =>
    setForm((f) => ({
      ...f,
      sections: {
        ...f.sections,
        [dim]: { ...f.sections[dim], narratives: { ...f.sections[dim].narratives, [key]: value } },
      },
    }));

  const confirmed = useMemo(() => (form ? deriveConfirmedIssues(form.sections) : []), [form]);

  // 待核实计数（会议核实情况为空的行数），command bar 常驻
  const pendingCount = useMemo(() => {
    if (!form) return 0;
    return DIMENSION_ORDER.reduce(
      (n, c) => n + form.sections[c].rows.filter((r) => !String(r.meetingNote || '').trim()).length,
      0
    );
  }, [form]);

  // 全部展开/收起
  const allRowIds = useMemo(
    () => (form ? DIMENSION_ORDER.flatMap((c) => form.sections[c].rows.map((r) => r.rowId)) : []),
    [form]
  );
  const allOpen = allRowIds.length > 0 && allRowIds.every((id) => openRows[id]);
  const toggleRow = useCallback((rowId) => setOpenRows((m) => ({ ...m, [rowId]: !m[rowId] })), []);
  const setAllRowsOpen = useCallback((v) => {
    setOpenRows(v ? Object.fromEntries(allRowIds.map((id) => [id, true])) : {});
  }, [allRowIds]);

  function updateS07(patch) {
    setForm((f) => ({ ...f, section07: { ...f.section07, ...patch } }));
  }

  function setIssueOverride(dim, text) {
    setForm((f) => ({
      ...f,
      section07: {
        ...f.section07,
        issueOverrides: { ...(f.section07.issueOverrides || {}), [dim]: text },
      },
    }));
  }

  function hideIssue(dim) {
    setForm((f) => ({
      ...f,
      section07: {
        ...f.section07,
        issueOverrides: { ...(f.section07.issueOverrides || {}), [dim]: null },
      },
    }));
  }

  // 可编辑最终文档：所有区域编辑汇总到同一个数据模型
  const handleDocPatch = useCallback((d, value) => {
    switch (d.area) {
      case 'cover':
        updateCover({ [d.key]: value });
        break;
      case 'report':
        if (d.key === 'meeting_date') setMeetingDate(value);
        if (d.key === 'report_date') setReportDate(value);
        break;
      case 'row':
        updateRow(d.dim, d.rowId, d.key, value);
        break;
      case 'narrative':
        updateNarrative(d.dim, d.key, value);
        break;
      case 's07':
        updateS07({ [d.key]: value });
        break;
      case 'issueText':
        setIssueOverride(d.dim, value);
        break;
      case 'solutionField':
        setForm((f) => ({
          ...f,
          section07: {
            ...f.section07,
            solutions: f.section07.solutions.map((s, i) =>
              i === d.index ? { ...s, [d.key]: value } : s
            ),
          },
        }));
        break;
      default:
        break;
    }
  }, []);

  const handleTableOp = useCallback((op, payload = {}) => {
    if (op === 'addSolution') {
      updateS07({ solutions: [...(form.section07.solutions || []), { direction: '', arrangement: '' }] });
    } else if (op === 'delSolution') {
      updateS07({ solutions: form.section07.solutions.filter((_, i) => i !== payload.index) });
    } else if (op === 'removeIssue') {
      hideIssue(payload.dim);
    }
  }, [form]);

  const missingRequired = useMemo(() => {
    const miss = [];
    if (!meetingDate) miss.push('首次会议日期');
    if (!reportDate) miss.push('报告日期');
    if (!form?.section07?.nextReviewDate) miss.push('下次复盘时间');
    if (!form?.section07?.nextReviewFocus?.trim()) miss.push('下次复盘重点验证');
    return miss;
  }, [meetingDate, reportDate, form]);

  const finishChecks = useMemo(() => [
    { label: '首次会议日期', done: !!meetingDate, goto: 'meta' },
    { label: '报告日期', done: !!reportDate, goto: 'meta' },
    { label: '下次复盘时间', done: !!form?.section07?.nextReviewDate, goto: 'judgment' },
    { label: '下次复盘重点验证', done: !!form?.section07?.nextReviewFocus?.trim(), goto: 'judgment' },
  ], [meetingDate, reportDate, form]);

  // 纪要侧栏联动：当前键盘焦点行的排查项名
  const activeRowLabel = useMemo(() => {
    if (!form || !activeRowId) return '';
    for (const code of DIMENSION_ORDER) {
      const hit = form.sections[code].rows.find((r) => r.rowId === activeRowId);
      if (hit) return hit.label;
    }
    return '';
  }, [form, activeRowId]);

  async function markFinal() {
    if (missingRequired.length) {
      toast(`请先补全：${missingRequired.join('、')}`, { kind: 'error' });
      return;
    }
    setFinalizing(true);
    try {
      clearTimeout(saveTimer.current);
      await updateReport(reportId, { status: 'final' });
      setReport((r) => ({ ...r, status: 'final' }));
      toast('已标记为最终版', { kind: 'success' });
    } catch (e) {
      toast(e.message, { kind: 'error' });
    } finally {
      setFinalizing(false);
    }
  }

  function openPrint() {
    if (missingRequired.length) {
      toast(`请先补全：${missingRequired.join('、')}`, { kind: 'error' });
      setStep('finish');
      return;
    }
    setPrintOpen(true);
  }

  if (loadError) {
    return (
      <div className="e4-page">
        <div className="e4-inline-error">{loadError}</div>
      </div>
    );
  }
  if (!form || !report) {
    return (
      <div className="e4-page e4-builder" aria-busy="true" aria-label="加载报告">
        <div className="e4-builder-topbar">
          <span className="e4-skeleton" style={{ width: 92, height: 12 }} />
        </div>
        <span className="e4-skeleton" style={{ width: '100%', maxWidth: 520, height: 44, borderRadius: 10 }} />
        <span className="e4-skeleton" style={{ width: 200, height: 18, marginTop: 28 }} />
        <span className="e4-skeleton" style={{ width: '100%', height: 120, borderRadius: 10, marginTop: 12 }} />
      </div>
    );
  }

  return (
    <div className={`e4-page e4-builder ${minutesOpen ? 'is-minutes-open' : ''}`}>
      {/* 吸顶 command bar：返回 + 步骤 + 右侧常驻操作（AI / 纪要 / 保存状态） */}
      <div className="e4-command-bar">
        <div className="e4-command-left">
          <button type="button" className="e4-back-link" onClick={() => nav(`/e4/students/${report.e4_student_id}`)}>
            返回学生页面
          </button>
          <div className="e4-stepper">
            {STEPS.map((s, i) => {
              const stepIndex = STEPS.findIndex((x) => x.id === step);
              return (
                <button
                  type="button"
                  key={s.id}
                  className={`e4-step ${step === s.id ? 'active' : ''} ${i < stepIndex ? 'is-done' : ''}`}
                  onClick={() => setStep(s.id)}
                >
                  {step === s.id && (
                    <motion.span
                      className="e4-step-pill"
                      layoutId="e4-step-pill"
                      transition={{ type: 'spring', damping: 32, stiffness: 380, mass: 0.9 }}
                    />
                  )}
                  <span className="e4-step-no">{i + 1}</span>
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="e4-command-right">
          {step === 'matrix' && (
            <>
              {pendingCount > 0 && (
                <span className="e4-pending-pill" title="会议核实情况仍为空的排查项">
                  <i />待核实 {pendingCount}
                </span>
              )}
              <button
                type="button"
                className="e4-btn-mini e4-ai-gen-btn"
                onClick={handleGenerateMeetingNotes}
                disabled={aiGenerating}
              >
                {aiGenerating ? 'AI 生成中…' : 'AI 生成会议佐证'}
              </button>
            </>
          )}
          <button
            type="button"
            className={`e4-btn-mini ${minutesOpen ? 'is-on' : ''}`}
            onClick={() => setMinutesOpen((v) => !v)}
          >
            {minutesOpen ? '收起纪要' : '会议纪要'}
          </button>
          <button
            type="button"
            className="e4-btn-mini"
            title="按最新模板从协议重新生成草稿（覆盖当前所有手动修改）"
            onClick={() => setRebuildOpen(true)}
          >
            从协议重建
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

      {/* ---- 步骤 1：会议信息 ---- */}
      {step === 'meta' && (
        <div className="e4-step-panel">
          <h2 className="e4-section-title">首次会议信息</h2>
          <div className="e4-form-grid">
            <label className="e4-field">
              <span>首次会议日期</span>
              <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
            </label>
            <label className="e4-field">
              <span>报告日期</span>
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </label>
            <label className="e4-field e4-field-full">
              <span>报告性质</span>
              <input value={form.cover.reportNature} onChange={(e) => updateCover({ reportNature: e.target.value })} />
            </label>
            <label className="e4-field e4-field-full">
              <span>证据来源</span>
              <input value={form.cover.evidenceSource} onChange={(e) => updateCover({ evidenceSource: e.target.value })} />
            </label>
            <div className="e4-field e4-field-full">
              <span>会议纪要（粘贴自由文本，后续核对时可随时参考摘选）</span>
              <textarea
                className="e4-minutes-input"
                rows={14}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="将首次会议的访谈纪要原文粘贴到这里，包括家长反映、学生自述、具体事件与行为表现…"
              />
            </div>
          </div>
          {minutes.trim().length >= 100 && (
            <div className="e4-ai-banner">
              <span className="e4-ai-banner-text">
                已粘贴纪要（约 {minutes.trim().length} 字）。可让 AI 先把会议佐证批量预填进核对矩阵，再由你逐行复核修改。
              </span>
              <button
                type="button"
                className="e4-btn-mini e4-ai-gen-btn"
                disabled={aiGenerating}
                onClick={() => { setStep('matrix'); handleGenerateMeetingNotes(); }}
              >
                {aiGenerating ? 'AI 生成中…' : 'AI 批量预填佐证'}
              </button>
            </div>
          )}
          <div className="e4-step-actions">
            <button type="button" className="e4-btn-primary" onClick={() => setStep('matrix')}>
              下一步：核对矩阵
            </button>
          </div>
        </div>
      )}

      {/* ---- 步骤 2：核对矩阵（常驻挂载：切换步骤后保留行展开/滚动状态） ---- */}
      <div className="e4-step-panel" style={{ display: step === 'matrix' ? undefined : 'none' }}>
          <div className="e4-matrix-head">
            <h2 className="e4-section-title">逐行核对四个维度</h2>
            <div className="e4-head-actions">
              <button type="button" className="e4-btn-mini" onClick={() => setAllRowsOpen(!allOpen)}>
                {allOpen ? '全部收起' : '全部展开'}
              </button>
            </div>
          </div>
          <p className="e4-step-hint">
            点击行展开编辑；「综合判断」直接点选状态；已给出协议默认建议，最终结论以你的核实为准。
          </p>
          <p className="e4-kbd-hint" aria-hidden="true">
            键盘：<kbd>↑</kbd><kbd>↓</kbd> 换行 · <kbd>1</kbd>–<kbd>4</kbd> 快速判断 · <kbd>Enter</kbd> 展开 · <kbd>J</kbd> 下一条待核实
          </p>

          <div
            className="e4-matrix-layout"
            ref={matrixPanelRef}
            onKeyDown={onMatrixKeyDown}
          >
            <DimensionRail sections={form.sections} filter={jFilter} />

            <div className="e4-dim-list">
          <MatrixFilterBar
            filter={jFilter}
            onFilter={setJFilter}
            rows={DIMENSION_ORDER.flatMap((c) => form.sections[c].rows)}
          />

          {DIMENSION_ORDER.map((code) => {
            const dim = DIMENSIONS[code];
            const sec = form.sections[code];
            const match = (r) =>
              jFilter === '全部'
                ? true
                : jFilter === '待核实'
                  ? !String(r.meetingNote || '').trim()
                  : r.judgment === jFilter;
            const mainRows = sec.rows.filter((r) => !r.supplementTable && match(r));
            const suppRows = sec.rows.filter((r) => r.supplementTable && match(r));
            if (mainRows.length === 0 && suppRows.length === 0) return null;
            return (
              <section key={code} id={`e4-dim-${code}`} data-dim={code} className="e4-dim-block">
                <header className="e4-dim-header">
                  <span className="e4-dim-no">{dim.no}</span>
                  <div>
                    <h3>{dim.title}</h3>
                    <p>{dim.en}</p>
                  </div>
                  <DimStats rows={sec.rows} />
                </header>
                {dim.coreQuestion && <p className="e4-dim-core-q">{dim.coreQuestion}</p>}
                {dim.intro && <p className="e4-dim-intro">{dim.intro}</p>}

                <div className="e4-row-list">
                  {mainRows.map((r) => (
                    <MatrixRow
                      key={r.rowId}
                      row={r}
                      dim={code}
                      open={!!openRows[r.rowId]}
                      onToggle={() => toggleRow(r.rowId)}
                      onActive={setActiveRowId}
                      onChange={(key, val) => updateRow(code, r.rowId, key, val)}
                      onAi={(row) => handleRowAi(code, row)}
                      aiBusy={aiCellRowId === r.rowId}
                    />
                  ))}
                </div>

                {suppRows.length > 0 && (
                  <div className="e4-supplement">
                    <h4>{code === 'E2' ? '会议补充确认' : '会议补充确认（现实行为）'}</h4>
                    <div className="e4-row-list">
                      {suppRows.map((r) => (
                        <MatrixRow
                          key={r.rowId}
                          row={r}
                          dim={code}
                          supplement
                          open={!!openRows[r.rowId]}
                          onToggle={() => toggleRow(r.rowId)}
                          onActive={setActiveRowId}
                          onChange={(key, val) => updateRow(code, r.rowId, key, val)}
                          onAi={(row) => handleRowAi(code, row)}
                          aiBusy={aiCellRowId === r.rowId}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="e4-narrative-grid">
                  {dim.narratives.map((n) => (
                    <label key={n.key} className="e4-field">
                      <span>{n.label}</span>
                      <textarea
                        rows={3}
                        value={sec.narratives[n.key] || ''}
                        onChange={(e) => updateNarrative(code, n.key, e.target.value)}
                        placeholder={`填写${n.label}…`}
                      />
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
            </div>
          </div>

          <div className="e4-step-actions">
            <button type="button" className="e4-btn-ghost" onClick={() => setStep('meta')}>上一步</button>
            <button type="button" className="e4-btn-primary" onClick={() => setStep('judgment')}>
              下一步：综合判断
            </button>
          </div>
      </div>

      {/* ---- 步骤 3：综合判断 ---- */}
      {step === 'judgment' && (
        <div className="e4-step-panel">
          <h2 className="e4-section-title">第 07 页 · 综合判断</h2>
          <p className="e4-step-hint">
            请从会议纪要中摘选家长与学生的原话；已确认的关键问题按四个维度自动汇总，可修改或移除；
            问题解决方案与下次复盘由你填写。
          </p>

          <div className="e4-s07-block">
            <h3>双方原话</h3>
            <label className="e4-field">
              <span>家庭最初反映</span>
              <textarea
                rows={3}
                value={form.section07.familyQuote}
                onChange={(e) => updateS07({ familyQuote: e.target.value })}
                placeholder="从纪要中摘选家长最初反映的问题，例如：孩子理解能力不差，但写作业经常拖…"
              />
            </label>
            <label className="e4-field">
              <span>学生自己的理解</span>
              <textarea
                rows={3}
                value={form.section07.studentQuote}
                onChange={(e) => updateS07({ studentQuote: e.target.value })}
                placeholder="从纪要中摘选学生自己的说法…"
              />
            </label>
          </div>

          <div className="e4-s07-block">
            <h3>已确认的关键问题{confirmed.length > 0 && ` · ${confirmed.length} 个维度`}</h3>
            {confirmed.length === 0 ? (
              <p className="e4-card-hint">
                目前没有被标记为「已确认问题」的排查项。可在矩阵步骤把有会议证据的项目改为「已确认问题」。
              </p>
            ) : (
              <div className="e4-issue-list">
                {confirmed.map((issue) => {
                  const overrides = form.section07.issueOverrides || {};
                  if (overrides[issue.dimension] === null) return null;
                  const text = overrides[issue.dimension] !== undefined ? overrides[issue.dimension] : issue.text;
                  return (
                    <div key={issue.dimension} className="e4-issue-row">
                      <span className="e4-issue-dim">{DIMENSIONS[issue.dimension].short}</span>
                      <textarea
                        rows={2}
                        value={text}
                        onChange={(e) => setIssueOverride(issue.dimension, e.target.value)}
                      />
                      <button type="button" className="e4-btn-mini e4-btn-danger" onClick={() => hideIssue(issue.dimension)}>
                        移除
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="e4-s07-block">
            <h3>问题解决方案</h3>
            <div className="e4-solution-list">
              {form.section07.solutions.map((sol, idx) => (
                <div key={idx} className="e4-solution-row">
                  <input
                    placeholder="成长方向"
                    value={sol.direction}
                    onChange={(e) => {
                      const next = [...form.section07.solutions];
                      next[idx] = { ...next[idx], direction: e.target.value };
                      updateS07({ solutions: next });
                    }}
                  />
                  <textarea
                    rows={2}
                    placeholder="简要安排"
                    value={sol.arrangement}
                    onChange={(e) => {
                      const next = [...form.section07.solutions];
                      next[idx] = { ...next[idx], arrangement: e.target.value };
                      updateS07({ solutions: next });
                    }}
                  />
                  <button
                    type="button"
                    className="e4-btn-mini e4-btn-danger"
                    onClick={() => updateS07({ solutions: form.section07.solutions.filter((_, j) => j !== idx) })}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="e4-btn-mini"
              onClick={() => updateS07({ solutions: [...form.section07.solutions, { direction: '', arrangement: '' }] })}
            >
              + 增加一行
            </button>
          </div>

          <div className="e4-s07-block">
            <h3>下次复盘</h3>
            <div className="e4-form-grid">
              <label className="e4-field">
                <span>时间（必填）</span>
                <input
                  type="date"
                  value={form.section07.nextReviewDate}
                  onChange={(e) => updateS07({ nextReviewDate: e.target.value })}
                />
              </label>
              <label className="e4-field e4-field-full">
                <span>重点验证（必填）</span>
                <textarea
                  rows={2}
                  value={form.section07.nextReviewFocus}
                  onChange={(e) => updateS07({ nextReviewFocus: e.target.value })}
                  placeholder="例如：减少提醒后能否自主启动；手机造成的中断是否减少…"
                />
              </label>
            </div>
          </div>

          <div className="e4-step-actions">
            <button type="button" className="e4-btn-ghost" onClick={() => setStep('matrix')}>上一步</button>
            <button type="button" className="e4-btn-primary" onClick={() => setStep('finish')}>
              下一步：预览
            </button>
          </div>
        </div>
      )}

      {/* ---- 步骤 4：完成 ---- */}
      {step === 'finish' && (
        <div className="e4-step-panel">
          <h2 className="e4-section-title">完成并导出</h2>
          <p className="e4-step-hint">导出前检查以下必填信息；点击任意一项可直接跳回对应步骤补全。</p>

          <div className="e4-finish-checks">
            {finishChecks.map((c) => (
              <button
                key={c.label}
                type="button"
                className={`e4-finish-check ${c.done ? 'is-done' : 'is-todo'}`}
                onClick={() => setStep(c.goto)}
              >
                <span className="e4-check-ico">
                  {c.done ? (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                  )}
                </span>
                <span className="e4-check-label">{c.label}</span>
                {!c.done && (
                  <span className="e4-check-arrow">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>

          {missingRequired.length > 0 ? (
            <div className="e4-inline-error">
              还差 {missingRequired.length} 项：{missingRequired.join('、')}
            </div>
          ) : (
            <p className="e4-finish-all-done">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              必填信息已齐全。下方就是最终排版，点击任意文字可直接修改；改完点「预览 / 下载 PDF」导出。
            </p>
          )}

          {/* 最终文档：与 PDF 同版式，点哪改哪；编辑只在屏内出现，打印样式不受影响 */}
          <div className="e4-finish-doc-wrap">
            <FirstReportPrint
              editable
              report={{ ...report, meeting_date: meetingDate, report_date: reportDate, form_data: form }}
              onPatch={handleDocPatch}
              onTableOp={handleTableOp}
              aiFor={aiForDoc}
            />
          </div>

          <div className="e4-finish-actions">
            <button type="button" className="e4-btn-ghost" onClick={() => setStep('judgment')}>返回修改</button>
            <button type="button" className="e4-btn-ghost" onClick={openPrint}>预览 / 下载 PDF</button>
            <button type="button" className="e4-btn-primary" disabled={finalizing || missingRequired.length > 0} onClick={markFinal}>
              {finalizing ? '处理中…' : report.status === 'final' ? '已为最终版（仍可更新）' : '标记为最终版'}
            </button>
          </div>
        </div>
      )}

      {/* 纪要常驻侧栏（宽屏 dock；窄屏退回抽屉）。与矩阵当前焦点行联动，证据高亮见 AI 区域助手 */}
      {minutesOpen && (
        <MinutesDock
          minutes={minutes}
          activeLabel={activeRowLabel}
          evidence={evidence}
          onClose={() => setMinutesOpen(false)}
        />
      )}

      <PrintPreviewModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        title={`${form.cover?.studentName || '学生'} · 首次学习力分析报告`}
        badge={report.status === 'final' ? <span className="e4-status-badge e4-status-final">最终版</span> : null}
      >
        <FirstReportPrint report={{ ...report, meeting_date: meetingDate, report_date: reportDate, form_data: form }} />
      </PrintPreviewModal>

      <ConfirmDialog
        open={rebuildOpen}
        title="从协议重建草稿"
        message="将按最新模板从 E4 协议重新生成全部排查项与 Y4 线索，当前所有手动修改（含会议佐证、综合判断、叙述）都会被覆盖。确定继续？"
        confirmLabel="重建"
        variant="danger"
        onConfirm={rebuildFromProtocol}
        onCancel={() => setRebuildOpen(false)}
      />
    </div>
  );
}

// 把证据原文片段在纪要中定位成不重叠区间，用于高亮
function buildEvidenceRanges(minutes, evidence) {
  const ranges = [];
  for (const raw of evidence || []) {
    const needle = String(raw || '').trim();
    if (needle.length < 4) continue;
    // 优先整句；失败则逐步缩短重试
    let idx = -1;
    let hit = needle;
    if (minutes.indexOf(hit) === -1) {
      for (let len = Math.min(24, needle.length - 2); len >= 6; len -= 2) {
        hit = needle.slice(0, len);
        idx = minutes.indexOf(hit);
        if (idx !== -1) break;
      }
    } else {
      idx = minutes.indexOf(hit);
    }
    if (idx === -1) continue;
    const end = idx + hit.length;
    if (!ranges.some(([s, e]) => idx < e && end > s)) ranges.push([idx, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

// 会议纪要常驻侧栏：宽屏右侧 dock，窄屏退回全屏抽屉；可高亮 AI 证据片段
function MinutesDock({ minutes, activeLabel, evidence = [], onClose }) {
  const ranges = useMemo(() => buildEvidenceRanges(minutes || '', evidence), [minutes, evidence]);
  const segments = useMemo(() => {
    if (!minutes || ranges.length === 0) return null;
    const out = [];
    let cursor = 0;
    ranges.forEach(([s, e], i) => {
      if (s < cursor) return;
      if (s > cursor) out.push({ text: minutes.slice(cursor, s), mark: false, key: `t${i}` });
      out.push({ text: minutes.slice(s, e), mark: true, key: `m${i}` });
      cursor = e;
    });
    if (cursor < minutes.length) out.push({ text: minutes.slice(cursor), mark: false, key: 'tend' });
    return out;
  }, [minutes, ranges]);

  return (
    <>
      <div className="e4-minutes-scrim no-print" onClick={onClose} aria-hidden="true" />
      <aside className="e4-minutes-dock no-print" aria-label="首次会议纪要">
        <div className="e4-minutes-dock-head">
          <div>
            <h3>首次会议纪要</h3>
            {activeLabel && <p className="e4-minutes-active-row">当前排查项 · {activeLabel}</p>}
            {ranges.length > 0 && <p className="e4-minutes-evidence-row">已高亮 AI 引用的纪要原文（{ranges.length} 处）</p>}
          </div>
          <button type="button" className="e4-modal-close" onClick={onClose} aria-label="收起纪要">×</button>
        </div>
        <pre className="e4-minutes-dock-text">
          {segments
            ? segments.map((seg) => (seg.mark ? <mark key={seg.key}>{seg.text}</mark> : seg.text))
            : (minutes || '（尚未粘贴纪要）')}
        </pre>
      </aside>
    </>
  );
}

// 判断状态 → 色调（浅底深字，避免大面积实色）
const JUDGMENT_TONE = {
  已确认问题: 'red',
  可能存在: 'amber',
  暂未发现: 'green',
  信息不足: 'blue',
};

function MatrixFilterBar({ filter, onFilter, rows }) {
  const counts = { 全部: rows.length, 待核实: 0 };
  rows.forEach((r) => {
    counts[r.judgment] = (counts[r.judgment] || 0) + 1;
    if (!String(r.meetingNote || '').trim()) counts.待核实 += 1;
  });
  const chips = ['全部', ...JUDGMENT_STATES, '待核实'];
  return (
    <div className="e4-jfilter-bar">
      {chips.map((c) => (
        <button
          key={c}
          type="button"
          className={`e4-jchip tone-${JUDGMENT_TONE[c] || 'neutral'} ${filter === c ? 'active' : ''}`}
          onClick={() => onFilter(c)}
        >
          {c}
          <span className="e4-jchip-count">{counts[c] || 0}</span>
        </button>
      ))}
    </div>
  );
}

function DimStats({ rows }) {
  const done = rows.filter((r) => String(r.meetingNote || '').trim()).length;
  const confirmed = rows.filter((r) => r.judgment === '已确认问题').length;
  const flagged = rows.filter((r) => r.judgment === '可能存在').length;
  return (
    <div className="e4-dim-stats">
      <span className="e4-dim-stat">{done}/{rows.length} 已核实</span>
      {confirmed > 0 && <span className="e4-dim-stat tone-red">确认 {confirmed}</span>}
      {flagged > 0 && <span className="e4-dim-stat tone-amber">待确认 {flagged}</span>}
    </div>
  );
}

// 桌面端粘性维度导航：点击平滑滚动，IntersectionObserver 跟踪当前维度
function DimensionRail({ sections, filter }) {
  const [active, setActive] = useState(DIMENSION_ORDER[0]);

  useEffect(() => {
    const els = DIMENSION_ORDER
      .map((c) => document.getElementById(`e4-dim-${c}`))
      .filter(Boolean);
    if (els.length === 0) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.dataset.dim);
      },
      { rootMargin: '-16% 0px -68% 0px', threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [filter]);

  const allRows = DIMENSION_ORDER.flatMap((c) => sections[c].rows);
  const doneTotal = allRows.filter((r) => String(r.meetingNote || '').trim()).length;

  const isFilteredOut = (code) => {
    if (filter === '全部') return false;
    return !sections[code].rows.some((r) =>
      filter === '待核实' ? !String(r.meetingNote || '').trim() : r.judgment === filter
    );
  };

  function scrollTo(code) {
    document.getElementById(`e4-dim-${code}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <aside className="e4-dim-rail">
      <div className="e4-dim-rail-head">
        <span>四个维度</span>
        <strong>{doneTotal}/{allRows.length}</strong>
      </div>
      {DIMENSION_ORDER.map((code) => {
        const dim = DIMENSIONS[code];
        const rows = sections[code].rows;
        const done = rows.filter((r) => String(r.meetingNote || '').trim()).length;
        const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
        const filteredOut = isFilteredOut(code);
        return (
          <button
            key={code}
            type="button"
            className={`e4-dim-rail-item ${active === code ? 'active' : ''} ${filteredOut ? 'is-dimmed' : ''}`}
            onClick={() => scrollTo(code)}
          >
            <span className="e4-dim-rail-no">{dim.no}</span>
            <span className="e4-dim-rail-main">
              <span className="e4-dim-rail-row">
                <span className="e4-dim-rail-name">{dim.short}</span>
                <span className="e4-dim-rail-count">{done}/{rows.length}</span>
              </span>
              <span className="e4-dim-rail-track" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}

// 随内容自动增高的 textarea（用 auto-grow 而非 contentEditable，避免光标跳动与 HTML 注入）
function AutoTextarea({ value, onChange, minRows = 2, ...rest }) {
  const ref = useRef(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => { resize(); }, [value, resize]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className="e4-autosize"
      value={value}
      onChange={(e) => { onChange?.(e); requestAnimationFrame(resize); }}
      {...rest}
    />
  );
}

function MatrixRow({ row, dim, supplement, open, onToggle, onActive, onChange, onAi, aiBusy }) {
  const [showHint, setShowHint] = useState(false);
  const tone = JUDGMENT_TONE[row.judgment] || 'neutral';
  const note = String(row.meetingNote || '').trim();
  const clue = String(row.y4Clue || '').trim();
  const pending = note ? 'false' : 'true';

  return (
    <div
      className={`e4-matrix-row tone-rail-${tone} ${open ? 'is-open' : ''} ${supplement ? 'is-supplement' : ''}`}
      data-dim={dim}
      data-rowid={row.rowId}
      data-pending={pending}
    >
      <div
        className="e4-matrix-row-head"
        onClick={onToggle}
        onFocus={() => onActive?.(row.rowId)}
        role="button"
        tabIndex={0}
        title="↑↓ 换行 · 1–4 快速判断 · Enter 展开 · J 下一条待核实"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onToggle?.();
          }
        }}
      >
        <span className="e4-matrix-label">{row.label}</span>
        {!open && <span className={`e4-matrix-note-preview ${note ? '' : 'is-empty'}`}>
          {note || '待核实 — 点击填写会议事件'}
        </span>}
        <span className={`e4-matrix-chevron ${open ? 'up' : ''}`} aria-hidden>▾</span>
      </div>

      <div className="e4-matrix-judgment" onClick={(e) => e.stopPropagation()}>
        {JUDGMENT_STATES.map((s, idx) => (
          <button
            key={s}
            type="button"
            className={`e4-jpill tone-${JUDGMENT_TONE[s]} ${row.judgment === s ? 'active' : ''}`}
            onClick={() => onChange('judgment', s)}
            title={`快捷键 ${idx + 1}`}
          >
            <kbd className="e4-jpill-key">{idx + 1}</kbd>
            {s}
          </button>
        ))}
        {row.protocolHint && (
          <button type="button" className="e4-hint-toggle" onClick={() => setShowHint((v) => !v)}>
            协议参考
          </button>
        )}
      </div>

      {showHint && row.protocolHint && <p className="e4-protocol-hint">{row.protocolHint}</p>}

      <div className={`e4-matrix-cells-wrap ${open ? 'is-open' : ''}`}>
        <div className="e4-matrix-cells">
          {!supplement && (
            <label className="e4-cell">
              <span>Y4 初步线索</span>
              <AutoTextarea
                minRows={2}
                value={row.y4Clue}
                onChange={(e) => onChange('y4Clue', e.target.value)}
                placeholder="协议未提供线索"
                tabIndex={open ? 0 : -1}
              />
            </label>
          )}
          <label className="e4-cell">
            <span>
              {supplement ? '访谈与现实表现' : '会议核实情况'}
              {onAi && (
                <button
                  type="button"
                  className="e4-cell-ai-btn"
                  disabled={aiBusy}
                  onClick={() => onAi(row)}
                  title="基于会议纪要单独生成这一项"
                >
                  {aiBusy ? 'AI 生成中…' : 'AI 补这一项'}
                </button>
              )}
            </span>
            <AutoTextarea
              minRows={2}
              value={row.meetingNote}
              onChange={(e) => onChange('meetingNote', e.target.value)}
              placeholder="对照会议纪要填写具体事件"
              tabIndex={open ? 0 : -1}
            />
          </label>
        </div>
      </div>

      {!open && clue && !supplement && <p className="e4-matrix-clue-preview">{clue}</p>}
    </div>
  );
}

export default function E4ReportBuilderPage() {
  const { studentId, reportId } = useParams();
  if (reportId) return <BuildFlow key={reportId} reportId={reportId} />;
  return <NewFirstFlow studentId={studentId} />;
}
