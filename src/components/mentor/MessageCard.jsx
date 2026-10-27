// 待发消息卡片（今天 tab / 学生消息面板共用）。
// 复制就算已发：复制后由 dr 把 status 改成 sent，卡片折叠成一行，可撤销。
// dr 是 useDrafts() 的返回值（C3），这里只调用它暴露的方法，不自己读写草稿。

import { useEffect, useRef, useState } from 'react';
import '../../styles/mentor-desk.css';
import { SNOOZE_DAYS, SKIP_REASONS, addDays } from '../../lib/supervision.js';
import { todayISO } from '../../lib/date.js';
import { toast } from '../../lib/toast.js';

const CATEGORY_LABEL = { 1: '学习', 2: '复习', 3: '练习' };
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export const draftBody = (draft) => (draft?.edited_body ?? draft?.body) || '';

/** 卡片右上角的类型文案：每日表扬 / 周小结 / 周小结 + 提醒 / 提醒 */
export function kindLabelOf(draft) {
  if (!draft) return '';
  if (draft.kind === 'nudge') return '提醒';
  if (draft.kind === 'weekly') return draft.meta?.nudge ? '周小结 + 提醒' : '周小结';
  return '每日表扬';
}

/** 表扬 = 绿色，提醒 = 琥珀色（周小结带提醒也算提醒） */
export function kindToneOf(draft) {
  if (!draft) return 'praise';
  return draft.kind === 'nudge' || (draft.kind === 'weekly' && draft.meta?.nudge) ? 'nudge' : 'praise';
}

/** 'YYYY-MM-DD' → 'M/D' */
export function shortMD(iso) {
  const [, m, d] = String(iso || '').slice(0, 10).split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : '';
}

export function weekdayCN(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : `周${WEEKDAY[d.getDay()]}`;
}

function dateWord(iso, todayIso) {
  const day = String(iso || '').slice(0, 10);
  if (!day) return '';
  if (todayIso && day === todayIso) return '今天';
  if (todayIso && day === addDays(todayIso, -1)) return '昨天';
  return shortMD(day);
}

function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** meta.facts（代码算出来的「依据」） + 草稿对应的记录 */
function evidenceRows(draft, sessionById, todayIso) {
  const ids = (Array.isArray(draft?.evidence) ? draft.evidence : [])
    .map((e) => (e && typeof e === 'object' ? e.id : e))
    .filter(Boolean);
  const out = [];
  for (const id of ids) {
    const s = sessionById?.[id];
    if (!s) continue;
    const course = s.course?.name || s.course?.subject || '';
    const grade = s.grade_label && s.grade_label !== 'N/A' ? s.grade_label : null;
    out.push([
      dateWord(s.session_date, todayIso),
      course,
      CATEGORY_LABEL[s.category] || '',
      grade,
    ].filter(Boolean).join(' · '));
  }
  return out;
}

function NameLink({ id, name, onOpenStudent }) {
  return (
    <button type="button" className="md-link" onClick={() => onOpenStudent?.(id)}>
      {name}
    </button>
  );
}

function Avatar({ name, small = false }) {
  return (
    <span className={`md-av ${small ? 'md-av--sm' : ''}`} aria-hidden="true">
      {(name || '?').charAt(0)}
    </span>
  );
}

/**
 * @param {object} props
 * @param {object} props.draft supervision_drafts 行
 * @param {{ id: string, name: string, stageText?: string, school?: string, consultant?: string, mentorName?: string }} props.person
 * @param {'queue'|'detail'} [props.variant] detail：不显示头像和名字行，正文从左边缘开始
 * @param {boolean} [props.showMentor] 管理员视图多显示「导师」
 * @param {object} props.dr useDrafts() 的返回值（C3）
 * @param {string} [props.todayIso]
 * @param {(id: string) => void} [props.onOpenStudent] 点学生名字 → 数据分析
 */
