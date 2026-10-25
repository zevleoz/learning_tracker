// 今日反馈：学生管理页顶部。折叠 = 一行计数；展开 = 待发 / 新生昨天没填 / 3 天以上没填 / 已发。
// 两份没填名单由页面用 attentionOf 在浏览器里实时算好传进来；草稿来自 useDrafts。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, StudentLink } from './FillStrip.jsx';
import { copyText, draftText } from './useDrafts.js';
import { draftKindLabel, evidenceLine, namesListText } from './fillInfo.js';
import { toast } from '../../lib/toast.js';

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onToggle
 * @param {object} props.dr useDrafts() 的返回值
 * @param {Array} props.newMissed  [{ id, name, advisor, color, detail, lastText }]
 * @param {Array} props.gapList    同上
 * @param {(id: string) => object} props.personOf 草稿用：{ name, advisor, color, info }
 * @param {(id: string) => void} props.onOpenStudent
 * @param {string|null} props.todayIso
 * @param {boolean} [props.hideShortcuts] 手机上不显示快捷键角标
 */
export default function TodayFeedback({ open, onToggle, dr, newMissed, gapList, personOf, onOpenStudent, todayIso, hideShortcuts = false }) {
  const draftsOn = dr.status === 'ready' || dr.status === 'loading' || dr.status === 'error';
  const pending = useMemo(() => dr.drafts.filter((d) => d.status === 'draft'), [dr.drafts]);
  const sent = useMemo(() => dr.drafts.filter((d) => d.status === 'sent'), [dr.drafts]);

  const [tab, setTab] = useState('pending');
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const skipBlurRef = useRef(false);
  const textRefs = useRef({});

  const tabs = useMemo(() => {
    const list = [];
    if (dr.status !== 'unavailable') list.push({ key: 'pending', label: '待发', count: pending.length });
    list.push({ key: 'newMissed', label: '新生昨天没填', count: newMissed.length });
    list.push({ key: 'gap', label: '3 天以上没填', count: gapList.length });
    if (dr.status !== 'unavailable') list.push({ key: 'sent', label: '已发', count: sent.length });
    return list;
  }, [dr.status, pending.length, newMissed.length, gapList.length, sent.length]);

  // 用户没手动选过页签时，当前页签没内容就落到第一个有内容的页签
  const pickedTabRef = useRef(false);
  useEffect(() => { if (!open) { pickedTabRef.current = false; setTab('pending'); } }, [open]);
  useEffect(() => {
    if (!open || dr.status === 'loading' || pickedTabRef.current) return;
    const cur = tabs.find((t) => t.key === tab);
    if (cur && cur.count > 0) return;
    const firstFilled = tabs.find((t) => t.count > 0);
    if (firstFilled && firstFilled.key !== tab) setTab(firstFilled.key);
  }, [open, tabs, tab, dr.status]);

  // 选中的草稿始终落在当前待发列表里
  useEffect(() => {
    if (!pending.some((d) => d.id === selectedId)) setSelectedId(pending[0]?.id ?? null);
  }, [pending, selectedId]);

  async function doCopy(d) {
    const r = await copyText(draftText(d), textRefs.current[d.id]);
    if (r === 'copied') toast('已复制', { kind: 'success' });
    else if (r === 'selected') toast('已选中文字，请按 Cmd/Ctrl + C 复制', { kind: 'info' });
    else toast('复制失败，请手动选中文字', { kind: 'error' });
  }

  async function doSent(d) {
    pickedTabRef.current = true; // 处理完最后一条后留在待发页签，不自动跳走
    const ok = await dr.markSent(d);
    if (ok) {
      const idx = pending.findIndex((x) => x.id === d.id);
      const next = pending[idx + 1] || pending[idx - 1];
      setSelectedId(next ? next.id : null);
    }
  }

  // 展开时：C 复制、E 标记已发（只作用于待发页签里选中的那条；输入框里不触发）
  useEffect(() => {
    if (!open || tab !== 'pending') return undefined;
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k !== 'c' && k !== 'e') return;
      const d = pending.find((x) => x.id === selectedId);
      if (!d) return;
      e.preventDefault();
      if (k === 'c') doCopy(d); else doSent(d);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const nothing = (!draftsOn || (pending.length === 0 && sent.length === 0)) && newMissed.length === 0 && gapList.length === 0;
  if (nothing) return null;

  const kbd = (k) => (hideShortcuts ? null : <kbd className="tf-kbd">{k}</kbd>);

  /* ---- 折叠：一行计数 ---- */
  const parts = [];
  if (draftsOn && pending.length > 0) parts.push(<span key="p" className="tf-part"><b>{pending.length}</b> 条待发</span>);
  if (newMissed.length > 0) parts.push(<span key="n" className="tf-part"><b className="is-bad">{newMissed.length}</b> 新生昨天没填</span>);
  if (gapList.length > 0) parts.push(<span key="g" className="tf-part"><b className="is-warn">{gapList.length}</b> 3 天以上没填</span>);
  if (parts.length === 0) parts.push(<span key="s" className="tf-part"><b>{sent.length}</b> 条已发</span>);

  if (!open) {
    return (
      <section className="tf tf--folded" aria-label="今日反馈">
        <button type="button" className="tf-head" onClick={onToggle} aria-expanded="false">
          <span className="tf-title">今日反馈</span>
          <span className="tf-counts">{parts}</span>
          <span className="tf-toggle">展开 {kbd('T')}</span>
        </button>
      </section>
    );
  }

  /* ---- 展开 ---- */
  const missedItems = tab === 'newMissed' ? newMissed : tab === 'gap' ? gapList : null;

  async function copyNames() {
    const title = tab === 'newMissed' ? '新生昨天没填' : '3 天以上没填';
    const text = namesListText(title, missedItems);
    const r = await copyText(text, null);
    if (r === 'copied') toast('名单已复制', { kind: 'success' });
    else toast('复制失败', { kind: 'error' });
  }

  function startEdit(d) {
    skipBlurRef.current = false;
    setEditingId(d.id);
    setEditText(draftText(d));
  }

  async function commitEdit(d) {
    if (skipBlurRef.current) { skipBlurRef.current = false; setEditingId(null); return; }
    setEditingId(null);
    await dr.saveEdit(d, editText);
  }

  function draftRow(d, readOnly) {
    const p = personOf(d.student_id);
    const isSel = !readOnly && d.id === selectedId;
    const busy = dr.busy[d.id];
    const evi = evidenceLine(d.evidence, dr.sessionById, todayIso);
    return (
      <div
        key={d.id}
        className={`tf-row ${isSel ? 'is-selected' : ''} ${readOnly ? 'is-sent' : ''}`}
        onClick={() => { if (!readOnly) setSelectedId(d.id); }}
      >
        <Avatar name={p.name} color={p.color} />
        <div className="tf-who">
          <StudentLink id={d.student_id} onOpen={onOpenStudent} className="tf-name">{p.name}</StudentLink>
          {p.advisor && <small>{p.advisor}</small>}
        </div>
        <div className="tf-kind">{draftKindLabel(d, p.info, todayIso)}</div>
        <div className="tf-main">
          {editingId === d.id ? (
            <textarea
              className="tf-edit"
              value={editText}
              rows={Math.max(2, Math.ceil(editText.length / 40))}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
              onBlur={() => commitEdit(d)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); skipBlurRef.current = true; e.currentTarget.blur(); }
              }}
            />
          ) : (
            <div
              ref={(el) => { textRefs.current[d.id] = el; }}
              className={`tf-text ${readOnly ? '' : 'is-editable'}`}
              title={readOnly ? undefined : '点击修改'}
              onClick={readOnly ? undefined : () => startEdit(d)}
            >
              {draftText(d)}
            </div>
          )}
          {evi && <div className="tf-evi">依据：{evi}</div>}
          {dr.errors[d.id] && <div className="tf-err" role="alert">{dr.errors[d.id]}</div>}
        </div>
        <div className="tf-acts">
          {readOnly ? (
            <button type="button" className="tf-btn" onClick={(e) => { e.stopPropagation(); doCopy(d); }}>复制</button>
          ) : (
            <>
              <button type="button" className="tf-btn tf-btn--primary" disabled={!!busy}
                onClick={(e) => { e.stopPropagation(); doCopy(d); }}>复制{isSel && kbd('C')}</button>
              <button type="button" className="tf-btn" disabled={!!busy}
                onClick={(e) => { e.stopPropagation(); doSent(d); }}>
                {busy === 'send' ? '处理中…' : <>已发{isSel && kbd('E')}</>}
              </button>
              <button type="button" className="tf-btn tf-btn--ghost" disabled={!!busy}
                onClick={(e) => { e.stopPropagation(); dr.regenerate(d); }}>
                {busy === 'regen' ? '生成中…' : '重新生成'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="tf tf--open" aria-label="今日反馈">
      <div className="tf-bar">
        <span className="tf-title">今日反馈</span>
        <div className="tf-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`tf-tab ${tab === t.key ? 'is-active' : ''}`}
              onClick={() => { pickedTabRef.current = true; setTab(t.key); }}
            >
              {t.label} <span className="tf-tab-n">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="tf-bar-right">
          {missedItems && missedItems.length > 0 && (
            <button type="button" className="tf-link" onClick={copyNames}>复制名单</button>
          )}
          <button type="button" className="tf-link" onClick={onToggle} aria-expanded="true">收起 {kbd('T')}</button>
        </div>
      </div>

      <div className="tf-list">
        {tab === 'pending' && (
          pending.length > 0 ? pending.map((d) => draftRow(d, false))
            : <div className="tf-empty">{dr.status === 'loading' ? '加载中…' : '没有待发的草稿'}</div>
        )}
        {tab === 'sent' && (
          sent.length > 0 ? sent.map((d) => draftRow(d, true))
            : <div className="tf-empty">今天还没有标记已发的反馈</div>
        )}
        {missedItems && (
          missedItems.length > 0 ? missedItems.map((it) => (
            <div key={it.id} className="tf-row tf-row--list">
              <Avatar name={it.name} color={it.color} />
              <div className="tf-who">
                <StudentLink id={it.id} onOpen={onOpenStudent} className="tf-name">{it.name}</StudentLink>
                {it.advisor && <small>{it.advisor}</small>}
              </div>
              <div className="tf-detail">{it.detail}</div>
              <div className="tf-last">最后记录 {it.lastText}</div>
            </div>
          )) : <div className="tf-empty">今天没有需要看的学生</div>
        )}
        {dr.status === 'error' && tab === 'pending' && (
          <div className="tf-err" role="alert">草稿暂时加载失败，刷新页面再试</div>
        )}
      </div>
    </section>
  );
}
