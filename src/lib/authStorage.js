/**
 * 登录状态存在哪里：
 *   - 浏览器标签页：sessionStorage（每个标签页独立，导师可以在不同标签页登录不同账号）
 *   - 添加到主屏幕的应用（standalone）：localStorage。主屏幕应用有自己独立的存储，不会和
 *     浏览器标签页串号；用 sessionStorage 的话，学生每次划掉应用或被系统回收后都要重新登录。
 * 读取时先读本模式的存储，读不到再读另一个（升级后第一次打开时把已有登录接过来）。
 */
export function isStandaloneApp(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  try {
    if (win.navigator && win.navigator.standalone === true) return true;
    return Boolean(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

function safe(store) {
  return {
    get: (k) => { try { return store ? store.getItem(k) : null; } catch { return null; } },
    set: (k, v) => { try { store && store.setItem(k, v); } catch { /* 存储已满或被禁用 */ } },
    remove: (k) => { try { store && store.removeItem(k); } catch { /* 忽略 */ } },
  };
}

export function createAuthStorage({ standalone, local, session }) {
  const primary = safe(standalone ? local : session);
  const secondary = safe(standalone ? session : local);
  return {
    getItem: (key) => {
      const v = primary.get(key);
      if (v != null) return v;
      // 只在主屏幕应用里接管浏览器会话；浏览器标签页绝不读 localStorage（避免跨标签串号）
      if (!standalone) return null;
      const old = secondary.get(key);
      if (old != null) primary.set(key, old);
      return old;
    },
    setItem: (key, value) => primary.set(key, value),
    removeItem: (key) => { primary.remove(key); secondary.remove(key); },
  };
}

export function defaultAuthStorage() {
  const g = typeof window !== 'undefined' ? window : undefined;
  return createAuthStorage({
    standalone: isStandaloneApp(g),
    local: g ? g.localStorage : undefined,
    session: g ? g.sessionStorage : undefined,
  });
}