export default function MessageCard({
  draft,
  person,
  variant = 'queue',
  showMentor = false,
  dr,
  todayIso,
  onOpenStudent,
}) {
  const detail = variant === 'detail';
  const rootRef = useRef(null);
  const bubbleRef = useRef(null);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [eviOpen, setEviOpen] = useState(false);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (!draft) return null;
  if (draft.status === 'dropped') return null;

  const p = person || {};
  const name = p.name || '(未命名)';
  const status = draft.status;
  const busy = dr?.busy?.[draft.id];
  const error = dr?.errors?.[draft.id];
  const handler = dr?.handlerName ? dr.handlerName(draft.handled_by) : '你';
  const meta = draft.meta || {};
  const facts = Array.isArray(meta.facts) ? meta.facts.filter(Boolean) : [];
  const records = evidenceRows(draft, dr?.sessionById, todayIso);
  const hasEvidence = facts.length > 0 || records.length > 0;
  const isNudge = kindToneOf(draft) === 'nudge';
  const when = draft.snooze_until
    ? `${shortMD(draft.snooze_until)} ${weekdayCN(draft.snooze_until)}`.trim()
    : '';

  /* ---- 处理过的折叠行 ---- */
  if (status === 'sent') {
    const mine = handler === '你';
    return (
      <div className="md-root md-done" data-draft-id={draft.id}>
        <Avatar name={name} small />
        <span>
          {mine ? (
            <>已复制给 <b><NameLink id={p.id} name={name} onOpenStudent={onOpenStudent} /></b>，记为已发</>
          ) : (
            <>
              <b>{handler}</b> {timeOf(draft.handled_at)} 已发给{' '}
              <b><NameLink id={p.id} name={name} onOpenStudent={onOpenStudent} /></b>
            </>
          )}
        </span>
        {mine && (
          <button type="button" className="md-undo" onClick={() => dr?.undo(draft)}>撤销</button>
        )}
      </div>
    );
  }

  if (status === 'snoozed') {
    return (
      <div className="md-root md-done" data-draft-id={draft.id}>
        <Avatar name={name} small />
        <span>
          <b><NameLink id={p.id} name={name} onOpenStudent={onOpenStudent} /></b>
          ：{when} 按那时的记录重新写一条
          {isNudge ? '；这之前记了就不提醒了' : ''}
        </span>
        <button type="button" className="md-undo" onClick={() => dr?.undo(draft)}>撤销</button>
      </div>
    );
  }

  if (status === 'skipped') {
    return (
      <div className="md-root md-done" data-draft-id={draft.id}>
        <Avatar name={name} small />
        <span>
          不给 <b><NameLink id={p.id} name={name} onOpenStudent={onOpenStudent} /></b> 发这条
        </span>
        <span className="md-reasons">
          {SKIP_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className={draft.skip_reason === reason ? 'on' : ''}
              aria-pressed={draft.skip_reason === reason}
              onClick={() => dr?.setSkipReason(draft, draft.skip_reason === reason ? null : reason)}
            >
              {reason}
            </button>
          ))}
        </span>
        <button type="button" className="md-undo" onClick={() => dr?.undo(draft)}>撤销</button>
      </div>
    );
  }

  /* ---- 待发 ---- */
  const body = draftBody(draft);
  const snoozeBase = todayIso || todayISO();
  const recommend = meta.recommend_snooze;

  async function doCopy() {
    if (!dr?.copyAndSend) return;
    const result = await dr.copyAndSend(draft, bubbleRef.current);
    if (result === 'copied') toast(`已复制，去微信发给${name}吧`);
    else if (result === 'selected') toast('已选中文字，请按 Cmd/Ctrl + C 复制');
    else toast('复制失败，请手动选中文字', { kind: 'error' });
  }

  function startEdit() {
    setEditText(body);
    setEditing(true);
  }

  async function commitEdit() {
    const ok = await dr?.saveEdit?.(draft, editText);
    if (ok !== false) setEditing(false);
  }

  function nextAlt() {
    const next = dr?.nextAlt?.(draft);
    if (next == null) dr?.regenerate?.(draft);
    else setPulse((n) => n + 1);
  }

  return (
    <article
      ref={rootRef}
      id={`md-msg-${draft.id}`}
      data-draft-id={draft.id}
      data-student-id={p.id}
      className={`md-root md-msg ${detail ? 'md-msg--detail' : ''}`}
    >
      <div className="md-msg-head">
        {!detail && (
          <>
            <Avatar name={name} />
            <div className="md-who">
              <b>{p.id ? <NameLink id={p.id} name={name} onOpenStudent={onOpenStudent} /> : name}</b>
              <span className="md-person-meta">
                {[p.stageText, p.school, p.consultant].filter(Boolean).join(' · ')}
                {showMentor && p.mentorName ? ` · 导师 ${p.mentorName}` : ''}
              </span>
            </div>
          </>
        )}
        <div className={`md-why ${detail ? 'md-why--detail' : ''}`}>
          <span className={`md-kind md-kind--${kindToneOf(draft)}`}>{kindLabelOf(draft)}</span>
          {meta.why ? <>{detail ? ' · ' : <br />}{meta.why}</> : null}
        </div>
      </div>

      {editing ? (
        <div className="md-edit">
          <textarea
            value={editText}
            autoFocus
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
          />
        </div>
      ) : (
        <div
          key={`bubble-${pulse}`}
          ref={bubbleRef}
          className={`md-bubble ${pulse ? 'md-bubble--in' : ''}`}
        >
          {body}
        </div>
      )}

      {!editing && meta.system_push_date && (
        <div className="md-note">
          系统 {shortMD(meta.system_push_date)} 已经推送过一次「几天没记录」的提醒。今天再发容易像在催，
          可以过 {recommend || 3} 天再说。
        </div>
      )}

      {!editing && Array.isArray(meta.lint) && meta.lint.length > 0 && (
        <div className="md-lint">这条可能有和记录对不上的地方，发之前看一眼</div>
      )}

      {!editing && eviOpen && hasEvidence && (
        <div className="md-evi">
          {facts.map((line, i) => <div key={`f-${i}`}>{line}</div>)}
          {records.map((line, i) => <div key={`r-${i}`}>{line}</div>)}
        </div>
      )}

      {error && <div className="md-err" role="alert">{error}</div>}

      <div className="md-acts">
        {editing ? (
          <>
            <button type="button" className="md-btn md-btn--primary" onClick={commitEdit}>保存</button>
            <button type="button" className="md-btn md-btn--plain" onClick={() => setEditing(false)}>取消</button>
          </>
        ) : (
          <>
            <button type="button" className="md-btn md-btn--primary" disabled={!!busy} onClick={doCopy}>
              {busy === 'send' ? '复制中…' : '复制'}
            </button>
            <button type="button" className="md-btn" disabled={!!busy} onClick={startEdit}>改一下</button>
            <button
              type="button"
              className="md-btn"
              disabled={!!busy}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              过几天再说
            </button>
            <button type="button" className="md-btn md-btn--plain" disabled={!!busy} onClick={() => dr?.skip?.(draft)}>
              不用发
            </button>
            <span className="md-sp" />
            <button type="button" className="md-btn md-btn--plain" disabled={!!busy} onClick={nextAlt}>换个说法</button>
            {hasEvidence && (
              <button
                type="button"
                className="md-btn md-btn--plain"
                aria-expanded={eviOpen}
                onClick={() => setEviOpen((v) => !v)}
              >
                {eviOpen ? '收起依据' : '依据'}
              </button>
            )}

            {menuOpen && (
              <div className="md-menu" role="menu">
                <div className="md-menu-lbl">到时候按最新的记录重新写一条</div>
                {SNOOZE_DAYS.map((days) => {
                  const date = addDays(snoozeBase, days);
                  return (
                    <button
                      key={days}
                      type="button"
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); dr?.snooze?.(draft, days); }}
                    >
                      <span>
                        {days} 天后
                        {recommend === days ? <span className="md-rec"> · 建议</span> : null}
                      </span>
                      <small>{shortMD(date)} {weekdayCN(date)}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
