// 今日反馈的草稿数据：读 supervision_drafts，编辑 / 标记已发 / 重新生成。
// 表还没建（42P01 / PGRST205）时 status = 'unavailable'，界面只显示两份没填名单，不报错。

import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../../lib/logger.js';
import { toLocalDateStr } from '../../lib/date.js';

const COLS =
  'id, student_id, kind, period_start, period_end, body, edited_body, evidence, model, status, handled_by, handled_at, created_at';

export function isMissingTable(error) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205'
    || /relation .* does not exist|could not find the table|schema cache/i.test(error.message || '');
}

export const draftText = (d) => (d.edited_body ?? d.body) || '';

/**
 * supabase / getAccessToken 由页面传入（页面本来就持有它们，也方便测试替换）。
 * @param {{ supabase: object, getAccessToken: () => Promise<string>, userId: string|undefined, studentIds: string[] }} p
 */
export function useDrafts({ supabase, getAccessToken, userId, studentIds }) {
  const [drafts, setDrafts] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | unavailable | error
  const [sessionById, setSessionById] = useState({});
  const [busy, setBusy] = useState({});   // { [draftId]: 'regen' | 'save' | 'send' }
  const [errors, setErrors] = useState({}); // { [draftId]: 文案 }
  const idsKey = studentIds.join(',');
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!userId || studentIds.length === 0) { setDrafts([]); setStatus('idle'); return; }
    setStatus('loading');
    try {
      const startOfToday = new Date(`${toLocalDateStr(new Date())}T00:00:00`).toISOString();
      const [open, sent] = await Promise.all([
        supabase.from('supervision_drafts').select(COLS)
          .in('student_id', studentIds).eq('status', 'draft')
          .order('created_at', { ascending: false }).limit(300),
        supabase.from('supervision_drafts').select(COLS)
          .in('student_id', studentIds).eq('status', 'sent').gte('handled_at', startOfToday)
          .order('handled_at', { ascending: false }).limit(300),
      ]);
      if (!aliveRef.current) return;
      const err = open.error || sent.error;
      if (err) {
        if (isMissingTable(err)) { setDrafts([]); setStatus('unavailable'); return; }
        logger.error('supervision_drafts load failed:', err);
        setStatus('error');
        return;
      }
      const rows = [...(open.data || []), ...(sent.data || [])];
      setDrafts(rows);
      setStatus('ready');

      // 「依据」要显示的记录
      const ids = [...new Set(rows.flatMap((r) => (Array.isArray(r.evidence) ? r.evidence : [])
        .map((e) => (e && typeof e === 'object' ? e.id : e)).filter(Boolean)))];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('learning_sessions')
          .select('id, session_date, category, grade_label, score, course:course_id(name, subject)')
          .in('id', ids.slice(0, 400));
        if (!aliveRef.current) return;
        if (error) logger.warn('evidence sessions load failed:', error);
        else setSessionById(Object.fromEntries((data || []).map((s) => [s.id, s])));
      }
    } catch (e) {
      logger.error('supervision_drafts load threw:', e);
      if (aliveRef.current) setStatus('error');
    }
  }, [userId, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const setBusyFor = (id, v) => setBusy((b) => { const n = { ...b }; if (v) n[id] = v; else delete n[id]; return n; });
  const setErrorFor = (id, v) => setErrors((e) => { const n = { ...e }; if (v) n[id] = v; else delete n[id]; return n; });
  const patchLocal = (id, patch) => setDrafts((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  /** 保存编辑后的正文；与 AI 原稿一致时清空 edited_body */
  const saveEdit = useCallback(async (draft, text) => {
    const next = (text || '').trim();
    if (!next || next === draftText(draft).trim()) return true;
    const edited = next === (draft.body || '').trim() ? null : next;
    setBusyFor(draft.id, 'save'); setErrorFor(draft.id, null);
    const { error } = await supabase.from('supervision_drafts').update({ edited_body: edited }).eq('id', draft.id);
    setBusyFor(draft.id, null);
    if (error) { setErrorFor(draft.id, `保存失败：${error.message}`); return false; }
    patchLocal(draft.id, { edited_body: edited });
    return true;
  }, []);

  const markSent = useCallback(async (draft) => {
    if (!userId) return false;
    setBusyFor(draft.id, 'send'); setErrorFor(draft.id, null);
    const patch = { status: 'sent', handled_by: userId, handled_at: new Date().toISOString() };
    const { data, error } = await supabase.from('supervision_drafts').update(patch).eq('id', draft.id).select('id');
    setBusyFor(draft.id, null);
    if (error) { setErrorFor(draft.id, `标记失败：${error.message}`); return false; }
    // 没有 UPDATE 策略时更新 0 行也不报错，不能假装成功
    if (!data || data.length === 0) { setErrorFor(draft.id, '标记失败：没有权限修改这条草稿'); return false; }
    patchLocal(draft.id, patch);
    return true;
  }, [userId]);

  const regenerate = useCallback(async (draft) => {
    setBusyFor(draft.id, 'regen'); setErrorFor(draft.id, null);
    try {
      const res = await fetch('/api/supervision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
        body: JSON.stringify({ type: 'regenerate', draft_id: draft.id }),
      });
      let json = null;
      try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
      if (!res.ok) {
        setErrorFor(draft.id, json?.error || json?.message || `重新生成失败（${res.status}）`);
        return false;
      }
      const next = json?.draft || json;
      if (next && next.id) setDrafts((list) => list.map((d) => (d.id === draft.id ? { ...d, ...next } : d)));
      else await load();
      return true;
    } catch (e) {
      setErrorFor(draft.id, `重新生成失败：${e?.message || '网络错误'}`);
      return false;
    } finally {
      setBusyFor(draft.id, null);
    }
  }, [load]);

  return { drafts, status, sessionById, busy, errors, saveEdit, markSent, regenerate, reload: load };
}

/** 复制文字；剪贴板不可用时选中 fallbackEl 里的文字，让用户自己按 Cmd/Ctrl+C */
export async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    try {
      if (fallbackEl) {
        const range = document.createRange();
        range.selectNodeContents(fallbackEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return 'selected';
      }
    } catch { /* ignore */ }
    return 'failed';
  }
}
