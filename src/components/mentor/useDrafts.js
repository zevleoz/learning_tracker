// 消息草稿数据（C3）：读 supervision_drafts，复制即已发、撤销、推迟、跳过、换说法、重写、历史。
// 表或 v2 字段还没建时 status = 'unavailable'，界面只显示空状态，不报错。

import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../../lib/logger.js';
import { toLocalDateStr } from '../../lib/date.js';
import { addDays, SNOOZE_DAYS, SKIP_REASONS } from '../../lib/supervision.js';

const COLS =
  'id, student_id, kind, period_start, period_end, body, edited_body, evidence, model, status, handled_by, handled_at, snooze_until, skip_reason, meta, created_at';

const HANDLED_STATUSES = ['sent', 'snoozed', 'skipped'];

export function isMissingTable(error) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205'
    || /relation .* does not exist|could not find the table|schema cache/i.test(error.message || '');
}

/** v2 新字段（snooze_until / skip_reason / meta）还没加时的报错 */
export function isMissingColumn(error) {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204'
    || /column .* does not exist|could not find the .* column|unknown field|schema cache/i.test(error.message || '');
}

const isSchemaUnavailable = (error) => isMissingTable(error) || isMissingColumn(error);

export const draftText = (d) => (d.edited_body ?? d.body) || '';

/**
 * 换说法：按 meta.alts 依次往下；当前是最后一条时返回 null（交给 regenerate）。
 * 当前正文等于某一版备选时从它的下一条开始，否则从第一条备选开始。
 */
