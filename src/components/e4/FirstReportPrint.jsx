import { DIMENSIONS, DIMENSION_ORDER, REPORT_STATIC, deriveConfirmedIssues } from '../../lib/e4ReportTemplate.js';
import AutoPages from './AutoPages.jsx';
import DocField from './DocField.jsx';
import logoImg from '../../logo/logo_color.png';

function formatCN(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

// 日期范围格式化：'2026-10-01~2026-10-07' → '2026年10月1日 ~ 2026年10月7日'
// 旧数据可能只有起点（'yyyy-MM-dd~'），此时只显示起点日期
function formatRangeCN(raw) {
  if (!raw) return '';
  const parts = String(raw).split('~');
  const start = formatCN(parts[0]);
  if (!start) return '';
  if (!parts[1] || !parts[1].trim()) return start;
  const end = formatCN(parts[1]);
  return end ? `${start} ~ ${end}` : start;
}

const cellText = (v) => {
  const t = String(v ?? '').trim();
  return t || '—';
};

// 综合判断 → 状态色（匹配参考图：红/橙/青/灰）
function verdictTint(v) {
  const s = String(v || '').trim();
  if (/已确认/.test(s)) return 'red';
  if (/可能存在/.test(s)) return 'orange';
  if (/暂未发现/.test(s)) return 'teal';
  return 'gray';
}

// 封面顶部的真实品牌 logo（logo_color.png 已包含完整品牌信息）
function BrandEmblem() {
  return (
    <div className="e4-brand-emblem">
      <img src={logoImg} alt="凭远 APP·ARK" className="e4-brand-logo" />
    </div>
  );
}

export default function FirstReportPrint({
  report,
  editable = false,   // true 时每个数据区域可点改；打印路由不传，渲染与只读版完全一致
  onPatch,            // (desc, value) => void
  onTableOp,          // (op, payload) => void：addSolution/delSolution/removeIssue
  aiFor,              // (desc, ctx) => { busy, onGenerate } | null
}) {
  const data = report.form_data;
  const cover = data.cover || {};
  const S = REPORT_STATIC;
  const studentName = cellText(cover.studentName);
  const studentLine = `${studentName} · ${report.report_date || cover.y4Date || ''}`;

  // 可编辑区域的统一出口。editable=false 时输出与原静态节点一致的文本。
  const EF = ({ d, type = 'text', val, disp, ctx }) => {
    if (!editable) return <>{disp ?? cellText(val)}</>;
    return (
      <DocField
        editable
        type={type}
        value={val == null ? '' : String(val)}
        display={disp}
        onCommit={(v) => onPatch?.(d, v)}
        ai={aiFor?.(d, ctx) || undefined}
      />
    );
  };

  const confirmed = deriveConfirmedIssues(data.sections);
  const overrides = data.section07?.issueOverrides || {};
  const confirmedRows = confirmed
    .filter((c) => overrides[c.dimension] !== null)
    .map((c) => ({
      position: `${DIMENSIONS[c.dimension].short}`,
      text: overrides[c.dimension] !== undefined ? overrides[c.dimension] : c.text,
    }));

  const solutions = (data.section07?.solutions || []).filter(
    (s) => String(s.direction || '').trim() || String(s.arrangement || '').trim()
  );

  // ---------------- 封面 ----------------
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
            <BrandEmblem />
            <div className="e4-cover-kicker">{S.brandKicker}</div>
            <h1 className="e4-cover-title">{cover.reportNature || S.title}</h1>
            <p className="e4-cover-subtitle">{S.subtitle}</p>
            <p className="e4-cover-intro">{S.intro}</p>

            <div className="e4-cover-info-table">
              {[
                ['学生', <EF key="studentName" d={{ area: 'cover', key: 'studentName' }} val={cover.studentName} />, '年级', <EF key="grade" d={{ area: 'cover', key: 'grade' }} val={cover.grade} />],
                ['学校', <EF key="school" d={{ area: 'cover', key: 'school' }} val={cover.school} />, 'Y4 测评日期', <EF key="y4Date" type="date" d={{ area: 'cover', key: 'y4Date' }} val={cover.y4Date} disp={cellText(formatCN(cover.y4Date))} />],
                ['首次会议', <EF key="meeting" type="date" d={{ area: 'report', key: 'meeting_date' }} val={report.meeting_date} disp={cellText(formatCN(report.meeting_date))} />, '报告日期', <EF key="reportd" type="date" d={{ area: 'report', key: 'report_date' }} val={report.report_date} disp={cellText(formatCN(report.report_date))} />],
                ['报告性质', <EF key="nature" d={{ area: 'cover', key: 'reportNature' }} val={cover.reportNature} />, '证据来源', <EF key="evidence" type="long" d={{ area: 'cover', key: 'evidenceSource' }} val={cover.evidenceSource} />],
              ].map((row, i) => (
                <div key={i} className="e4-cover-info-row">
                  {[0, 2].map((li, k) => (
                    <div key={k} className="e4-cover-info-cell">
                      <span className="e4-cover-label">{row[li]}</span>
                      <span className="e4-cover-value">{row[li + 1]}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="e4-confidential-bar">
              <strong>保密说明</strong>
              <span>{S.confidentiality}</span>
            </div>
          </>
        ),
      },
    ],
  };

  // ---------------- 02 如何阅读 ----------------
  const howToSection = {
    key: 'howto',
    chapterLabel: 'INTRODUCTION',
    chapterTint: 'red',
    studentLine,
    units: [
      {
        id: 'head',
        kind: 'block',
        node: (
          <header className="e4-section-head">
            <span className="e4-section-no">02</span>
            <div>
              <h2 className="e4-section-title">如何阅读 E4 首次学习力分析报告</h2>
              <p className="e4-section-en">HOW TO READ THIS REPORT</p>
            </div>
          </header>
        ),
      },
      { id: 'lead', kind: 'block', node: <p className="e4-howto-lead">{S.howToReadLead}</p> },
      {
        id: 'four-e',
        kind: 'block',
        node: (
          <div className="e4-four-e-grid">
            {S.fourE.map((e) => (
              <div key={e.key} className={`e4-e-card e4-tint-${e.tint}`}>
                <span className="e4-e-key">{e.key}</span>
                <span className="e4-e-cn">{e.cn}</span>
                <span className="e4-e-desc">{e.desc}</span>
              </div>
            ))}
          </div>
        ),
      },
      {
        id: 'process',
        kind: 'block',
        node: (
          <>
            <h3 className="e4-subsection-title">报告如何形成判断</h3>
            <div className="e4-process-row">
              {S.processSteps.map((p) => (
                <div key={p.no} className="e4-process-card">
                  <span className="e4-process-no">{p.no}</span>
                  <span className="e4-process-label">{p.label}</span>
                  <span className="e4-process-desc">{p.desc}</span>
                </div>
              ))}
            </div>
          </>
        ),
      },
      {
        id: 'states',
        kind: 'block',
        node: (
          <>
            <h3 className="e4-subsection-title">四种判断状态</h3>
            <div className="e4-states-grid">
              {S.states.map((s) => (
                <div key={s.label} className={`e4-state-card e4-tint-${s.tint}`}>
                  <span className="e4-state-label">{s.label}</span>
                  <span className="e4-state-desc">{s.desc}</span>
                </div>
              ))}
            </div>
          </>
        ),
      },
      {
        id: 'principles',
        kind: 'block',
        node: (
          <div className="e4-principles-box e4-tint-red">
            <p className="e4-principle-line"><strong>阅读原则</strong>{S.principles[0]}</p>
            <p className="e4-principle-em">{S.principles[1]}</p>
          </div>
        ),
      },
    ],
  };

  // ---------------- 03–06 四个维度 ----------------
  const dimSections = DIMENSION_ORDER.map((code) => {
    const dim = DIMENSIONS[code];
    const sec = data.sections[code];
    const mainRows = sec.rows.filter((r) => !r.supplementTable);
    const suppRows = sec.rows.filter((r) => r.supplementTable);
    const tint = dim.accent || 'red';
    const units = [
      {
        id: 'head',
        kind: 'block',
        node: (
          <>
            <header className="e4-section-head">
              <span className="e4-section-no">{dim.no}</span>
              <div>
                <h2 className="e4-section-title">{dim.title}</h2>
                <p className="e4-section-en">{dim.en}</p>
              </div>
            </header>
            {dim.coreQuestion && <p className="e4-core-q">{dim.coreQuestion}</p>}
            {dim.intro && <p className="e4-dim-intro">{dim.intro}</p>}
          </>
        ),
      },
      // 主表：深色 navy 表头
      {
        id: 'main',
        kind: 'table',
        head: (
          <thead>
            <tr>
              <th className="col-item">排查项目</th>
              <th className="col-y4">Y4 初步线索</th>
              <th className="col-meeting">会议核实情况</th>
              <th className="col-judgment">综合判断</th>
            </tr>
          </thead>
        ),
        rows: mainRows.map((r) => (
          <tr key={r.rowId}>
            <td className="col-item">{cellText(r.label)}</td>
            <td className="col-y4">
              <EF
                d={{ area: 'row', dim: code, rowId: r.rowId, key: 'y4Clue' }}
                type="long"
                val={r.y4Clue}
                ctx={{ label: r.label }}
              />
            </td>
            <td className="col-meeting">
              <EF
                d={{ area: 'row', dim: code, rowId: r.rowId, key: 'meetingNote' }}
                type="long"
                val={r.meetingNote}
                ctx={{ label: r.label, y4Clue: r.y4Clue, value: r.meetingNote }}
              />
            </td>
            <td className={`col-judgment tint-${verdictTint(r.judgment)}`}>
              <EF
                d={{ area: 'row', dim: code, rowId: r.rowId, key: 'judgment' }}
                type="judgment"
                val={r.judgment}
                ctx={{ label: r.label }}
              />
            </td>
          </tr>
        )),
      },
    ];

    // 补充确认表（仅当有 supplement 行时渲染）
    if (suppRows.length > 0) {
      units.push({
        id: 'supp-head',
        kind: 'block',
        node: <h3 className="e4-supp-heading">{dim.supplement?.heading || '会议补充确认'}</h3>,
      });
      units.push({
        id: 'supp',
        kind: 'table',
        head: (
          <thead>
            <tr>
              {(dim.supplement?.cols || ['补充项目', '访谈与现实表现', '综合判断']).map((h, i) => (
                <th key={i} className={i === 0 ? 'col-item' : i === 2 ? 'col-judgment' : 'col-meeting'}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        ),
        rows: suppRows.map((r) => (
          <tr key={r.rowId}>
            <td className="col-item">{cellText(r.label)}</td>
            <td className="col-meeting">
              <EF
                d={{ area: 'row', dim: code, rowId: r.rowId, key: 'meetingNote' }}
                type="long"
                val={r.meetingNote}
                ctx={{ label: r.label }}
              />
            </td>
            <td className={`col-judgment tint-${verdictTint(r.judgment)}`}>
              <EF
                d={{ area: 'row', dim: code, rowId: r.rowId, key: 'judgment' }}
                type="judgment"
                val={r.judgment}
                ctx={{ label: r.label }}
              />
            </td>
          </tr>
        )),
      });
    }

    // narrative 彩色盒子
    units.push({
      id: 'narratives',
      kind: 'block',
      node: (
        <div className="e4-narrative-cols">
          {dim.narratives.map((n) => {
            const value = sec.narratives?.[n.key];
            if (!value && !editable) return null;
            return (
              <div key={n.key} className={`e4-narrative-box e4-tint-${n.barColor || 'teal'}`}>
                <span className="e4-narrative-label">{n.label}</span>
                <p>
                  <EF
                    d={{ area: 'narrative', dim: code, key: n.key }}
                    type="long"
                    val={value}
                    ctx={{ label: n.label }}
                  />
                </p>
              </div>
            );
          })}
        </div>
      ),
    });

    return {
      key: code,
      chapterLabel: `${dim.short.toUpperCase()} CHECKLIST`,
      chapterTint: tint,
      studentLine,
      units,
    };
  });

  // ---------------- 07 综合判断 ----------------
  const judgmentSection = {
    key: 's07',
    chapterLabel: 'INTEGRATED JUDGMENT',
    chapterTint: 'red',
    studentLine,
    units: [
      {
        id: 'head',
        kind: 'block',
        node: (
          <>
            <header className="e4-section-head">
              <span className="e4-section-no">07</span>
              <div>
                <h2 className="e4-section-title">综合判断</h2>
                <p className="e4-section-en">INTEGRATED JUDGMENT</p>
              </div>
            </header>

            {/* 双栏 quote */}
            <div className="e4-quote-pair">
              <div className="e4-quote-card">
                <span className="e4-quote-label e4-tint-red">家庭最初反映</span>
                <p>
                  <EF
                    d={{ area: 's07', key: 'familyQuote' }}
                    type="long"
                    val={data.section07?.familyQuote}
                    ctx={{ quote: 'family' }}
                  />
                </p>
              </div>
              <div className="e4-quote-card">
                <span className="e4-quote-label e4-tint-red">学生自己的理解</span>
                <p>
                  <EF
                    d={{ area: 's07', key: 'studentQuote' }}
                    type="long"
                    val={data.section07?.studentQuote}
                    ctx={{ quote: 'student' }}
                  />
                </p>
              </div>
            </div>
          </>
        ),
      },
      // 已确认的关键问题
      {
        id: 'issues-head',
        kind: 'block',
        node: <h3 className="e4-supp-heading">已确认的关键问题</h3>,
      },
      {
        id: 'issues',
        kind: 'table',
        head: (
          <thead>
            <tr>
              <th className="col-item">E4 位置</th><th className="col-desc">当前核心发现</th>
              {editable && <th className="col-op no-print" aria-label="操作" />}
            </tr>
          </thead>
        ),
        rows: confirmedRows.length > 0 ? (
          confirmedRows.map((r, i) => (
            <tr key={i}>
              <td className="col-item">{r.position}</td>
              <td className="col-desc">
                <EF
                  d={{ area: 'issueText', dim: confirmed[i].dimension }}
                  type="long"
                  val={r.text}
                  ctx={{ dimension: confirmed[i].dimension }}
                />
              </td>
              {editable && (
                <td className="col-op no-print">
                  <button
                    type="button"
                    className="e4-doc-row-del"
                    title="从本节移除（不改变矩阵判断）"
                    onClick={() => onTableOp?.('removeIssue', { dim: confirmed[i].dimension })}
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))
        ) : (
          [<tr key="empty"><td className="col-item">—</td><td className="col-desc">—</td>{editable && <td className="col-op no-print" />}</tr>]
        ),
      },
      // 问题解决方案
      {
        id: 'solutions-head',
        kind: 'block',
        node: <h3 className="e4-supp-heading">问题解决方案</h3>,
      },
      {
        id: 'solutions',
        kind: 'table',
        head: (
          <thead>
            <tr>
              <th className="col-item">成长方向</th><th className="col-desc">简要安排</th>
              {editable && <th className="col-op no-print" aria-label="操作" />}
            </tr>
          </thead>
        ),
        rows: solutions.length > 0 ? (
          solutions.map((s, i) => (
            <tr key={i}>
              <td className="col-item">
                <EF
                  d={{ area: 'solutionField', index: i, key: 'direction' }}
                  type="long"
                  val={s.direction}
                />
              </td>
              <td className="col-desc">
                <EF
                  d={{ area: 'solutionField', index: i, key: 'arrangement' }}
                  type="long"
                  val={s.arrangement}
                />
              </td>
              {editable && (
                <td className="col-op no-print">
                  <button
                    type="button"
                    className="e4-doc-row-del"
                    title="删除该行"
                    onClick={() => onTableOp?.('delSolution', { index: i })}
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))
        ) : (
          [<tr key="empty"><td className="col-item">—</td><td className="col-desc">—</td>{editable && <td className="col-op no-print" />}</tr>]
        ),
      },
      // 下次复盘 —— 有 navy 表头
      {
        id: 'next-head',
        kind: 'block',
        node: (
          <>
            {editable && (
              <button type="button" className="e4-doc-add-row no-print" onClick={() => onTableOp?.('addSolution')}>
                + 添加一条方案
              </button>
            )}
            <h3 className="e4-supp-heading">下次复盘</h3>
          </>
        ),
      },
      {
        id: 'next',
        kind: 'table',
        head: (
          <thead>
            <tr>
              <th className="col-item">项目</th>
              <th className="col-desc">安排</th>
            </tr>
          </thead>
        ),
        rows: [
          <tr key="date">
            <td className="col-item">时间</td>
            <td className="col-desc">
              <EF
                d={{ area: 's07', key: 'nextReviewDate' }}
                type="date"
                range
                val={data.section07?.nextReviewDate}
                disp={cellText(formatRangeCN(data.section07?.nextReviewDate))}
              />
            </td>
          </tr>,
          <tr key="focus">
            <td className="col-item">重点验证</td>
            <td className="col-desc">
              <EF
                d={{ area: 's07', key: 'nextReviewFocus' }}
                type="long"
                val={data.section07?.nextReviewFocus}
              />
            </td>
          </tr>,
        ],
      },
    ],
  };

  return (
    <AutoPages
      sections={[coverSection, howToSection, ...dimSections, judgmentSection]}
      brandKicker={S.brandKicker}
    />
  );
}
