// 「今天」的键（本地 YYYY-MM-DD）。页面开着过了零点、或电脑休眠后重新打开标签页，
// 键会变化并触发重新渲染，E4 的「今天 / 待写报告」分组与相对日期才不会停在昨天。
import { useEffect, useState } from 'react';
import { toLocalDateStr } from './date.js';

export function msUntilNextMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime() + 500);
}

export function useDayKey() {
  const [key, setKey] = useState(() => toLocalDateStr(new Date()));
  useEffect(() => {
    let timer;
    const sync = () => setKey((k) => {
      const now = toLocalDateStr(new Date());
      return now === k ? k : now;
    });
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { sync(); arm(); }, msUntilNextMidnight());
    };
    const onVisible = () => { if (document.visibilityState === 'visible') { sync(); arm(); } };
    arm();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
  return key;
}