export function nextAltText(draft) {
  const alts = (Array.isArray(draft?.meta?.alts) ? draft.meta.alts : []).filter(Boolean);
  if (alts.length === 0) return null;
  const current = draftText(draft).trim();
  const idx = alts.findIndex((a) => String(a).trim() === current);
  if (idx < 0) return alts[0];
  return idx + 1 < alts.length ? alts[idx + 1] : null;
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

/**
 * supabase / getAccessToken 由页面传入（页面本来就持有它们，也方便测试替换）。
 * @param {{ supabase: object, getAccessToken: () => Promise<string>, userId: string|undefined, studentIds: string[] }} p
 */
export function useDrafts({ supabase, getAccessToken, userId, studentIds }) {
  const [drafts, setDrafts] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | unavailable | error
  const [sessionById, setSessionById] = useState({});
  const [handlerNames, setHandlerNames] = useState({});
  const [busy, setBusy] = useState({});   // { [draftId]: 'regen' | 'save' | 'send' }
  const [errors, setErrors] = useState({}); // { [draftId]: 文案 }
  const idsKey = studentIds.join(',');
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!userId || studentIds.length === 0) {
      setDrafts([]); setHandlerNames({}); setStatus('idle'); return;
    }
    setStatus('loading');
    try {
      const startOfToday = new Date(`${toLocalDateStr(new Date())}T00:00:00`).toISOString();
      const [open, handled] = await Promise.all([
        supabase.from('supervision_drafts').select(COLS)
          .in('student_id', studentIds).eq('status', 'draft')
          .order('created_at', { ascending: false }).limit(300),
        supabase.from('supervision_drafts').select(COLS)
          .in('student_id', studentIds).in('status', HANDLED_STATUSES).gte('handled_at', startOfToday)
          .order('handled_at', { ascending: false }).limit(300),
      ]);
      if (!aliveRef.current) return;
      const err = open.error || handled.error;
      if (err) {
        if (isSchemaUnavailable(err)) { setDrafts([]); setStatus('unavailable'); return; }
        logger.error('supervision_drafts load failed:', err);
        setStatus('error');
        return;
      }
      const rows = [...(open.data || []), ...(handled.data || [])];
      setDrafts(rows);
      setStatus('ready');

      const handlers = [...new Set(rows.map((r) => r.handled_by).filter((id) => id && id !== userId))];
      if (handlers.length > 0) {
        const { data, error: pErr } = await supabase.from('profiles').select('id, full_name').in('id', handlers);
        if (!aliveRef.current) return;
        if (pErr) logger.warn('handler profiles load failed:', pErr);
        else setHandlerNames(Object.fromEntries((data || []).map((p) => [p.id, p.full_name || ''])));
      } else {
        setHandlerNames({});
      }

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

  /** 乐观更新 + 失败回滚；没有 UPDATE 策略时更新 0 行也不报错，不能假装成功 */
  const commit = useCallback(async (draft, patch, busyKey, errorPrefix) => {
    const before = {};
    for (const key of Object.keys(patch)) before[key] = draft[key];
    setBusyFor(draft.id, busyKey); setErrorFor(draft.id, null);
    patchLocal(draft.id, patch);
    const { data, error } = await supabase.from('supervision_drafts').update(patch).eq('id', draft.id).select('id');
    setBusyFor(draft.id, null);
    if (error) {
      patchLocal(draft.id, before);
      setErrorFor(draft.id, `${errorPrefix}：${error.message}`);
      return false;
    }
    if (!data || data.length === 0) {
      patchLocal(draft.id, before);
      setErrorFor(draft.id, `${errorPrefix}：没有权限修改这条草稿`);
      return false;
    }
    return true;
  }, []);

  /** 保存编辑后的正文；与 AI 原稿一致时清空 edited_body */
  const saveEdit = useCallback(async (draft, text) => {
    const next = (text || '').trim();
    if (!next || next === draftText(draft).trim()) return true;
    const edited = next === (draft.body || '').trim() ? null : next;
    setBusyFor(draft.id, 'save'); setErrorFor(draft.id, null);
    patchLocal(draft.id, { edited_body: edited });
    const { data, error } = await supabase.from('supervision_drafts').update({ edited_body: edited }).eq('id', draft.id).select('id');
    setBusyFor(draft.id, null);
    if (error || !data || data.length === 0) {
      patchLocal(draft.id, { edited_body: draft.edited_body ?? null });
      setErrorFor(draft.id, `保存失败：${error?.message || '没有权限修改这条草稿'}`);
      return false;
    }
    return true;
  }, []);

  /** 标记已发（复制即已发）。保留给旧页面过渡用，C3 的新组件用 copyAndSend。 */
  const markSent = useCallback(async (draft) => {
    if (!userId) return false;
    return commit(
      draft,
      { status: 'sent', handled_by: userId, handled_at: new Date().toISOString() },
      'send',
      '标记失败',
    );
  }, [userId, commit]);

  /** 复制并记为已发：'copied' | 'selected' | 'failed' */
  const copyAndSend = useCallback(async (draft, fallbackEl) => {
    const result = await copyText(draftText(draft), fallbackEl);
    if (result !== 'failed') await markSent(draft);
    return result;
  }, [markSent]);

  /** 撤销：回到待发，清掉处理人和时间、推迟日期、跳过原因 */
  const undo = useCallback(async (draft) => commit(
    draft,
    { status: 'draft', handled_by: null, handled_at: null, snooze_until: null, skip_reason: null },
    'undo',
    '撤销失败',
  ), [commit]);

  /** 过几天再说：status = snoozed，snooze_until = 今天 + days */
  const snooze = useCallback(async (draft, days) => {
    if (!SNOOZE_DAYS.includes(days)) return false;
    const until = addDays(toLocalDateStr(new Date()), days);
    return commit(
      draft,
      { status: 'snoozed', snooze_until: until, handled_by: userId, handled_at: new Date().toISOString() },
      'send',
      '推迟失败',
    );
  }, [commit, userId]);

  /** 不用发 */
  const skip = useCallback(async (draft) => commit(
    draft,
    { status: 'skipped', handled_by: userId, handled_at: new Date().toISOString() },
    'send',
    '标记失败',
  ), [commit, userId]);

  /** 跳过原因：当面说过了 / 请假了 / 这条写得不合适，或 null */
  const setSkipReason = useCallback(async (draft, reason) => {
    if (reason != null && !SKIP_REASONS.includes(reason)) return false;
    return commit(draft, { skip_reason: reason }, 'save', '保存失败');
  }, [commit]);

  /** 换说法：本地依次换 meta.alts，写到 edited_body；没有下一条时返回 null */
  const nextAlt = useCallback(async (draft) => {
    const text = nextAltText(draft);
    if (text == null) return null;
    const edited = text.trim() === (draft.body || '').trim() ? null : text;
    patchLocal(draft.id, { edited_body: edited });
    const { data, error } = await supabase.from('supervision_drafts').update({ edited_body: edited }).eq('id', draft.id).select('id');
    if (error || !data || data.length === 0) {
      patchLocal(draft.id, { edited_body: draft.edited_body ?? null });
      setErrorFor(draft.id, `保存失败：${error?.message || '没有权限修改这条草稿'}`);
    }
    return text;
  }, []);

  /** 重新生成（备选用完时用）；服务端已丢弃这条（409）就悄悄从列表里移掉 */
  const regenerate = useCallback(async (draft) => {
    setBusyFor(draft.id, 'regen'); setErrorFor(draft.id, null);
    try {
      const res = await fetch('/api/supervision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
        body: JSON.stringify({ type: 'regenerate', draft_id: draft.id }),
      });
      if (res.status === 409) {
        setDrafts((list) => list.filter((d) => d.id !== draft.id));
        return true;
      }
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

  /** 发过的消息：最近 30 天，除待发和已丢弃外的全部状态 */
  const loadHistory = useCallback(async (studentId) => {
    if (!studentId) return [];
    const from = addDays(toLocalDateStr(new Date()), -30);
    const { data, error } = await supabase.from('supervision_drafts').select(COLS)
      .eq('student_id', studentId).in('status', HANDLED_STATUSES)
      .gte('handled_at', `${from}T00:00:00`)
      .order('handled_at', { ascending: false }).limit(200);
    if (error) {
      if (isSchemaUnavailable(error)) return [];
      logger.warn('supervision_drafts history load failed:', error);
      return [];
    }
    return data || [];
  }, []);

  /** handled_by → 姓名；当前用户显示「你」，查不到显示「—」 */
  const handlerName = useCallback((id) => {
    if (!id) return '—';
    if (userId && id === userId) return '你';
    return handlerNames[id] || '—';
  }, [handlerNames, userId]);

  return {
    drafts,
    status,
    sessionById,
    busy,
    errors,
    handlerName,
    copyAndSend,
    undo,
    saveEdit,
    snooze,
    skip,
    setSkipReason,
    nextAlt,
    regenerate,
    loadHistory,
    reload: load,
    // 过渡：旧页面（今日反馈 / 学生侧栏）还在用，WS-6 删掉后即可移除
    markSent,
  };
}
