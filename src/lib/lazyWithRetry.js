import { lazy } from 'react';

// 部署新版本后，旧页面里的懒加载 chunk 文件名已不存在（Vercel 会把缺失文件回退成 index.html，
// 表现为「Unexpected token '<'」或 Failed to fetch dynamically imported module）。
// 遇到这类加载失败时整页刷新一次拿到新版本；用 sessionStorage 做标记，避免真断网时无限刷新。
const RELOAD_KEY = 'yb:chunk-reload';

export function isChunkLoadError(err) {
  const msg = String(err?.message || err || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unexpected token '<'|Loading chunk .* failed/i.test(msg);
}

export function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      const mod = await factory();
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* 隐私模式下忽略 */ }
      return mod;
    } catch (err) {
      if (isChunkLoadError(err)) {
        let already = false;
        try {
          already = sessionStorage.getItem(RELOAD_KEY) === '1';
          if (!already) sessionStorage.setItem(RELOAD_KEY, '1');
        } catch { /* 取不到标记时宁可不刷新 */ already = true; }
        if (!already && typeof window !== 'undefined') {
          window.location.reload();
          // 刷新期间保持挂起，不渲染错误页
          return new Promise(() => {});
        }
      }
      throw err;
    }
  });
}
