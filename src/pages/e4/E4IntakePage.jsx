// Stage 1 快速建档向导：只输名字 → Y4 候选确认（每次都确认）→ 信息与报告确认 → 自动拉协议生成报告。
// 路由：/e4/new
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/useAuth.js';
import { toast } from '../../lib/toast.js';
import { DatePicker } from '@/components/ui/date-picker.jsx';
import { listStudents, listReports, fetchProtocol, Y4ApiError } from '../../lib/y4api.js';
import { createE4Student, createFirstReport } from '../../lib/e4Store.js';
import { parseE4Protocol } from '../../lib/e4ProtocolParser.js';
import { buildReportDraft } from '../../lib/e4ReportTemplate.js';

function IconBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function StepBar({ step }) {
  const items = ['输入名字', '确认档案', '生成协议'];
  return (
    <div className="e4-modal-steps e4-intake-steps">
      {items.map((label, i) => (
        <Fragment key={label}>
          <span className={`e4-modal-step ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}>
            <i>{step > i + 1 ? '✓' : i + 1}</i>{label}
          </span>
          {i < items.length - 1 && <span className="e4-modal-step-line" />}
        </Fragment>
      ))}
    </div>
  );
}

export default function E4IntakePage() {
  const nav = useNavigate();
  const { profile } = useAuth();

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');

  // Y4 候选
  const [candidates, setCandidates] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [chosen, setChosen] = useState(null); // Y4 学生对象
  const [bareMode, setBareMode] = useState(false); // 「以上都不是，仅用名字建档」

  // 报告候选
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportsError, setReportsError] = useState(null); // { message, status } | null：加载失败与「确实没有报告」必须区分

  // 档案信息（可改）
  const [info, setInfo] = useState({ display_name: '', gender: '', grade: '', school: '', next_meeting_type: 'first', next_meeting_date: '' });
  const [creating, setCreating] = useState(false);
  const [createdStudentId, setCreatedStudentId] = useState(null);

  // 协议拉取
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const abortRef = useRef(null);

  // Step 1：debounce 搜索 Y4 候选
  useEffect(() => {
    if (step !== 1) return undefined;
    const q = name.trim();
    if (!q) {
      setCandidates([]);
      setCandidateError('');
      setLoadingCandidates(false);
      return undefined;
    }
    setLoadingCandidates(true);
    setCandidateError('');
    const t = setTimeout(() => {
      listStudents(q)
        .then((all) => setCandidates(all.slice(0, 8)))
        .catch((err) => setCandidateError(err instanceof Y4ApiError ? err.message : 'Y4 学生列表加载失败'))
        .finally(() => setLoadingCandidates(false));
    }, 300);
    return () => clearTimeout(t);
  }, [name, step]);

  const exactMatch = useMemo(() => {
    const q = name.trim().toLowerCase();
    return candidates.find((c) => String(c.name || '').toLowerCase() === q);
  }, [candidates, name]);

  function pickCandidate(c) {
    setChosen(c);
    setBareMode(false);
    setInfo((f) => ({
      // 选中 Y4 学生后以 Y4 里的真实姓名为准（用户可能只输了首字母/别名）
      display_name: c.name || name.trim(),
      gender: c.gender || '',
      grade: c.grade || '',
      school: c.school || '',
      next_meeting_type: f.next_meeting_type,
      next_meeting_date: f.next_meeting_date,
    }));
  }

  function pickBare() {
    setChosen(null);
    setBareMode(true);
    setInfo((f) => ({ ...f, display_name: name.trim() }));
  }

  function goStep2() {
    if (bareMode) {
      setStep(2);
      return;
    }
    if (!chosen) {
      toast('请选择一位 Y4 学生，或点「仅用名字建档」', { kind: 'error' });
      return;
    }
    setStep(2);
    loadReports(chosen.id);
  }

  // 拉取某位 Y4 学生的报告列表。
  // 注意：必须把「请求失败」与「确实没有报告」分开——
  // 失败时若只显示「暂无报告」，会让人误以为学生没有报告（上游偶发抖动时尤其误导）。
  function loadReports(y4StudentId) {
    if (!y4StudentId) return;
    setLoadingReports(true);
    setReportsError(null);
    setReports([]);
    setSelectedReport(null);
    listReports(y4StudentId)
      .then((rs) => {
        setReports(rs);
        setSelectedReport(rs[0]?.id ?? null); // 接口按创建时间倒序，最新在前
      })
      .catch((err) => {
        const message = err instanceof Y4ApiError ? err.message : 'Y4 报告列表加载失败';
        // 记下状态码：报障时能区分「上游 404（关联失效）」与「502/超时（上游抖动）」
        setReportsError({ message, status: err instanceof Y4ApiError ? err.status : 0 });
        toast(message, { kind: 'error' });
      })
      .finally(() => setLoadingReports(false));
  }

  // Step 2：建档案 → 自动拉协议 → 建报告
  function studentPayload(displayName, y4 = {}) {
    return {
      display_name: displayName,
      gender: info.gender || null,
      grade: info.grade.trim() || null,
      school: info.school.trim() || null,
      advisor_id: profile.id,
      created_by: profile.id,
      next_meeting_type: info.next_meeting_type,
      next_meeting_date: info.next_meeting_date || null,
      ...y4,
    };
  }

  async function confirmAndGenerate() {
    const displayName = info.display_name.trim();
    if (!displayName) {
      toast('学生姓名不能为空', { kind: 'error' });
      return;
    }
    if (chosen && !selectedReport) {
      toast('请选择一份 Y4 报告', { kind: 'error' });
      return;
    }
    setCreating(true);
    try {
      const report = chosen ? reports.find((r) => r.id === selectedReport) : null;
      const student = await createE4Student(
        studentPayload(
          displayName,
          chosen
            ? {
                y4_student_id: chosen.id,
                y4_report_id: report.id,
                y4_student_name: chosen.name,
                y4_report_date: report.report_date || null,
              }
            : {},
        ),
      );
      setCreatedStudentId(student.id);

      // 无 Y4：档案建好即结束，引导去学生页稍后关联
      if (!chosen) {
        toast('E4 学生已创建，关联 Y4 报告后即可生成首次报告', { kind: 'success' });
        nav(`/e4/students/${student.id}`);
        return;
      }

      setStep(3);
      setFetching(true);
      setFetchError('');
      const controller = new AbortController();
      abortRef.current = controller;
      const md = await fetchProtocol(report.id, { signal: controller.signal });
      const draft = buildReportDraft(parseE4Protocol(md));
      const created = await createFirstReport({
        e4StudentId: student.id,
        createdBy: profile.id,
        protocolMd: md,
        formData: draft,
      });
      toast('E4 协议数据已自动提取，开始核对', { kind: 'success' });
      nav(`/e4/reports/${created.id}/build`, { replace: true });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setFetchError(err instanceof Y4ApiError ? err.message : `生成失败：${err.message || '未知错误'}`);
      setStep(3);
      setFetching(false);
    } finally {
      setCreating(false);
    }
  }

  // 兜底路径：报告列表拉不到（上游抖动）或该学生确实还没有报告时，
  // 先把已确认的 Y4 学生身份存下来，避免白选一遍（报告稍后在学生页选择）。
  async function createWithY4Only() {
    const displayName = info.display_name.trim();
    if (!displayName) {
      toast('学生姓名不能为空', { kind: 'error' });
      return;
    }
    if (!chosen) return;
    setCreating(true);
    try {
      const student = await createE4Student(
        studentPayload(displayName, { y4_student_id: chosen.id, y4_student_name: chosen.name }),
      );
      toast('已建档并关联该 Y4 学生，去学生页选一份报告即可生成首次报告', { kind: 'success' });
      nav(`/e4/students/${student.id}`);
    } catch (err) {
      toast(err.message || '建档失败', { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  const setInfoField = (k) => (e) => setInfo((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="e4-page">
      <button type="button" className="e4-back-link" onClick={() => nav('/e4/students')}>
        <IconBack />学生中心
      </button>

      <div className="e4-fetch-card e4-intake-card">
        <h1 className="e4-page-title">新建 E4 学生档案</h1>
        <p className="e4-page-subtitle">只需名字；性别、年级、学校与测评数据会从 Y4 自动带出，且随时可修改。</p>
        <StepBar step={step} />

        {/* ---- Step 1：名字 + Y4 候选 ---- */}
        {step === 1 && (
          <>
            <label className="e4-field e4-field-full">
              <span>学生名字</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setChosen(null);
                  setBareMode(false);
                }}
                placeholder="输入学生名字，系统自动在 Y4 中查找"
                autoFocus
                maxLength={100}
              />
            </label>

            {name.trim() && (
              <div className="e4-y4-list e4-intake-list">
                {loadingCandidates && [0, 1, 2].map((i) => (
                  <div className="e4-y4-item is-skeleton" key={i}>
                    <div className="e4-y4-item-main">
                      <span className="e4-skeleton" style={{ width: 90 + i * 20, height: 13 }} />
                      <span className="e4-skeleton" style={{ width: 150, height: 11 }} />
                    </div>
                  </div>
                ))}
                {!loadingCandidates && candidateError && <div className="e4-inline-error">{candidateError}</div>}
                {!loadingCandidates && !candidateError && candidates.length === 0 && (
                  <div className="e4-list-hint">Y4 中没有名字包含「{name.trim()}」的学生</div>
                )}
                {!loadingCandidates && candidates.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={`e4-y4-item ${chosen?.id === c.id ? 'is-selected' : ''}`}
                    onClick={() => pickCandidate(c)}
                  >
                    <span className="e4-y4-radio" />
                    <div className="e4-y4-item-main">
                      <span className="e4-y4-name">
                        {c.name}
                        {exactMatch && exactMatch.id === c.id && <em className="e4-intake-exact">精确匹配</em>}
                      </span>
                      <span className="e4-y4-meta">
                        {[c.gender, c.grade, c.school].filter(Boolean).join(' · ') || '年级学校未填写'}
                      </span>
                    </div>
                    <span className="e4-y4-side">
                      <strong>{c.report_count > 0 ? `${c.report_count} 份报告` : '暂无报告'}</strong>
                      {c.latest_report_date && <em>最新 {c.latest_report_date}</em>}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="e4-fetch-actions">
              <button type="button" className="e4-btn-ghost" onClick={() => nav('/e4/students')}>取消</button>
              <button
                type="button"
                className="e4-btn-ghost"
                disabled={!name.trim() || (!bareMode && !!chosen)}
                onClick={pickBare}
                title="先建空档案，之后再关联 Y4"
              >
                以上都不是，仅用名字建档
              </button>
              <button
                type="button"
                className="e4-btn-primary"
                disabled={!name.trim() || (!chosen && !bareMode)}
                onClick={goStep2}
              >
                下一步
              </button>
            </div>
            {chosen && (
              <p className="e4-form-footnote">
                已选 Y4 学生：{chosen.name}（即使只有一位匹配，也请确认是本人后再继续）
              </p>
            )}
          </>
        )}

        {/* ---- Step 2：档案信息 + 报告确认 ---- */}
        {step === 2 && (
          <>
            <div className="e4-form-grid">
              <label className="e4-field e4-field-full">
                <span>学生姓名（E4 报告中使用的名字，可填化名）</span>
                <input value={info.display_name} onChange={setInfoField('display_name')} maxLength={100} />
              </label>
              <label className="e4-field">
                <span>性别{info.gender ? '（已从 Y4 带出，可改）' : ''}</span>
                <select value={info.gender} onChange={setInfoField('gender')}>
                  <option value="">未填写</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </label>
              <label className="e4-field">
                <span>年级{info.grade ? '（已从 Y4 带出，可改）' : ''}</span>
                <input value={info.grade} onChange={setInfoField('grade')} maxLength={30} />
              </label>
              <label className="e4-field e4-field-full">
                <span>学校{info.school ? '（已从 Y4 带出，可改）' : ''}</span>
                <input value={info.school} onChange={setInfoField('school')} maxLength={100} />
              </label>
              <label className="e4-field">
                <span>下次会议类型（已服务过的学生可选进程中）</span>
                <select value={info.next_meeting_type} onChange={setInfoField('next_meeting_type')}>
                  <option value="first">首次会议</option>
                  <option value="progress">进程中复盘</option>
                </select>
              </label>
              <label className="e4-field">
                <span>下次会议日期（可留空待安排）</span>
                <DatePicker
                  value={info.next_meeting_date}
                  onChange={(v) => setInfo((f) => ({ ...f, next_meeting_date: v }))}
                  placeholder="待安排"
                />
              </label>
            </div>

            {chosen && (
              <>
                <h3 className="e4-intake-sub">选择用于生成 E4 协议的 Y4 报告</h3>
                <div className="e4-y4-list">
                  {loadingReports && [0, 1].map((i) => (
                    <div className="e4-y4-item is-skeleton" key={i}>
                      <span className="e4-y4-radio" />
                      <div className="e4-y4-item-main">
                        <span className="e4-skeleton" style={{ width: 120, height: 13 }} />
                        <span className="e4-skeleton" style={{ width: 160, height: 11 }} />
                      </div>
                    </div>
                  ))}
                  {!loadingReports && reportsError && (
                    <div className="e4-inline-error e4-y4-list-error">
                      <span>
                        报告列表加载失败：{reportsError.message}
                        {reportsError.status
                          ? `（HTTP ${reportsError.status}，查询对象 Y4 学生 #${chosen?.id ?? '—'}）`
                          : ''}
                      </span>
                      <button type="button" className="e4-btn-mini" onClick={() => loadReports(chosen?.id)}>
                        重新加载
                      </button>
                    </div>
                  )}
                  {!loadingReports && !reportsError && reports.length === 0 && (
                    <div className="e4-list-hint">
                      该 Y4 学生名下暂无报告。可返回上一步点「以上都不是，仅用名字建档」，之后再关联。
                    </div>
                  )}
                  {!loadingReports && !reportsError && reports.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className={`e4-y4-item ${selectedReport === r.id ? 'is-selected' : ''}`}
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
                </div>
              </>
            )}

            <div className="e4-fetch-actions">
              <button type="button" className="e4-btn-ghost" onClick={() => setStep(1)} disabled={creating}>
                上一步
              </button>
              {chosen && !loadingReports && !selectedReport && (
                <button type="button" className="e4-btn-ghost" onClick={createWithY4Only} disabled={creating}>
                  先建档，稍后选报告
                </button>
              )}
              <button type="button" className="e4-btn-primary" onClick={confirmAndGenerate} disabled={creating}>
                {creating
                  ? '建档中…'
                  : chosen
                    ? '建档并自动提取 E4 数据'
                    : '创建档案'}
              </button>
            </div>
            {chosen && (
              <p className="e4-form-footnote">
                点击后将实时调用 Y4 AI 生成 E4 评估协议（通常 10–30 秒），协议会保存为快照，不会重复调用。
              </p>
            )}
          </>
        )}

        {/* ---- Step 3：拉协议 ---- */}
        {step === 3 && (
          <div className="e4-fetch-body">
            {fetching && (
              <div className="e4-fetch-progress">
                <div className="e4-spinner" />
                <span>正在生成 E4 协议并提取全部排查项，请稍候，期间不要关闭页面…</span>
              </div>
            )}
            {fetchError && (
              <>
                <div className="e4-inline-error">{fetchError}</div>
                <p className="e4-card-hint">
                  学生档案已创建成功，可稍后从学生详情页重试生成协议。
                </p>
                <div className="e4-fetch-actions">
                  <button type="button" className="e4-btn-primary" onClick={() => nav(`/e4/students/${createdStudentId}`)}>
                    前往学生页面
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
