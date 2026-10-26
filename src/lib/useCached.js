import { useCallback, useEffect, useReducer, useRef } from 'react';
import { load, needsRefresh, peek, status, subscribe } from './studentCache.js';
import { logger } from './logger.js';

/**
 * 读缓存 + 后台刷新（stale-while-revalidate）。
 *  - 有缓存：data 立即可用，loading 为 false；挂载时若超过 maxAgeMs / 被标记过期 / 从没取过，就在后台刷新；
 *  - 没缓存：loading 为 true，直到第一次取数结束（失败时 error 有值）；
 *  - 缓存被 patch / invalidate 时，已挂载的页面自动更新 / 重新取数。
 * fetcher({ publish }) 见 studentCache.load。
 */
export function useCached(userId, key, fetcher, { maxAgeMs = 3000, enabled = true } = {}) {
  const [, force] = useReducer((n) => n + 1, 0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => {
    if (!userId) return Promise.resolve(undefined);
    return load(userId, key, (ctx) => fetcherRef.current(ctx)).catch((err) => {
      logger.warn(`加载失败：${key}`, err);
      return undefined;
    });
  }, [userId, key]);

  useEffect(() => {
    if (!userId || !enabled) return undefined;
    const unsub = subscribe(userId, key, () => {
      force();
      // 缓存被标记过期（自己的保存 / 删除 / 补填之后）：已挂载的页面立刻后台刷新
      if (status(userId, key).has && needsRefresh(userId, key, Infinity)) refresh();
    });
    if (needsRefresh(userId, key, maxAgeMs)) refresh();
    return unsub;
  }, [userId, key, enabled, maxAgeMs, refresh]);

  const data = userId ? peek(userId, key) : undefined;
  const st = status(userId, key);
  return {
    data,
    loading: Boolean(userId) && enabled && data === undefined && !st.error,
    error: data === undefined ? st.error : null,
    backgroundError: data !== undefined ? st.error : null, // 已有缓存时后台刷新失败：界面照常显示旧数据
    refreshing: st.loading,
    refresh,
  };
}
