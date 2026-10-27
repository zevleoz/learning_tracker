// 导师端：隐藏 / 暂停学生（supervision_mutes）。
// 一人最多一行：hidden 永久；snoozed 到 until（含）为止，过期后自动回到主列表。
// 表还没建时静默降级（mutes 为空），页面照常可用。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../../lib/logger.js';
import { toLocalDateStr } from '../../lib/date.js';
import { addDays, SNOOZE_DAYS } from '../../lib/supervision.js';
import { isMissingTable } from './useDrafts.js';

export const MUTE_COLS = 'student_id, mode, until, reason, set_by, set_at';

const dayOf = (v) => String(v || '').slice(0, 10);

/** 这一行现在是否生效：hidden 永久；snoozed 到 until（含）为止 */
export function muteIsActive(mute, todayIso) {
  if (!mute) return false;
  if (mute.mode === 'hidden') return true;
  if (mute.mode !== 'snoozed') return false;
  return Boolean(mute.until) && dayOf(mute.until) >= dayOf(todayIso);
}

/**
 * @param {{ supabase: object, userId: string|undefined, todayIso?: string }} p
 * @returns {{
 *   mutes: Record<string, object>, activeMutes: Record<string, object>, status: string,
 *   hide: (id: string) => Promise<boolean>, snooze: (id: string, days: number) => Promise<boolean>,
 *   restore: (id: string) => Promise<boolean>, reload: () => Promise<void>,
 * }}
 */
export function useMutes({ supabase, userId, todayIso = toLocalDateStr(new Date()) }) {
  const [mutes, setMutes] = useState({}); // student_id → row
  const [status, setStatus] = useState('idle'); // idle | loading | ready | unavailable | error
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!userId) { setMutes({}); setStatus('idle'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase.from('supervision_mutes').select(MUTE_COLS).limit(1000);
      if (!aliveRef.current) return;
      if (error) {
        if (isMissingTable(error)) { setMutes({}); setStatus('unavailable'); return; }
        logger.error('supervision_mutes load failed:', error);
        setStatus('error');
        return;
      }
      setMutes(Object.fromEntries((data || []).map((r) => [r.student_id, r])));
      setStatus('ready');
    } catch (e) {
      logger.error('supervision_mutes load threw:', e);
      if (aliveRef.current) setStatus('error');
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (studentId, patch) => {
    if (!userId || !studentId) return false;
    const row = {
      student_id: studentId,
      until: null,
      reason: null,
      ...patch,
      set_by: userId,
      set_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('supervision_mutes')
      .upsert(row, { onConflict: 'student_id' })
      .select(MUTE_COLS);
    if (error) {
      logger.error('supervision_mutes save failed:', error);
      return false;
    }
    if (!data || data.length === 0) {
      logger.warn('supervision_mutes save affected 0 rows');
      return false;
    }
    setMutes((m) => ({ ...m, [studentId]: data[0] }));
    return true;
  }, [userId]);

  const hide = useCallback((id) => save(id, { mode: 'hidden', until: null }), [save]);

  const snooze = useCallback((id, days) => {
    if (!SNOOZE_DAYS.includes(days)) return Promise.resolve(false);
    return save(id, { mode: 'snoozed', until: addDays(todayIso, days) });
  }, [save, todayIso]);

  const restore = useCallback(async (id) => {
    if (!userId || !id) return false;
    // 乐观移除：恢复后立即回到主列表
    setMutes((m) => { const n = { ...m }; delete n[id]; return n; });
    const { error } = await supabase.from('supervision_mutes').delete().eq('student_id', id);
    if (error) {
      logger.error('supervision_mutes restore failed:', error);
      await load();
      return false;
    }
    return true;
  }, [userId, load]);

  const activeMutes = useMemo(
    () => Object.fromEntries(Object.entries(mutes).filter(([, m]) => muteIsActive(m, todayIso))),
    [mutes, todayIso],
  );

  return { mutes, activeMutes, status, hide, snooze, restore, reload: load };
}
