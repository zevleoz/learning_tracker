// 数据分析页顶部：一位学生的消息面板。
// 左边是今天的消息卡片（MessageCard），右边是最近发过的消息和提醒间隔。
// 数据都来自页面传入的 dr（useDrafts 的返回值），这里不发请求、不写数据库。

import { useCallback, useEffect, useRef, useState } from 'react';
import MessageCard from './MessageCard.jsx';
import { toLocalDateStr } from '../../lib/date.js';
import '../../styles/mentor-student-panel.css';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const draftTextOf = (d) => (d?.edited_body ?? d?.body) || '';

/** 消息类型：每日表扬 / 周小结 / 周小结 + 提醒 / 提醒 */
export function kindLabel(d) {
  if (!d) return '';
  if (d.kind === 'nudge') return '提醒';
  if (d.kind === 'weekly') return d.meta?.nudge ? '周小结 + 提醒' : '周小结';
  return '每日表扬';
}

/** 'YYYY-MM-DD' → 'M/D' */
function formatMD(iso) {
  if (!iso) return '';
  const [, m, d] = String(iso).slice(0, 10).split('-');
  if (!m || !d) return '';
  return `${Number(m)}/${Number(d)}`;
}

/** 时间戳 → 'M/D 周X'；今天显示「今天」 */
export function dateLabel(iso, todayIso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = toLocalDateStr(date);
  const tail = day === todayIso ? '今天' : WEEKDAY[date.getDay()];
  return `${formatMD(day)} ${tail}`;
}

const timeOf = (d) => {
  const t = new Date(d?.handled_at || d?.created_at || '').getTime();
  return Number.isNaN(t) ? 0 : t;
};

const isReminder = (d) => d?.kind === 'nudge' || d?.meta?.nudge === true;

function statusLabel(d) {
  if (d.status === 'sent') return '已发';
  if (d.status === 'snoozed') return d.snooze_until ? `推迟到 ${formatMD(d.snooze_until)}` : '推迟';
  if (d.status === 'skipped') return d.skip_reason ? `不用发 · ${d.skip_reason}` : '不用发';
  return '';
}

/**
 * @param {{
 *   student: { id: string },
 *   person: { id, name, stageText, school, consultant, mentorName },
 *   draft: object|null,
 *   dr: object,
 *   todayIso: string,
 *   showMentor: boolean,
 * }} props
 */
export default function StudentMessagesPanel({ student, person, draft, dr, todayIso, showMentor }) {
  const studentId = student?.id;
  const draftStatus = draft?.status || 'none';
  const [history, setHistory] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [expanded, setExpanded] = useState(false);

  // loadHistory 可能是每次渲染新建的函数，放进 ref 里，避免 effect 反复触发
  const loadRef = useRef(dr?.loadHistory);
  loadRef.current = dr?.loadHistory;

  useEffect(() => {
    setExpanded(false);
  }, [studentId]);

  useEffect(() => {
    if (!studentId) { setHistory([]); setState('ready'); return undefined; }
    const load = loadRef.current;
    if (typeof load !== 'function') { setHistory([]); setState('ready'); return undefined; }
    let alive = true;
    setState('loading');
    Promise.resolve()
      .then(() => load(studentId))
      .then((rows) => {
        if (!alive) return;
        setHistory(Array.isArray(rows) ? rows : []);
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setHistory([]);
        setState('error');
      });
    return () => { alive = false; };
  }, [studentId, draftStatus]);

  const handlerName = useCallback((id) => {
    if (!id || typeof dr?.handlerName !== 'function') return '';
    return dr.handlerName(id) || '';
  }, [dr]);

  const sorted = [...history].sort((a, b) => timeOf(b) - timeOf(a));
  const shown = expanded ? sorted : sorted.slice(0, 3);
  const lastReminder = sorted.find((d) => isReminder(d) && d.status === 'sent');
  const lastReminderDate = lastReminder ? dateLabel(lastReminder.handled_at || lastReminder.created_at, todayIso) : '';

  if (!draft && state === 'ready' && sorted.length === 0) {
    return (
      <div className="smp-root smp-root--quiet">
        <p className="smp-quiet">还没有给这位学生的消息。</p>
      </div>
    );
  }
  if (!draft && state === 'loading') return null;

  return (
    <div className="smp-root">
      <section className="smp-panel" aria-label="这位学生的消息">
        <div className="smp-col">
          <h3 className="smp-h">今天的消息</h3>
          {draft ? (
            <MessageCard
              draft={draft}
              person={person}
              variant="detail"
              showMentor={showMentor}
              dr={dr}
              todayIso={todayIso}
            />
          ) : (
            <p className="smp-quiet">今天没有要发的消息。</p>
          )}
        </div>

        <div className="smp-col">
          <h3 className="smp-h">发过的消息</h3>
          {state === 'error' ? (
            <p className="smp-quiet">消息读取失败，稍后再看。</p>
          ) : sorted.length === 0 ? (
            <p className="smp-quiet">还没发过消息。</p>
          ) : (
            <>
              <ul className="smp-hist">
                {shown.map((d) => {
                  const who = handlerName(d.handled_by);
                  const status = statusLabel(d);
                  return (
                    <li key={d.id} className="smp-item">
                      <div className="smp-item-top">
                        <span className="smp-date">{dateLabel(d.handled_at || d.created_at, todayIso)}</span>
                        <span className="smp-kind">{kindLabel(d)}</span>
                        <span className="smp-status">{who ? `${who} ${status}` : status}</span>
                      </div>
                      {d.status === 'skipped' ? null : <p className="smp-text">{draftTextOf(d)}</p>}
                    </li>
                  );
                })}
              </ul>
              {sorted.length > 3 && (
                <button
                  type="button"
                  className="smp-toggle"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? '收起' : `全部 ${sorted.length} 条`}
                </button>
              )}
            </>
          )}
          <p className="smp-rule">
            上次提醒：{lastReminderDate || '没有'}。同一个学生两次提醒至少隔 3 天。
          </p>
        </div>
      </section>
    </div>
  );
}
