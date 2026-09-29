// E4《首次学习力会议会前准备》A4 版式组件。
// 版式语言对齐 FirstReportPrint（章节条 / 页脚 / 纸张外壳），
// 但为独立组件：打印路由（editable=false）渲染与只读完全一致。
import { PREP_DIMENSIONS, PREP_DIMENSION_ORDER, PREP_STATIC, VERDICT_DOT } from '../../lib/e4PrepTemplate.js';
import AutoPages from './AutoPages.jsx';
import DocField from './DocField.jsx';
import logoImg from '../../logo/logo_color.png';

function formatCN(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

const cellText = (v) => {
  const t = String(v ?? '').trim();
  return t || '—';
};

// 勾选框：打印为细线方框，勾选时墨色填充；可编辑时点击切换
function CheckBox({ checked, onToggle, editable }) {
  return (
    <span
      className={`e4-prep-check ${checked ? 'is-on' : ''} ${editable ? 'is-editable' : ''}`}
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={editable ? () => onToggle?.(!checked) : undefined}
      onKeyDown={editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(!checked); } } : undefined}
      aria-checked={checked}
    />
  );
}

export default function PrepPrint({
  report,
  editable = false,
  onPatch,   // (desc, value) => void
  onTableOp, // (op, payload) => void：addSubject / delSubject
}) {
  const data = report.form_data;
  const cover = data.prepCover || {};
  const S = PREP_STATIC;
  const studentLine = `${cellText(cover.studentName)} · 会前准备`;

  const EF = ({ d, type = 'text', val, disp, placeholder }) => {
    if (!editable) return <>{disp ?? cellText(val)}</>;
    return (
      <DocField
        editable
        type={type}
        value={val == null ? '' : String(val)}
        display={disp}
        placeholder={placeholder}
        onCommit={(v) => onPatch?.(d, v)}
      />
    );
  };

  const attendees = cover.attendees || {};
  const sources = data.sources || [];
  const subjects = data.subjects || [];
  const growthMap = data.growthMap;

  // ---------------- P1 封面 ----------------
  const coverSection = {
    key: 'cover',
    cover: true,
    studentLine,
    units: [
      {
        id: 'cover',
        kind: 'block',
        node: (
          <>
            <div className="e4-brand-emblem">
              <img src={logoImg} alt="凭远 APP·ARK" className="e4-brand-logo" />
            </div>
            <div className="e4-cover-kicker">{S.brandKicker}</div>
            <h1 className="e4-cover-title">{S.title}</h1>
            <p className="e4-cover-subtitle">{S.en}</p>
            <p className="e4-cover-intro">{S.lead}</p>

            <div className="e4-cover-info-table">
              <div className="e4-cover-info-row">
                <div className="e4-cover-info-cell">
                  <span className="e4-cover-label">学生姓名</span>
                  <span className="e4-cover-value">
                    <EF d={{ area: 'prepCover', key: 'studentName' }} val={cover.studentName} />
                  </span>
                </div>
                <div className="e4-cover-info-cell">
                  <span className="e4-cover-label">年级与学校</span>
                  <span className="e4-cover-value">
                    <EF d={{ area: 'prepCover', key: 'gradeSchool' }} val={cover.gradeSchool} />
                  </span>
                </div>
              </div>
              <div className="e4-cover-info-row">
                <div className="e4-cover-info-cell">
                  <span className="e4-cover-label">会议日期</span>
                  <span className="e4-cover-value">
                    <EF d={{ area: 'prepCover', key: 'meetingDate' }} type="date" val={cover.meetingDate} disp={cover.meetingDate ? formatCN(cover.meetingDate) : undefined} />
                  </span>
                </div>
                <div className="e4-cover-info-cell">
                  <span className="e4-cover-label">学习力导师</span>
                  <span className="e4-cover-value">
                    <EF d={{ area: 'prepCover', key: 'advisorName' }} val={cover.advisorName} />
                  </span>
                </div>
              </div>
              <div className="e4-cover-info-row">
                <div className="e4-cover-info-cell">
                  <span className="e4-cover-label">参会人员</span>
                  <span className="e4-cover-value e4-prep-attendees">
                    {S.attendeeOptions.map((opt) => {
                      const key = opt === '学生' ? 'student' : opt === '家长' ? 'parent' : 'advisor';
                      return (
                        <span key={opt} className="e4-prep-attendee">
                          <CheckBox
                            checked={!!attendees[key]}
                            editable={editable}
                            onToggle={(v) => onPatch?.({ area: 'attendee', key }, v)}
                          />
                          {opt}
                        </span>
                      );
                    })}
                    <span className="e4-prep-attendee">
                      其他
                      <EF d={{ area: 'attendee', key: 'otherText' }} val={attendees.otherText} placeholder="填写" />
                    </span>
                  </span>
                </div>
                <div className="e4-cover-info-cell">
                  <span className="e4-cover-label">预计时长</span>
                  <span className="e4-cover-value">
                    <EF d={{ area: 'prepCover', key: 'duration' }} val={cover.duration} placeholder="如 90 分钟" />
                  </span>
                </div>
              </div>
            </div>

            <div className="e4-confidential-bar">
              <strong>使用说明</strong>
              <span>本表在会议中同步使用：左侧为生成预览，右侧确认清单支持边问边勾选与速记；会议结束后可统一粘贴文字记录。</span>
            </div>
            <p className="e4-cover-foot">{S.kickerNote}</p>
          </>
        ),
      },
    ],
  };

  // ---------------- P2 会议固定结构 + 资料完整性 ----------------
  const structureSection = {
    key: 'structure',
    chapterLabel: 'MEETING PREPARATION',
    chapterTint: 'red',
    studentLine,
    units: [
      {
        id: 'head',
        kind: 'block',
        node: (
          <header className="e4-section-head">
            <span className="e4-section-no">01</span>
            <div>
              <h2 className="e4-section-title">{S.meetingStructureTitle}</h2>
              <p className="e4-section-en">FIXED MEETING STRUCTURE</p>
            </div>
          </header>
        ),
      },
      {
        id: 'structure',
        kind: 'table',
        tableClassName: 'e4-navy-table e4-prep-table',
        head: (
          <thead>
            <tr><th className="col-stage">环节</th><th>信息来源</th><th>最终输出</th></tr>
          </thead>
        ),
        rows: S.meetingStructure.map((r) => (
          <tr key={r.no}>
            <td className="col-stage"><span className="e4-prep-stage-no">{r.no}</span>{r.stage}</td>
            <td>{r.source}</td>
            <td>{r.output}</td>
          </tr>
        )),
      },
      {
        id: 'sources-lead',
        kind: 'block',
        node: (
          <>
            <h3 className="e4-subsection-title">{S.sourcesTitle}<span className="e4-subsection-en">{S.sourcesEn}</span></h3>
            <p className="e4-dim-intro">{S.sourcesLead}</p>
          </>
        ),
      },
      {
        id: 'sources',
        kind: 'table',
        tableClassName: 'e4-navy-table e4-prep-table',
        head: (
          <thead>
            <tr>
              <th className="col-item">资料类型</th>
              <th>会前已有内容</th>
              <th className="col-origin">信息来源</th>
              <th className="col-status">资料状态</th>
            </tr>
          </thead>
        ),
        rows: S.sources.map((meta) => {
          const row = sources.find((s) => s.key === meta.key) || {};
          const isGrowth = meta.key === 'growthmap';
          return (
            <tr key={meta.key}>
              <td className="col-item">{meta.label}</td>
              <td>
                {isGrowth && growthMap?.fileName
                  ? <span className="e4-prep-gmap">已上传：{growthMap.fileName}</span>
                  : <EF d={{ area: 'source', key: meta.key, field: 'content' }} type="long" val={row.content || meta.contentHint} placeholder={meta.contentHint} />}
              </td>
              <td className="col-origin">
                <EF d={{ area: 'source', key: meta.key, field: 'origin' }} val={row.origin} placeholder="填写" />
              </td>
              <td className="col-status">
                <span className="e4-prep-status-opts">
                  {meta.statusOptions.map((opt) => (
                    <span
                      key={opt}
                      className={`e4-prep-status-opt ${row.status === opt ? 'is-on' : ''} ${editable ? 'is-editable' : ''}`}
                      role={editable ? 'button' : undefined}
                      tabIndex={editable ? 0 : undefined}
                      onClick={editable ? () => onPatch?.({ area: 'source', key: meta.key, field: 'status' }, row.status === opt ? '' : opt) : undefined}
                      onKeyDown={editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPatch?.({ area: 'source', key: meta.key, field: 'status' }, row.status === opt ? '' : opt); } } : undefined}
                    >
                      {opt}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          );
        }),
      },
      { id: 'note', kind: 'block', node: <p className="e4-prep-note">{S.recordPrinciple}</p> },
    ],
  };

  // ---------------- P3 学科线索与重点排序 ----------------
  const subjectsSection = {
    key: 'subjects',
    chapterLabel: 'SUBJECT REVIEW',
    chapterTint: 'orange',
    studentLine,
    units: [
      {
        id: 'head',
        kind: 'block',
        node: (
          <>
            <header className="e4-section-head">
              <span className="e4-section-no">02</span>
              <div>
                <h2 className="e4-section-title">{S.subjectsTitle}</h2>
                <p className="e4-section-en">{S.subjectsEn}</p>
              </div>
            </header>
            <p className="e4-dim-intro">{S.subjectsLead}</p>
          </>
        ),
      },
      {
        id: 'subjects',
        kind: 'table',
        tableClassName: 'e4-navy-table e4-prep-table',
        head: (
          <thead>
            <tr>
              <th className="col-subject">学科</th>
              <th>已有线索</th>
              <th className="col-types">重点类型</th>
              <th className="col-follow">重点追问</th>
              {editable && <th className="col-ops" />}
            </tr>
          </thead>
        ),
        rows: subjects.map((row, i) => (
          <tr key={i}>
            <td className="col-subject">
              <EF d={{ area: 'subject', index: i, field: 'subject' }} val={row.subject} placeholder="填写" />
            </td>
            <td>
              <EF d={{ area: 'subject', index: i, field: 'clues' }} type="long" val={row.clues} placeholder={S.subjectClueHint} />
            </td>
            <td className="col-types">
              <span className="e4-prep-status-opts">
                {S.subjectTypes.map((t) => {
                  const on = (row.types || []).includes(t);
                  return (
                    <span
                      key={t}
                      className={`e4-prep-status-opt ${on ? 'is-on' : ''} ${editable ? 'is-editable' : ''}`}
                      role={editable ? 'button' : undefined}
                      tabIndex={editable ? 0 : undefined}
                      onClick={editable ? () => {
                        const cur = row.types || [];
                        const next = on ? cur.filter((x) => x !== t) : [...cur, t];
                        onPatch?.({ area: 'subject', index: i, field: 'types' }, next);
                      } : undefined}
                      onKeyDown={editable ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const cur = row.types || [];
                          const next = on ? cur.filter((x) => x !== t) : [...cur, t];
                          onPatch?.({ area: 'subject', index: i, field: 'types' }, next);
                        }
                      } : undefined}
                    >
                      {t}
                    </span>
                  );
                })}
              </span>
            </td>
            <td className="col-follow">
              <EF d={{ area: 'subject', index: i, field: 'followUp' }} type="long" val={row.followUp} placeholder="填写" />
            </td>
            {editable && (
              <td className="col-ops">
                <button type="button" className="e4-prep-row-del" title="删除此行" onClick={() => onTableOp?.('delSubject', { index: i })}>×</button>
              </td>
            )}
          </tr>
        )),
      },
      {
        id: 'note',
        kind: 'block',
        node: (
          <>
            {editable && (
              <button type="button" className="e4-prep-row-add no-print" onClick={() => onTableOp?.('addSubject')}>
                + 添加学科行
              </button>
            )}
            <p className="e4-prep-note">{S.sortNote}</p>
          </>
        ),
      },
    ],
  };

  // ---------------- P4–P7 E1–E4 确认准备表 ----------------
  const confirmSections = PREP_DIMENSION_ORDER.map((code) => {
    const dim = PREP_DIMENSIONS[code];
    const rows = data.prepRows?.[code] || [];
    const moduleLevel = !!dim.moduleLevel;
    // 模块级总述：新数据取 moduleJudgments；旧草稿回退到第一行存的整段判断
    const mj = data.moduleJudgments?.[code]
      || (moduleLevel ? { verdict: rows[0]?.verdict || '', text: rows[0]?.verdictText || '' } : null);
    return {
      key: code,
      chapterLabel: S.confirmKicker,
      chapterTint: dim.tint,
      studentLine,
      units: [
        {
          id: 'head',
          kind: 'block',
          node: (
            <>
              <header className="e4-section-head">
                <span className="e4-section-no">{dim.short}</span>
                <div>
                  <h2 className="e4-section-title">{dim.title}</h2>
                  <p className="e4-section-en">{dim.en}</p>
                </div>
              </header>
              <p className="e4-dim-intro">{dim.intro}</p>

              {moduleLevel && mj && (mj.verdict || mj.text || editable) && (
                <div className="e4-prep-module-block">
                  {mj.verdict && (
                    <span className="e4-prep-verdict-tag">
                      <i style={{ background: VERDICT_DOT[mj.verdict] || '#8F897B' }} />{mj.verdict}
                    </span>
                  )}
                  <EF d={{ area: 'moduleJudgment', dim: code, field: 'text' }} type="long" val={mj.text} placeholder="Y4 协议未提供模块级判断" />
                </div>
              )}
            </>
          ),
        },
        {
          id: 'confirm',
          kind: 'table',
          tableClassName: 'e4-navy-table e4-prep-table e4-prep-confirm',
          head: (
            <thead>
              <tr>
                <th className="col-check">{S.confirmCols[0]}</th>
                <th className="col-item">{S.confirmCols[1]}</th>
                <th className="col-verdict">{S.confirmCols[2]}</th>
                <th className="col-ask">{S.confirmCols[3]}</th>
              </tr>
            </thead>
          ),
          rows: rows.map((r) => (
            <tr key={r.rowId} className={r.checked ? 'is-checked' : ''}>
              <td className="col-check">
                <CheckBox
                  checked={!!r.checked}
                  editable={editable}
                  onToggle={(v) => onPatch?.({ area: 'row', dim: code, rowId: r.rowId, field: 'checked' }, v)}
                />
              </td>
              <td className="col-item">
                {r.label}
                {r.verdict && !moduleLevel && (
                  <span className="e4-prep-verdict-tag">
                    <i style={{ background: VERDICT_DOT[r.verdict] || '#8F897B' }} />{r.verdict}
                  </span>
                )}
              </td>
              <td className="col-verdict">
                <EF d={{ area: 'row', dim: code, rowId: r.rowId, field: 'verdictText' }} type="long" val={moduleLevel && !data.moduleJudgments ? '' : r.verdictText} placeholder="协议未涉及" />
              </td>
              <td className="col-ask">
                <EF d={{ area: 'row', dim: code, rowId: r.rowId, field: 'ask' }} type="long" val={r.ask} placeholder="填写" />
                {editable && r.meetingNote && <p className="e4-prep-mnote">会中记录：{r.meetingNote}</p>}
              </td>
            </tr>
          )),
        },
      ],
    };
  });

  return (
    <AutoPages
      sections={[coverSection, structureSection, subjectsSection, ...confirmSections]}
      brandKicker={S.brandKicker}
      footerCenter="会前准备模板"
      docClassName="e4-prep-doc"
    />
  );
}
