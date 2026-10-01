/* =========================================================================
 * useAppUpdate.js — 按使用面分区的前端更新检测
 *
 * 版本来源：构建产物根目录 /version.json（vite.config.js 生成），
 * 内含 student / mentor / e4 三个使用面各自的摘要。
 * 客户端只比对「7 天内实际访问过」的面：改了导师端/E4 不会打扰学生。
 * ========================================================================= */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { reloadPage } from './utils.js';

const SURFACE_USAGE_KEY = 'app-surface-usage';
const DISMISS_KEY = 'app-update-dismissed';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL = 45 * 60 * 1000;

const CURRENT_BUILDS = typeof __SURFACE_BUILDS__ !== 'undefined' ? __SURFACE_BUILDS__ : {};

export const SURFACE_LABELS = {
  student: '学生端',
  mentor: '导师工作台',
  e4: 'E4 工作台',
};

/** 路由 → 使用面；登录/注册页不属于任何面 */
export function pathToSurface(pathname) {
  if (pathname.startsWith('/e4')) return 'e4';
  if (pathname.startsWith('/mentor')) return 'mentor';
  if (pathname === '/login' || pathname === '/signup') return null;
  return 'student';
}

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function readUsage() {
  return readJSON(SURFACE_USAGE_KEY);
}

/** 7 天内访问过的使用面 */
export function getUsedSurfaces(now = Date.now()) {
  const usage = readUsage();
  return Object.keys(usage).filter((s) => now - Number(usage[s]) < SEVEN_DAYS);
}

/** 挂在应用根部，按当前路由记录使用面及最后访问时间 */
export function SurfaceTracker() {
  const location = useLocation();
  useEffect(() => {
    const surface = pathToSurface(location.pathname);
    if (!surface) return;
    const usage = readUsage();
    usage[surface] = Date.now();
    try {
      localStorage.setItem(SURFACE_USAGE_KEY, JSON.stringify(usage));
    } catch {
      // 隐私模式等场景静默降级
    }
  }, [location.pathname]);
  return null;
}

async function fetchRemoteSurfaces() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.surfaces || null;
  } catch {
    // dev 环境无 version.json、网络中断、返回非 JSON 等一律忽略
    return null;
  }
}

/**
 * 比对远端摘要与当前摘要：
 * 仅限 7 天内使用过、且用户未对该摘要点过"稍后"的面
 */
export function diffSurfaces(remote, now = Date.now()) {
  if (!remote) return [];
  const dismissed = readJSON(DISMISS_KEY);
  return getUsedSurfaces(now).filter(
    (s) => remote[s] && remote[s] !== CURRENT_BUILDS[s] && dismissed[s] !== remote[s]
  );
}

export function useAppUpdate() {
  const [update, setUpdate] = useState(null); // { surfaces: [...], remote: {...} }
  const promptedSignatureRef = useRef('');
  const interactedRef = useRef(false);

  // 记录用户是否已开始操作：首次检测前无任何操作时允许静默刷新
  useEffect(() => {
    const markInteracted = () => {
      interactedRef.current = true;
    };
    window.addEventListener('pointerdown', markInteracted, { once: true });
    window.addEventListener('keydown', markInteracted, { once: true });
    window.addEventListener('touchstart', markInteracted, { once: true });
    return () => {
      window.removeEventListener('pointerdown', markInteracted);
      window.removeEventListener('keydown', markInteracted);
      window.removeEventListener('touchstart', markInteracted);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const check = async ({ silent = false } = {}) => {
      const remote = await fetchRemoteSurfaces();
      if (cancelled || !remote) return;

      const changed = diffSurfaces(remote);
      if (!changed.length) return;

      // 开机后、用户尚未操作时发现新版本：直接静默刷新
      if (silent && !interactedRef.current) {
        reloadPage();
        return;
      }

      const signature = changed.map((s) => `${s}:${remote[s]}`).sort().join('|');
      if (promptedSignatureRef.current === signature) return;
      promptedSignatureRef.current = signature;
      setUpdate({ surfaces: changed, remote });
    };

    // 首次检测稍作延迟，避免与首屏渲染抢资源
    const firstTimer = setTimeout(() => check({ silent: true }), 1500);

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const onMessage = (event) => {
      if (event.data?.type === 'SW_ACTIVATED') check();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', onMessage);
    }

    const pollTimer = setInterval(check, POLL_INTERVAL);

    // SW 通道：新 worker installed 时立即比对；周期性主动 update
    const reg = window.__SW_REG__;
    if (reg) {
      const watchWorker = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') check();
        });
      };
      watchWorker(reg.installing);
      reg.addEventListener('updatefound', () => watchWorker(reg.installing));
    }
    const swUpdateTimer = setInterval(() => {
      window.__SW_REG__?.update?.();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearTimeout(firstTimer);
      clearInterval(pollTimer);
      clearInterval(swUpdateTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
      }
    };
  }, []);

  const dismiss = () => {
    if (!update) return;
    const dismissed = readJSON(DISMISS_KEY);
    for (const s of update.surfaces) dismissed[s] = update.remote[s];
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
    } catch {
      // 静默降级
    }
    setUpdate(null);
  };

  const applyUpdate = async () => {
    // 通知各页面 flush 未完成的自动保存
    window.dispatchEvent(new Event('app:before-reload'));
    await new Promise((resolve) => setTimeout(resolve, 600));
    reloadPage();
  };

  return { update, dismiss, applyUpdate };
}
