// 「这周谁记了」：要跟进的学生在前，正常的在后。
// 每天一个小方块（18px），最后一列「今天的消息」跳到今天 tab 里对应的卡片。

import '../../styles/mentor-desk.css';
import { kindLabelOf, shortMD } from './MessageCard.jsx';

const LETTER = ['日', '一', '二', '三', '四', '五', '六'];

function dayLabel(iso) {
  const d = new Date(`${String(iso || '').slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : LETTER[d.getDay()];
}

function headerLabels(rows) {
  const dates = rows[0]?.days?.map((d) => d.date) || [];
  const labels = dates.map((iso, i) => (i === dates.length - 1 ? '今' : dayLabel(iso)));
  while (labels.length < 7) labels.push('');
  return labels.slice(-7);
}

function Days({ days = [] }) {
  return (
    <div className="md-days">
      {days.map((day) => (
        <i key={day.date} className={`md-d ${day.state === 'e' ? '' : `md-d--${day.state}`}`} title={day.date} />
      ))}
    </div>
  );
}

function draftCell(row, onJumpToDraft) {
  const d = row.draft;
  if (!d) return <span className="md-today-msg md-today-msg--quiet">—</span>;
  if (d.status === 'sent') return <span className="md-today-msg md-today-msg--quiet">已发</span>;
  if (d.status === 'snoozed') {
    return <span className="md-today-msg md-today-msg--quiet">{shortMD(d.snooze_until)} 再写</span>;
  }
  if (d.status === 'skipped') return <span className="md-today-msg md-today-msg--quiet">不发</span>;
  return (
    <button
      type="button"
      className="md-today-msg"
      data-student-id={row.id}
      onClick={() => onJumpToDraft?.(row.id)}
    >
      {kindLabelOf(d)}待发
    </button>
  );
}

/**
 * @param {object} props
 * @param {Array} props.rows C4 WeekBoard row
 * @param {boolean} [props.showMentor]
 * @param {(id: string) => void} [props.onOpenStudent]
 * @param {(id: string) => void} [props.onJumpToDraft]
 */
export default function WeekBoard({ rows = [], showMentor = false, onOpenStudent, onJumpToDraft }) {
  const warn = rows.filter((r) => r.warn);
  const normal = rows.filter((r) => !r.warn);
  const cols = showMentor ? 6 : 5;
  const labels = headerLabels(rows);

  const tr = (row) => (
    <tr key={row.id}>
      <td>
        <div className="md-nm">
          <span className="md-av md-av--sm" aria-hidden="true">{(row.name || '?').charAt(0)}</span>
          <div>
            <b>
              <button type="button" className="md-link" onClick={() => onOpenStudent?.(row.id)}>
                {row.name}
              </button>
            </b>
            <small>{[row.stageText, row.school].filter(Boolean).join(' · ')}</small>
          </div>
        </div>
      </td>
      {showMentor && <td className="md-col-mentor">{row.mentorName || '—'}</td>}
      <td><Days days={row.days} /></td>
      <td>
        <span className={`md-state ${row.warn ? 'md-state--warn' : ''}`}>
          {row.stateText}
          {row.subText ? <small>{row.subText}</small> : null}
        </span>
      </td>
      <td>{row.lastText || '—'}</td>
      <td>{draftCell(row, onJumpToDraft)}</td>
    </tr>
  );

  const group = (label, list) => (list.length > 0 ? (
    <>
      <tr className="md-grp"><td colSpan={cols}>{label} · {list.length}</td></tr>
      {list.map(tr)}
    </>
  ) : null);

  return (
    <section className="md-root md-board" aria-label="这周谁记了">
      <div className="md-sec-h">
        <h2>这周谁记了</h2>
        <span className="md-legend">
          <span><i className="md-d md-d--f" />记了</span>
          <span><i className="md-d" />没记</span>
          <span><i className="md-d md-d--t" />今天还没记</span>
          <span><i className="md-d md-d--n" />还没注册</span>
        </span>
      </div>
      <div className="md-panel md-panel--scroll">
        <table className="md-tbl md-tbl--board">
          <thead>
            <tr>
              <th>学生</th>
              {showMentor && <th className="md-col-mentor">导师</th>}
              <th>
                <div className="md-days md-dayh">
                  {labels.map((label, i) => (
                    <span key={i} className={i === labels.length - 1 && label === '今' ? 't' : ''}>{label}</span>
                  ))}
                </div>
              </th>
              <th>情况</th>
              <th>最后一次记录</th>
              <th>今天的消息</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols} className="md-empty">没有学生</td></tr>
            ) : (
              <>
                {group('要跟进', warn)}
                {group('正常', normal)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
