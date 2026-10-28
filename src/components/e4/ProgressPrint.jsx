// E4《阶段学习力复盘报告》版式组件（8 个章节）。
// 版式语言对齐 FirstReportPrint/PrepPrint（章节条 / 页脚 / 纸张外壳），
// 量化字段由一表人才数据预填、可点改；定性字段由导师填写。
// 与另两份报告一样走 AutoPages 自适应分页：章节内容超出一页时续页，不再溢出纸张。
import { PROGRESS_STATIC, PROGRESS_MODULES, MODULE_STATUSES } from '../../lib/e4ProgressTemplate.js';
import { toLocalDateStr } from '../../lib/date.js';
import DocField from './DocField.jsx';
import AutoPages from './AutoPages.jsx';
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

function SectionHead({ no, title, en }) {
  return (
    <header className="e4-section-head">
      <span className="e4-section-no">{no}</span>
      <div>
        <h2 className="e4-section-title">{title}</h2>
        <p className="e4-section-en">{en}</p>
      </div>
    </header>
  );
}

// P7 模块状态：四态语义点分段按钮（可编辑）或静态标签（只读）
function StatusField({ value, editable, onCommit }) {
  if (!editable) {
    const tint = ({ 稳定: 'teal', 需关注: 'orange', 当前重点: 'red', 信息不足: 'gray' })[value];
    return (
      <span className={`e4-progress-status is-static tint-${tint || 'gray'}`}>
        <i />{value || '—'}
      </span>
    );
  }
  return (
    <span className="e4-progress-status-opts">
      {MODULE_STATUSES.map((s) => (
        <span
          key={s}
          role="button"
          tabIndex={0}
          className={`e4-progress-status-opt ${value === s ? 'is-on' : ''}`}
          onClick={() => onCommit(s)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCommit(s); } }}
        >
          <i className={`tint-${({ 稳定: 'teal', 需关注: 'orange', 当前重点: 'red', 信息不足: 'gray' })[s]}`} />
          {s}
        </span>
      ))}
    </span>
  );
}

// P5 横向比例条 + 可编辑百分比文本
function AutonomyBar({ pctText, editable, onCommit }) {
  const pct = Math.max(0, Math.min(100, parseInt(pctText, 10) || 0));
  return (
    <span className="e4-autonomy-cell">
      <span className="e4-autonomy-bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="e4-autonomy-text">
        {editable ? (
          <DocField editable value={pctText || ''} placeholder="0%" onCommit={onCommit} />
        ) : (cellText(pctText))}
      </span>
    </span>
  );
}

// 紧凑时长：45 分 / 2小时 / 1h 30分
function compactDuration(mins) {
  const m = Math.round(mins || 0);
  if (m <= 0) return '';
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!r) return `${h} 小时`;
  return `${h}h ${r}分`;
}

// P3 阶段学习日历：微缩月视图，每日显示日期号 + 当日学习时长（热力底色参考强度）
function CalendarMini({ calendar, periodStart, periodEnd }) {
  const days = [];
  if (periodStart && periodEnd) {
    const s = new Date(`${periodStart}T00:00:00`);
    const e = new Date(`${periodEnd}T00:00:00`);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e >= s) {
      const cur = new Date(s);
      while (cur <= e) {
        days.push(toLocalDateStr(cur));
        cur.setDate(cur.getDate() + 1);
      }
    }
  }
  if (days.length === 0) {
    return <div className="e4-calendar-empty">{PROGRESS_STATIC.calendarEmpty}</div>;
  }
  const max = Math.max(1, ...days.map((d) => calendar[d] || 0));
  const leading = (new Date(`${days[0]}T00:00:00`).getDay() + 6) % 7; // 周一为 0
  const cells = [...Array(leading).fill(null), ...days];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="e4-calendar">
      <div className="e4-calendar-row e4-calendar-weekdays">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <span key={w} className="e4-calendar-wd">{w}</span>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="e4-calendar-row">
          {week.map((d, di) => {
            if (!d) return <span key={di} className="e4-calendar-cell is-blank" />;
            const mins = calendar[d] || 0;
            const level = mins === 0 ? 0 : Math.max(1, Math.ceil((mins / max) * 4));
            const dow = (new Date(`${d}T00:00:00`).getDay() + 6) % 7;
            const weekend = dow >= 5;
            const daynum = Number(d.slice(8));
            const dur = compactDuration(mins);
            return (
              <span
                key={di}
                className={`e4-calendar-cell is-level-${level}${weekend ? ' is-weekend' : ''}`}
                title={mins ? `${d} · ${mins} 分钟` : d}
              >
                <span className="e4-calendar-num">{daynum}</span>
                {dur && <span className="e4-calendar-dur">{dur}</span>}
              </span>
            );
          })}
        </div>
      ))}
      <div className="e4-calendar-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`e4-calendar-cell is-level-${l}`} />)}
        <span>多</span>
      </div>
    </div>
  );
}


