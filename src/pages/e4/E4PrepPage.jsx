import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getE4Student, getReport, listReportsForStudent, createPrepReport, updateReport,
  uploadGrowthMap, growthMapUrl, removeGrowthMap,
} from '../../lib/e4Store.js';
import { fetchProtocol, Y4ApiError } from '../../lib/y4api.js';
import { parseE4Protocol } from '../../lib/e4ProtocolParser.js';
import {
  PREP_DIMENSIONS, PREP_DIMENSION_ORDER, VERDICT_DOT, buildPrepDraft,
} from '../../lib/e4PrepTemplate.js';
import { useAuth } from '../../lib/useAuth.js';
import { toast } from '../../lib/toast.js';
import { useMergedAutosave } from '../../lib/useAutosave.js';
import { prefillPrepSubjects } from '../../lib/llm.js';
import PrepPrint from '../../components/e4/PrepPrint.jsx';
import PrintPreviewModal from '../../components/e4/PrintPreviewModal.jsx';

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
// 路由 A：/e4/students/:studentId/new-prep —— 拉取协议并生成会前准备
// ----------------------------------------------------------------
function NewPrepFlow({ studentId }) {
  const nav = useNavigate();
  const { profile } = useAuth();
  const [student, setStudent] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | fetching | error
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState(0);
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
    setErrorStatus(0);
    try {
      const md = await fetchProtocol(student.y4_report_id, { signal: controller.signal });
      const draft = buildPrepDraft(parseE4Protocol(md), student);
      const report = await createPrepReport({
        e4StudentId: student.id,
        createdBy: profile.id,
        protocolMd: md,
        formData: draft,
      });
      toast('会前准备已生成，VERDICT 原文已自动录入', { kind: 'success' });
      nav(`/e4/prep/${report.id}`, { replace: true });
    } catch (err) {
      if (err.name === 'AbortError') {
        setPhase('idle');
        return;
      }
      setError(err instanceof Y4ApiError ? err.message : `拉取 E4 协议失败：${err.message}`);
      setErrorStatus(err instanceof Y4ApiError ? err.status : 0);
      setPhase('error');
    }
  }

  return (
    <div className="e4-page">
      <button type="button" className="e4-back-link" onClick={() => nav(`/e4/students/${studentId}`)}>
        返回学生页面
      </button>
      <div className="e4-fetch-card">
        <h1 className="e4-page-title">生成首次学习力会议会前准备</h1>
        <p className="e4-page-subtitle">
          {student?.display_name || '该学生'} · Y4 报告 #{student?.y4_report_id || '—'}
        </p>
        {student?.y4_report_id && (
          <p className="e4-card-hint">
            已关联 Y4 报告 #{student.y4_report_id}
            {student.y4_report_date ? `（测评日期 ${student.y4_report_date}）` : ''}
            ，将基于它生成 E4 协议；如需更换请返回学生页面。
          </p>
        )}
        {!student?.y4_report_id && (
          <div className="e4-inline-error">该学生尚未关联 Y4 报告，请先返回学生页面完成关联。</div>
        )}
        <div className="e4-fetch-body">
          <p>
            点击后将实时调用 Y4 AI 生成该学生的 <strong>E4 评估协议</strong>，通常需要 10–30 秒。
            协议中的 VERDICT 原文会自动录入 E1–E4 确认准备表，学科线索可在工作台中一键 AI 预填。
          </p>
          {phase === 'fetching' && (
            <div className="e4-fetch-progress">
              <div className="e4-spinner" />
              <span>正在生成 E4 协议，请稍候，期间不要关闭页面…</span>
            </div>
          )}
          {error && <div className="e4-inline-error">{error}</div>}
          {errorStatus === 404 && (
            <p className="e4-card-hint">
              该 Y4 报告在上游已不存在（可能被清理或重新生成过），请返回学生页面更换关联后再试。
            </p>
          )}
        </div>
        <div className="e4-fetch-actions">
          <button type="button" className="e4-btn-ghost" onClick={() => nav(`/e4/students/${studentId}`)}>
            {errorStatus === 404 ? '更换关联' : '取消'}
          </button>
          {phase === 'fetching' ? (
            <button type="button" className="e4-btn-ghost" onClick={() => abortRef.current?.abort()}>
              取消拉取
            </button>
          ) : (
            <button type="button" className="e4-btn-primary" disabled={!student?.y4_report_id} onClick={start}>
              生成会前准备
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// 路由 B：/e4/prep/:reportId —— 两栏会议工作台
// 左：A4 预览（可编辑） 右：确认清单（边问边勾选 + 速记）+ 纪要 + 成长地图
// ----------------------------------------------------------------
function PrepWorkbench({ reportId }) {
  const nav = useNavigate();
  const [report, setReport] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [growthMapBusy, setGrowthMapBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const panelRef = useRef(null);
  const fileRef = useRef(null);

  // 最终版锁定（与其他 E4 工作台同策略；会前准备当前不提供定稿入口，防御性支持）
  const locked = report?.status === 'final';
  const { saveState, savedAt, persist } = useMergedAutosave(
    useCallback((patch) => updateReport(reportId, patch), [reportId])
  );

  useEffect(() => {
    getReport(reportId)
      .then((r) => {
        if (!r) {
          setLoadError('未找到该会前准备');
          return;
        }
        if (r.report_type !== 'prep' || !r.form_data?.prepRows) {
          setLoadError('该记录不是会前准备，或内容尚未生成');
          return;
        }
        setReport(r);
        setForm(r.form_data);
        setMinutes(r.minutes_text || '');
      })
      .catch((e) => setLoadError(e.message));
  }, [reportId]);

  useEffect(() => {
    if (!form || locked) return;
    persist({ form_data: form });
  }, [form, persist, locked]);

  useEffect(() => {
    if (!report || locked) return;
    persist({ minutes_text: minutes });
  }, [minutes, report, persist, locked]);

  // 可编辑区域的统一写入口（PrepPrint 的 desc 协议）
  const updateField = useCallback((desc, value) => {
    setForm((f) => {
      const next = structuredClone(f);
      if (desc.area === 'prepCover') {
        next.prepCover[desc.key] = value;
      } else if (desc.area === 'attendee') {
        next.prepCover.attendees = { ...(next.prepCover.attendees || {}), [desc.key]: value };
      } else if (desc.area === 'source') {
        const s = next.sources.find((x) => x.key === desc.key);
        if (s) s[desc.field] = value;
      } else if (desc.area === 'subject') {
        next.subjects[desc.index][desc.field] = value;
      } else if (desc.area === 'row') {
        const r = next.prepRows[desc.dim]?.find((x) => x.rowId === desc.rowId);
        if (r) r[desc.field] = value;
      } else if (desc.area === 'moduleJudgment') {
        next.moduleJudgments = next.moduleJudgments || {};
        next.moduleJudgments[desc.dim] = { ...(next.moduleJudgments[desc.dim] || {}), [desc.field]: value };
      }
      return next;
    });
  }, []);

  const onTableOp = useCallback((op, payload) => {
    setForm((f) => {
      const next = structuredClone(f);
      if (op === 'addSubject' && next.subjects.length < 10) {
        next.subjects.push({ subject: '', clues: '', types: [], followUp: '' });
      } else if (op === 'delSubject' && next.subjects.length > 1) {
        next.subjects.splice(payload.index, 1);
      }
      return next;
    });
  }, []);

  const { totalRows, checkedRows } = useMemo(() => {
    let total = 0;
    let checked = 0;
    for (const code of PREP_DIMENSION_ORDER) {
      (form?.prepRows?.[code] || []).forEach((r) => {
        total += 1;
        if (r.checked) checked += 1;
      });
    }
    return { totalRows: total, checkedRows: checked };
  }, [form]);

  // AI 预填学科线索：保留导师已手填的行，AI 行追加在后
  async function handlePrefillSubjects() {
    if (!report?.protocol_md) {
      toast('该会前准备没有协议快照，无法 AI 预填', { kind: 'error' });
      return;
    }
    setAiBusy(true);
    try {
      const aiRows = await prefillPrepSubjects({
        protocolMd: report.protocol_md,
        studentName: form?.prepCover?.studentName || '',
      });
      if (!aiRows.length) {
        toast('协议中未提取到学科线索，请手动填写', { kind: 'info' });
        return;
      }
      setForm((f) => {
        const next = structuredClone(f);
        const manual = (next.subjects || []).filter((s) => String(s.subject || '').trim());
        const merged = [...manual, ...aiRows].slice(0, 10);
        while (merged.length < 6) merged.push({ subject: '', clues: '', types: [], followUp: '' });
        next.subjects = merged;
        return next;
      });
      toast(`已预填 ${aiRows.length} 条学科线索`, { kind: 'success' });
    } catch (e) {
      toast(e.message, { kind: 'error' });
    } finally {
      setAiBusy(false);
    }
  }

  // 成长地图 PDF：上传到私有 Storage（migrations/006），form_data 只存 path + 文件名
  async function handleGrowthMapFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      toast('请上传 PDF 文件', { kind: 'error' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast('文件过大（上限 20MB）', { kind: 'error' });
      return;
    }
    setGrowthMapBusy(true);
    try {
      const path = await uploadGrowthMap({
        e4StudentId: report.e4_student_id,
        reportId: report.id,
        file,
      });
      setForm((f) => ({
        ...f,
        growthMap: { fileName: file.name, path, uploadedAt: new Date().toISOString() },
      }));
      toast('成长地图已上传', { kind: 'success' });
    } catch (err) {
      toast(err.message || '上传失败，请重试', { kind: 'error' });
    } finally {
      setGrowthMapBusy(false);
    }
  }

  // 预览 / 下载：现场生成短时签名链接
  async function openGrowthMap(download = false) {
    const gm = form?.growthMap;
    if (!gm?.path) {
      toast('该文件只有引用信息（未上传到存储），请重新上传', { kind: 'info' });
      return;
    }
    try {
      const url = await growthMapUrl(gm.path, { download, fileName: gm.fileName });
      if (!url) throw new Error('未能生成链接');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast(err.message || '打开失败，请重试', { kind: 'error' });
    }
  }

  async function clearGrowthMap() {
    const gm = form?.growthMap;
    setForm((f) => ({ ...f, growthMap: null }));
    if (gm?.path) {
      try {
        await removeGrowthMap(gm.path);
      } catch {
        toast('已从报告移除，但存储文件删除失败，请稍后在存储中清理', { kind: 'error' });
      }
    }
  }

  // 确认清单键盘流：↑↓ 移动焦点，空格勾选，Enter 进入速记，J 下一条未勾选
  const onPanelKeyDown = useCallback((e) => {
    const head = e.target.closest?.('.e4-prep-row-head');
    const panel = panelRef.current;
    if (!head || !panel) return;
    const heads = Array.from(panel.querySelectorAll('.e4-prep-row-head'));
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
    if (e.key === ' ') {
      e.preventDefault();
      const { dim, rowid } = head.closest('.e4-prep-row')?.dataset || {};
      const row = form?.prepRows?.[dim]?.find((r) => r.rowId === rowid);
      if (row) updateField({ area: 'row', dim, rowId: rowid, field: 'checked' }, !row.checked);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      head.closest('.e4-prep-row')?.querySelector('.e4-prep-row-note input')?.focus();
      return;
    }
    if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      const rows = Array.from(panel.querySelectorAll('.e4-prep-row[data-unchecked="true"]'));
      if (!rows.length) {
        toast('所有排查项都已勾选', { kind: 'success' });
        return;
      }
      const after = rows.find((r) => heads.indexOf(r.querySelector('.e4-prep-row-head')) > i);
      const target = after || rows[0];
      const targetHead = target.querySelector('.e4-prep-row-head');
      targetHead.focus();
      targetHead.scrollIntoView({ block: 'center' });
    }
  }, [form, updateField]);

  if (loadError) {
    return (
      <div className="e4-page">
        <div className="e4-inline-error">{loadError}</div>
      </div>
    );
  }
  if (!form || !report) {
    return (
      <div className="e4-page" aria-busy="true" aria-label="加载会前准备">
        <span className="e4-skeleton" style={{ width: 92, height: 12 }} />
        <span className="e4-skeleton" style={{ width: '100%', maxWidth: 520, height: 44, borderRadius: 10, marginTop: 16 }} />
        <span className="e4-skeleton" style={{ width: '100%', height: 160, borderRadius: 10, marginTop: 20 }} />
      </div>
    );
  }

  const studentName = form.prepCover?.studentName || '学生';

  return (
    <div className="e4-page e4-prep-page">
      {/* 吸顶 command bar */}
      <div className="e4-command-bar">
        <div className="e4-command-left">
          <button type="button" className="e4-back-link" onClick={() => nav(`/e4/students/${report.e4_student_id}`)}>
            返回学生页面
          </button>
          <span className="e4-prep-title">会前准备 · {studentName}</span>
        </div>
        <div className="e4-command-right">
          {totalRows - checkedRows > 0 && (
            <span className="e4-pending-pill" title="尚未勾选为重点的排查项">
              <i />待确认 {totalRows - checkedRows}
            </span>
          )}
          <button
            type="button"
            className="e4-btn-mini e4-ai-gen-btn"
            onClick={handlePrefillSubjects}
            disabled={aiBusy}
            title="按 Y4 协议自动预填学科线索与重点排序"
          >
            {aiBusy ? 'AI 生成中…' : 'AI 预填学科线索'}
          </button>
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

      <div className="e4-prep-workbench">
        {/* 左栏：A4 预览（可编辑） */}
        <div className="e4-prep-preview">
          <ScaledDoc>
            <PrepPrint report={{ ...report, form_data: form }} editable={!locked} onPatch={updateField} onTableOp={onTableOp} />
          </ScaledDoc>
        </div>

        {/* 右栏：会议确认清单 */}
        <aside className="e4-prep-panel" ref={panelRef} onKeyDown={onPanelKeyDown}>
          <div className="e4-prep-panel-head">
            <h2>会议确认清单</h2>
            <span className="e4-prep-panel-progress">{checkedRows} / {totalRows} 已勾选</span>
          </div>
          <p className="e4-prep-panel-hint">
            会议中边问边勾选；空格勾选，Enter 速记，J 跳到下一条未确认。
          </p>

          <div className="e4-prep-panel-nav">
            {PREP_DIMENSION_ORDER.map((code) => {
              const rows = form.prepRows?.[code] || [];
              const done = rows.filter((r) => r.checked).length;
              return (
                <button
                  key={code}
                  type="button"
                  className={`e4-prep-nav-chip tint-${PREP_DIMENSIONS[code].tint}`}
                  onClick={() => panelRef.current?.querySelector(`#prep-dim-${code}`)?.scrollIntoView({ block: 'start' })}
                >
                  {PREP_DIMENSIONS[code].short}
                  <span>{done}/{rows.length}</span>
                </button>
              );
            })}
          </div>

          <div className="e4-prep-panel-scroll">
            {PREP_DIMENSION_ORDER.map((code) => {
              const dim = PREP_DIMENSIONS[code];
              const rows = form.prepRows?.[code] || [];
              return (
                <section key={code} id={`prep-dim-${code}`} className="e4-prep-dim">
                  <h3 className={`e4-prep-dim-title tint-${dim.tint}`}>{dim.title}</h3>
                  {rows.map((r) => (
                    <div
                      key={r.rowId}
                      className={`e4-prep-row ${r.checked ? 'is-checked' : ''}`}
                      data-dim={code}
                      data-rowid={r.rowId}
                      data-unchecked={r.checked ? 'false' : 'true'}
                    >
                      <div
                        className="e4-prep-row-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => updateField({ area: 'row', dim: code, rowId: r.rowId, field: 'checked' }, !r.checked)}
                      >
                        <span className={`e4-prep-check ${r.checked ? 'is-on' : ''}`} aria-checked={!!r.checked} />
                        <span className="e4-prep-row-label">{r.label}</span>
                        {r.verdict && (
                          <span className="e4-prep-verdict-tag">
                            <i style={{ background: VERDICT_DOT[r.verdict] || '#8F897B' }} />{r.verdict}
                          </span>
                        )}
                      </div>
                      <p className="e4-prep-row-ask">{r.ask}</p>
                      <div className="e4-prep-row-note">
                        <input
                          type="text"
                          value={r.meetingNote || ''}
                          placeholder="会中速记…"
                          onChange={(e) => updateField({ area: 'row', dim: code, rowId: r.rowId, field: 'meetingNote' }, e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}

            {/* 成长地图上传 */}
            <section className="e4-prep-gmap-card">
              <div className="e4-prep-gmap-head">
                <h3>成长地图（三级象限图 / Growth Talk）</h3>
              </div>
              {form.growthMap?.fileName ? (
                <div className="e4-prep-gmap-file">
                  <span className="e4-prep-gmap-name">{form.growthMap.fileName}</span>
                  <span className="e4-prep-gmap-meta">
                    {form.growthMap.path
                      ? `已上传 · ${new Date(form.growthMap.uploadedAt).toLocaleDateString('zh-CN')}`
                      : `仅引用 · ${new Date(form.growthMap.uploadedAt).toLocaleDateString('zh-CN')}`}
                  </span>
                  {form.growthMap.path ? (
                    <>
                      <button type="button" className="e4-btn-mini" onClick={() => openGrowthMap(false)}>
                        预览
                      </button>
                      <button type="button" className="e4-btn-mini" onClick={() => openGrowthMap(true)}>
                        下载
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="e4-btn-mini" disabled={growthMapBusy} onClick={() => fileRef.current?.click()}>
                    {growthMapBusy ? '上传中…' : '更换文件'}
                  </button>
                  <button type="button" className="e4-btn-mini e4-btn-danger-ghost" onClick={clearGrowthMap}>
                    移除
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="e4-prep-gmap-upload"
                  disabled={growthMapBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {growthMapBusy ? '上传中…' : '上传成长地图 PDF'}
                  <span>文件存入私有存储，仅导师可查看</span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={handleGrowthMapFile}
              />
            </section>

            {/* 会议纪要 */}
            <section className="e4-prep-minutes">
              <h3>会议记录</h3>
              <p className="e4-prep-panel-hint">会议中速记或会后统一粘贴文字记录，自动保存；生成首次报告时可再次使用。</p>
              <textarea
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="粘贴或记录会议中的对话、家长反馈与学生自述…"
                rows={8}
              />
              <span className="e4-prep-minutes-count">{minutes.length} 字</span>
            </section>
          </div>
        </aside>
      </div>

      <PrintPreviewModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        title={`${studentName} · 首次学习力会议会前准备`}
      >
        <PrepPrint report={{ ...report, form_data: form }} />
      </PrintPreviewModal>
    </div>
  );
}

export default function E4PrepPage() {
  const { studentId, reportId } = useParams();
  if (studentId) return <NewPrepFlow studentId={studentId} />;
  return <PrepWorkbench reportId={reportId} />;
}
