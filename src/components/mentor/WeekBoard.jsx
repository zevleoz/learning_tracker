// 「这周谁记了」：要跟进的学生在前，正常的在后。
// 每天一个小方块（18px），最后一列「今天的消息」跳到今天 tab 里对应的卡片。
// 行尾 ··· / 右键可以隐藏或暂停学生；被隐藏 / 暂停的收进底部「已隐藏 N 人」，可恢复。

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import '../../styles/mentor-desk.css';
import { addDays, SNOOZE_DAYS } from '../../lib/supervision.js';
import { todayISO } from '../../lib/date.js';
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

/** ··· / 右键菜单：隐藏（永久）或暂停 3 / 5 / 7 天 */
function MuteMenu({ row, todayIso, open, setOpen, onOpen, pos, anchorRef, menuRef, onHide, onSnooze }) {
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="md-more"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && createPortal(
        <div className="md-root">
          <div
            ref={menuRef}
            className="md-menu md-mute-pop"
            role="menu"
            aria-label="隐藏或暂停"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            <div className="md-menu-lbl">这位学生不再提醒导师</div>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onHide?.(row.id); }}>
              隐藏<small>永久</small>
            </button>
            {SNOOZE_DAYS.map((days) => (
              <button
                key={days}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onSnooze?.(row.id, days); }}
              >
                <span>暂停 {days} 天</span>
                <small>{shortMD(addDays(todayIso, days))} 再看</small>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function BoardRow({
  row, showMentor, mute, todayIso = todayISO(),
  onOpenStudent, onJumpToDraft, onHide, onSnooze, onRestore,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const moreRef = useRef(null);
  const menuRef = useRef(null);

  const openAt = (x, y) => {
    const width = 200;
    const height = 190;
    const left = Number.isFinite(x) ? x : 8;
    const top = Number.isFinite(y) ? y : 8;
    setPos({
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    });
    setOpen(true);
  };

  const openFromButton = () => {
    if (open) { setOpen(false); return; }
    const r = moreRef.current?.getBoundingClientRect();
    if (r) openAt(r.right - 200, r.bottom + 4);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || moreRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <tr onContextMenu={mute ? undefined : (e) => { e.preventDefault(); openAt(e.clientX, e.clientY); }}>
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
      <td>
        <span className="md-msg-cell">
          {mute ? (
            <span className="md-today-msg md-today-msg--quiet">
              {mute.mode === 'hidden' ? '已隐藏' : `再看：${shortMD(mute.until)}`}
            </span>
          ) : draftCell(row, onJumpToDraft)}
          {mute ? (
            <button type="button" className="md-restore" onClick={() => onRestore?.(row.id)}>恢复</button>
          ) : (
            <MuteMenu
              row={row}
              todayIso={todayIso}
              open={open}
              setOpen={setOpen}
              onOpen={openFromButton}
              pos={pos}
              anchorRef={moreRef}
              menuRef={menuRef}
              onHide={onHide}
              onSnooze={onSnooze}
            />
          )}
        </span>
      </td>
    </tr>
  );
}

/**
 * @param {object} props
 * @param {Array} props.rows C4 WeekBoard row
 * @param {boolean} [props.showMentor]
 * @param {(id: string) => void} [props.onOpenStudent]
 * @param {(id: string) => void} [props.onJumpToDraft]
 * @param {Record<string, {mode: 'hidden'|'snoozed', until?: string}>} [props.mutes] 当前生效的隐藏 / 暂停（按学生 id）
 * @param {string} [props.todayIso]
 * @param {(id: string) => void} [props.onHide]
 * @param {(id: string, days: number) => void} [props.onSnooze]
 * @param {(id: string) => void} [props.onRestore]
 */
export default function WeekBoard({
  rows = [], showMentor = false, onOpenStudent, onJumpToDraft,
  mutes = {}, todayIso = todayISO(), onHide, onSnooze, onRestore,
}) {
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const muted = rows.filter((r) => mutes[r.id]);
  const visible = rows.filter((r) => !mutes[r.id]);
  const warn = visible.filter((r) => r.warn);
  const normal = visible.filter((r) => !r.warn);
  const cols = showMentor ? 6 : 5;
  const labels = headerLabels(rows);

  const tr = (row) => (
    <BoardRow
      key={row.id}
      row={row}
      showMentor={showMentor}
      mute={mutes[row.id]}
      todayIso={todayIso}
      onOpenStudent={onOpenStudent}
      onJumpToDraft={onJumpToDraft}
      onHide={onHide}
      onSnooze={onSnooze}
      onRestore={onRestore}
    />
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
                {muted.length > 0 && (
                  <tr className="md-grp md-hidden-head">
                    <td colSpan={cols}>
                      <button
                        type="button"
                        className="md-hidden-toggle"
                        aria-expanded={hiddenOpen}
                        onClick={() => setHiddenOpen((v) => !v)}
                      >
                        已隐藏 {muted.length} 人
                      </button>
                    </td>
                  </tr>
                )}
                {hiddenOpen && muted.map(tr)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
