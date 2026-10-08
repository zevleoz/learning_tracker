// 合并式自动保存（BUG-1 修复）：
// 同一页面常有多个独立的数据源各自触发保存（如 form_data / minutes_text / 日期字段）。
// 若每次都用单一定时器，后一次 patch 的 clearTimeout 会取消前一次不同字段的待存内容，
// 导致该字段的改动静默丢失。这里把所有待存 patch 合并到一个 pending 对象，
// 定时器到点一次性提交；失败时把内容合回 pending，下次改动或卸载时一并重试。
//
// 用法：
//   const { saveState, savedAt, persist } = useMergedAutosave((patch) => updateReport(id, patch));
//   useEffect(() => { if (form) persist({ form_data: form }); }, [form]);

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from './toast.js';

export function useMergedAutosave(save, { delay = 700 } = {}) {
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const firstRef = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;

  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [savedAt, setSavedAt] = useState('');

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    if (!patch) return;
    pendingRef.current = null;
    setSaveState('saving');
    try {
      await saveRef.current(patch);
      setSaveState('saved');
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      // 失败内容合回待存区，且不覆盖后续更新的值
      pendingRef.current = { ...patch, ...(pendingRef.current || {}) };
      setSaveState('idle');
      toast('自动保存失败，请检查网络', { kind: 'error' });
    }
  }, []);

  const persist = useCallback((patch) => {
    if (!patch) return;
    pendingRef.current = { ...(pendingRef.current || {}), ...patch };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, firstRef.current ? 0 : delay);
    firstRef.current = false;
  }, [delay, flush]);

  // 卸载时立即落盘，不等剩余延时
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const patch = pendingRef.current;
    if (patch) {
      pendingRef.current = null;
      Promise.resolve(saveRef.current(patch)).catch(() => {});
    }
  }, []);

  return { saveState, savedAt, persist, flush };
}