export default function ProgressPrint({
  report,
  editable = false,
  onPatch,   // (desc, value) => void
  onTableOp, // (op, payload) => void
}) {
  const data = report.form_data;
  const S = PROGRESS_STATIC;
  const cover = data.cover || {};
  const subjects = data.subjects || [];
  const studentLine = `${cellText(cover.studentName)} · ${cover.reportDate ? formatCN(cover.reportDate) : '过程复盘'}`;

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

  const head = (no, title, en, lead) => ({
    id: 'head',
    kind: 'block',
    node: (
      <>
        <SectionHead no={no} title={title} en={en} />
        <p className="e4-dim-intro">{lead}</p>
      </>
    ),
  });
  const block = (id, node) => ({ id, kind: 'block', node });
  const subTitle = (id, text) => block(id, <h3 className="e4-subsection-title">{text}</h3>);
  const note = (id, label, text) => block(id, <p className="e4-progress-note"><strong>{label}</strong>{text}</p>);
  const delCell = (op, index) => editable && (
    <td className="col-ops no-print">
      <button type="button" className="e4-prep-row-del" title="删除此行" onClick={() => onTableOp?.(op, { index })}>×</button>
    </td>
  );
  const opsHead = editable && <th className="col-ops no-print" aria-label="操作" />;
  const addRow = (id, op, label) => block(id, (
    <button type="button" className="e4-prep-row-add no-print" onClick={() => onTableOp?.(op)}>{label}</button>
  ));
  const page = (key, chapterLabel, chapterTint, units) => ({ key, chapterLabel, chapterTint, studentLine, units });

  // ---------------- P1 封面 ----------------
  const coverSection = {
    key: 'cover',
    cover: true,
    studentLine,
    units: [block('cover', (
      <>
        <div className="e4-brand-emblem">
          <img src={logoImg} alt="凭远 APP·ARK" className="e4-brand-logo" />
        </div>
        <div className="e4-cover-kicker">{S.brandKicker}</div>
        <h1 className="e4-cover-title">{S.title}</h1>
        <p className="e4-cover-subtitle">{S.en}</p>
        <p className="e4-cover-intro">{S.intro}</p>

        <table className="e4-progress-cover-table">
          <tbody>
            <tr>
              <td className="e4-progress-cover-label">学生姓名</td>
              <td><EF d={{ area: 'cover', key: 'studentName' }} val={cover.studentName} /></td>
            </tr>
            <tr>
              <td className="e4-progress-cover-label">复盘周期</td>
              <td className="e4-progress-period">
                <EF d={{ area: 'cover', key: 'periodStart' }} type="date" val={cover.periodStart} disp={formatCN(cover.periodStart)} />
                <span className="e4-progress-period-sep">至</span>
                <EF d={{ area: 'cover', key: 'periodEnd' }} type="date" val={cover.periodEnd} disp={formatCN(cover.periodEnd)} />
              </td>
            </tr>
            <tr>
              <td className="e4-progress-cover-label">报告期数</td>
              <td><EF d={{ area: 'cover', key: 'issueNumber' }} val={cover.issueNumber} placeholder="第 1 期" /></td>
            </tr>
            <tr>
              <td className="e4-progress-cover-label">报告日期</td>
              <td><EF d={{ area: 'cover', key: 'reportDate' }} type="date" val={cover.reportDate} disp={formatCN(cover.reportDate)} /></td>
            </tr>
          </tbody>
        </table>

        <div className="e4-confidential-bar">
          <strong>使用说明</strong>
          <span>{S.confidentiality}</span>
        </div>
      </>
    ))],
  };

  // ---------------- P2 阶段起点 ----------------
  const p2 = page('p2', S.p2Chapter, 'red', [
    head(S.p2No, S.p2Title, S.p2En, S.p2Lead),
    subTitle('prior-title', S.priorTitle),
    {
      id: 'prior',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table',
      head: <thead><tr><th className="col-label">项目</th><th>内容</th></tr></thead>,
      rows: S.priorItems.map((it) => (
        <tr key={it.key}>
          <td className="col-label">{it.label}</td>
          <td>
            <EF d={{ area: 'p2', key: it.key }} type="long" val={data.p2?.[it.key]} placeholder={it.hint} />
          </td>
        </tr>
      )),
    },
    subTitle('scope-title', S.scopeTitle),
    {
      id: 'scope',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table',
      head: <thead><tr><th className="col-label">信息来源</th><th>具体范围</th></tr></thead>,
      rows: S.scopeItems.map((it) => (
        <tr key={it.key}>
          <td className="col-label">{it.label}</td>
          <td>
            <EF d={{ area: 'scope', key: it.key }} type="long" val={data.p2?.scope?.[it.key]} placeholder={it.hint} />
          </td>
        </tr>
      )),
    },
    note('note', '阅读提示', S.p2Note),
  ]);

  // ---------------- P3 学习参与与节奏 ----------------
  const p3 = page('p3', S.p3Chapter, 'red', [
    head(S.p3No, S.p3Title, S.p3En, S.p3Lead),
    subTitle('summary-title', '关键数据'),
    block('summary', (
      <div className="e4-progress-summary">
        {[
          { k: 'recordCoverage', v: data.p3?.recordCoverage },
          { k: 'totalDuration', v: data.p3?.totalDuration },
          { k: 'weekdayAvg', v: data.p3?.weekdayAvg },
          { k: 'weekendAvg', v: data.p3?.weekendAvg },
        ].map((it, i) => (
          <div key={it.k} className="e4-progress-summary-cell">
            <span className="e4-progress-summary-label">{S.summaryLabels[i]}</span>
            <EF d={{ area: 'p3', key: it.k }} val={it.v} />
          </div>
        ))}
      </div>
    )),
    subTitle('calendar-title', S.calendarTitle),
    block('calendar', <CalendarMini calendar={data.p3?.calendar || {}} periodStart={cover.periodStart} periodEnd={cover.periodEnd} />),
    subTitle('observation-title', S.observationLabel),
    block('observation', (
      <div className="e4-progress-observation">
        <EF d={{ area: 'p3', key: 'observation' }} type="long" val={data.p3?.observation} placeholder={S.observationHint} />
      </div>
    )),
    note('note', '数据说明', S.p3Note),
  ]);

  // ---------------- P4 学科投入、学习结构与练习质量 ----------------
  const p4 = page('p4', S.p4Chapter, 'orange', [
    head(S.p4No, S.p4Title, S.p4En, S.p4Lead),
    subTitle('subject-title', S.subjectTableTitle),
    {
      id: 'subjects',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table e4-progress-subject',
      head: (
        <thead>
          <tr>
            <th className="col-subject">学科</th>
            <th className="col-time">时间投入</th>
            <th className="col-struct">学习结构</th>
            <th className="col-quality">练习质量</th>
            {opsHead}
          </tr>
        </thead>
      ),
      rows: subjects.map((s, i) => (
        <tr key={i}>
          <td className="col-subject">
            <EF d={{ area: 'subject', index: i, field: 'subject' }} val={s.subject} placeholder="填写学科" />
          </td>
          <td className="col-time">
            <div className="e4-cell-stack">
              <EF d={{ area: 'subject', index: i, field: 'totalMinsText' }} val={s.totalMinsText} />
              <EF d={{ area: 'subject', index: i, field: 'sharePctText' }} val={s.sharePctText} />
            </div>
          </td>
          <td className="col-struct">
            <div className="e4-cell-stack">
              <EF d={{ area: 'subject', index: i, field: 'structureText' }} val={s.structureText} />
              <EF d={{ area: 'subject', index: i, field: 'reviewMinsText' }} val={s.reviewMinsText} />
            </div>
          </td>
          <td className="col-quality">
            <div className="e4-cell-stack">
              <EF d={{ area: 'subject', index: i, field: 'practiceCountText' }} val={s.practiceCountText} />
              <EF d={{ area: 'subject', index: i, field: 'evalText' }} type="long" val={s.evalText} placeholder="客观与主观评价" />
            </div>
          </td>
          {delCell('delSubject', i)}
        </tr>
      )),
    },
    ...(editable && subjects.length < 8 ? [addRow('add-subject', 'addSubject', '+ 添加学科行')] : []),
    subTitle('problem-title', S.problemTableTitle),
    {
      id: 'problems',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table',
      head: <thead><tr><th className="col-subject">学科</th><th>当前发现问题</th>{opsHead}</tr></thead>,
      rows: (data.p4?.problems || []).map((p, i) => (
        <tr key={i}>
          <td className="col-subject">
            <EF d={{ area: 'problem', index: i, field: 'subject' }} val={p.subject} placeholder="填写学科" />
          </td>
          <td>
            <EF d={{ area: 'problem', index: i, field: 'issue' }} type="long" val={p.issue} placeholder={i === 0 ? S.problemHint1 : S.problemHint2} />
          </td>
          {delCell('delProblem', i)}
        </tr>
      )),
    },
    ...(editable ? [addRow('add-problem', 'addProblem', '+ 添加问题行')] : []),
    note('note', '判断原则', S.p4Note),
  ]);

  // ---------------- P5 分学科自主性 ----------------
  const p5 = page('p5', S.p5Chapter, 'teal', [
    head(S.p5No, S.p5Title, S.p5En, S.p5Lead),
    subTitle('autonomy-title', S.p5TableTitle),
    {
      id: 'autonomy',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table e4-progress-autonomy',
      head: <thead><tr><th className="col-subject">学科</th><th>自主学习占比</th>{opsHead}</tr></thead>,
      rows: subjects.map((s, i) => (
        <tr key={i}>
          <td className="col-subject"><span className="e4-subject-name">{cellText(s.subject)}</span></td>
          <td>
            <AutonomyBar
              pctText={s.autonomyPctText}
              editable={editable}
              onCommit={(v) => onPatch?.({ area: 'subject', index: i, field: 'autonomyPctText' }, v)}
            />
          </td>
          {delCell('delSubject', i)}
        </tr>
      )),
    },
    subTitle('observation-title', S.observationLabel),
    block('observation', (
      <div className="e4-progress-observation">
        <EF d={{ area: 'p5', key: 'observation' }} type="long" val={data.p5?.observation} placeholder={S.p5ObservationHint} />
      </div>
    )),
    note('note', '数据说明', S.p5Note),
  ]);

  // ---------------- P6 分学科学业情绪 ----------------
  const p6 = page('p6', S.p6Chapter, 'blue', [
    head(S.p6No, S.p6Title, S.p6En, S.p6Lead),
    {
      id: 'emotion',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table e4-progress-emotion',
      head: (
        <thead>
          <tr>
            {S.p6ColHeaders.map((h) => (
              <th key={h} className={h === '学科' ? 'col-subject' : ''}>{h}</th>
            ))}
            {opsHead}
          </tr>
        </thead>
      ),
      rows: subjects.map((s, i) => (
        <tr key={i}>
          <td className="col-subject"><span className="e4-subject-name">{cellText(s.subject)}</span></td>
          <td><EF d={{ area: 'subject', index: i, field: 'experience' }} type="long" val={s.experience} placeholder={S.p6Placeholders[0]} /></td>
          <td><EF d={{ area: 'subject', index: i, field: 'emotion' }} type="long" val={s.emotion} placeholder={S.p6Placeholders[1]} /></td>
          <td><EF d={{ area: 'subject', index: i, field: 'finding' }} type="long" val={s.finding} placeholder={S.p6Placeholders[2]} /></td>
          {delCell('delSubject', i)}
        </tr>
      )),
    },
    note('note', '信息来源', S.p6Note),
  ]);

  // ---------------- P7 E4 阶段综合判断 ----------------
  const p7 = page('p7', S.p7Chapter, 'red', [
    head(S.p7No, S.p7Title, S.p7En, S.p7Lead),
    {
      id: 'modules',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table e4-progress-modules',
      head: (
        <thead>
          <tr><th className="col-module">E4 模块</th><th className="col-status">当前状态</th><th>综合判断</th></tr>
        </thead>
      ),
      rows: PROGRESS_MODULES.map((m) => {
        const mod = data.p7?.modules?.[m.key] || {};
        return (
          <tr key={m.key}>
            <td className={`col-module tint-${m.tint}`}>
              <span className="e4-module-en">{m.key}</span>
              <span className="e4-module-cn">{m.cn}</span>
            </td>
            <td className="col-status">
              <StatusField
                value={mod.status}
                editable={editable}
                onCommit={(v) => onPatch?.({ area: 'module', key: m.key, field: 'status' }, v)}
              />
            </td>
            <td>
              <EF d={{ area: 'module', key: m.key, field: 'judgment' }} type="long" val={mod.judgment} placeholder={m.judgmentHint} />
            </td>
          </tr>
        );
      }),
    },
    note('note', '状态说明', S.statusLegend),
  ]);

  // ---------------- P8 下一阶段成长方案与复盘安排 ----------------
  const p8 = page('p8', S.p8Chapter, 'red', [
    head(S.p8No, S.p8Title, S.p8En, S.p8Lead),
    subTitle('goals-title', S.goalsTitle),
    {
      id: 'goals',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table',
      head: <thead><tr><th className="col-label">项目</th><th>内容</th></tr></thead>,
      rows: S.goalItems.map((it) => (
        <tr key={it.key}>
          <td className="col-label">{it.label}</td>
          <td>
            <EF d={{ area: 'p8', key: it.key }} type="long" val={data.p8?.[it.key]} placeholder={it.hint} />
          </td>
        </tr>
      )),
    },
    subTitle('solutions-title', S.solutionsTitle),
    {
      id: 'solutions',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table',
      head: <thead><tr><th className="col-label">成长方向</th><th>简要安排</th>{opsHead}</tr></thead>,
      rows: (data.p8?.solutions || []).map((sol, i) => (
        <tr key={i}>
          <td className="col-label">
            <EF d={{ area: 'solution', index: i, field: 'direction' }} type="long" val={sol.direction} />
          </td>
          <td>
            <EF d={{ area: 'solution', index: i, field: 'arrangement' }} type="long" val={sol.arrangement} />
          </td>
          {delCell('delSolution', i)}
        </tr>
      )),
    },
    ...(editable ? [addRow('add-solution', 'addSolution', '+ 添加一条方案')] : []),
    note('boundary', '填写边界', S.solutionBoundary),
    subTitle('next-title', S.nextTitle),
    {
      id: 'next',
      kind: 'table',
      tableClassName: 'e4-navy-table e4-progress-table',
      head: <thead><tr><th className="col-label">项目</th><th>安排</th></tr></thead>,
      rows: [
        ...S.nextItems.map((it) => (
          <tr key={it.key}>
            <td className="col-label">{it.label}</td>
            <td>
              {it.key === 'reviewDate' ? (
                <EF d={{ area: 'p8', key: 'reviewDate' }} type="date" val={data.p8?.reviewDate} disp={formatCN(data.p8?.reviewDate)} />
              ) : (
                <EF d={{ area: 'p8', key: 'verifyFocus' }} type="long" val={data.p8?.verifyFocus} placeholder="填写下一阶段需要观察的行为或变化" />
              )}
            </td>
          </tr>
        )),
        <tr key="refNote">
          <td className="col-label">参考信息</td>
          <td>
            <EF d={{ area: 'p8', key: 'refNote' }} type="long" val={data.p8?.refNote} />
          </td>
        </tr>,
      ],
    },
    block('principle', <div className="e4-progress-principle"><strong>阶段原则</strong>　{S.p8Principle}</div>),
  ]);

  return (
    <AutoPages
      sections={[coverSection, p2, p3, p4, p5, p6, p7, p8]}
      brandKicker={S.brandKicker}
      footerCenter={S.footerCenter}
      docClassName="e4-progress-doc"
    />
  );
}
