// 侧栏里的学习记录：按日期分组，每条显示学生填写的全部内容。

import { SUBJECTIVE_LABEL } from '../../lib/rating.js';
import { objectiveOf } from '../../lib/objective.js';
import { isPendingObjective } from '../../lib/sessionRules.js';
import { toLocalDateStr } from '../../lib/date.js';

const CATEGORY = {
  1: { label: '学习', color: '#2563EB' },
  2: { label: '复习', color: '#7C3AED' },
  3: { label: '练习', color: '#16A34A' },
};
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

/** 'YYYY-MM-DD' → '10月24日 周六' */
export function dateHeading(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日 ${wd}`;
}

/** 同一天内按开始时间排；没有开始时间的排最后 */
function sortWithinDay(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = a.r.start_time || '99';
      const tb = b.r.start_time || '99';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

export function groupByDate(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.date || String(s.session_date || '').slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, rows]) => ({ date, rows: sortWithinDay(rows) }));
}

function Objective({ row }) {
  const pending = isPendingObjective({ ...row, deleted_at: null });
  if (pending) return <span className="sr-obj is-pending">客观 待补填</span>;
  const o = objectiveOf(row);
  if (!o) return null;
  if (o.kind === 'na') return <span className="sr-obj">客观 N/A</span>;
  return <span className="sr-obj">客观 {o.label}</span>;
}

export default function SheetRecordRow({ row }) {
  const cat = CATEGORY[row.category];
  const start = hhmm(row.start_time);
  const end = hhmm(row.end_time);
  const course = row.course?.name || row.course?.subject || row.subject || '未分类';
  const detail = [cat?.label, row.form, row.chapter?.name, row.unit?.name].filter(Boolean);
  const isBackfill = row.created_at && row.date && toLocalDateStr(new Date(row.created_at)) !== row.date;
  const subj = SUBJECTIVE_LABEL[row.self_rating];
  return (
    <div className="sr-row">
      <div className="sr-time">
        {start ? <><span>{start}</span>{end && <span>{end}</span>}</> : <span>—</span>}
      </div>
      <div className="sr-mid">
        <div className="sr-course">
          {course}
          {isBackfill && <span className="mentor-sheet-row__backfill">补填</span>}
        </div>
        <div className="sr-detail">
          {cat && <span className="sr-dot" style={{ background: cat.color }} />}
          {detail.map((t, i) => (
            <span key={i}>{i > 0 && <span className="sr-sep"> · </span>}{t}</span>
          ))}
        </div>
        {row.notes && (
          <div className="sr-notes"><span>备注</span>{row.notes}</div>
        )}
      </div>
      <div className="sr-right">
        <div className="sr-dur">{row.duration_minutes != null ? `${row.duration_minutes} 分钟` : '—'}</div>
        {subj && <div className="sr-subj">主观 {subj}</div>}
        <Objective row={row} />
      </div>
    </div>
  );
}

/** 日期分组列表 */
export function SheetRecords({ sessions, limit = 40, expanded, onExpand }) {
  const shown = expanded ? sessions : sessions.slice(0, limit);
  const groups = groupByDate(shown);
  return (
    <div className="sr-list">
      {groups.map((g) => (
        <div key={g.date} className="sr-day">
          <div className="sr-day-head">{dateHeading(g.date)}</div>
          {g.rows.map((r) => <SheetRecordRow key={r.id} row={r} />)}
        </div>
      ))}
      {!expanded && sessions.length > limit && (
        <button type="button" className="sr-more" onClick={onExpand}>
          显示更早的记录（还有 {sessions.length - limit} 条）
        </button>
      )}
    </div>
  );
}
