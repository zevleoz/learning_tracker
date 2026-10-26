// 学生端内存缓存（stale-while-revalidate）：切页回来立即显示上次的数据，后台再刷新，不整页转圈。
//
// 设计要点：
//  - 按用户隔离：所有读写都带 userId，A 退出 / B 登录后永远读不到 A 的数据；用户变化时 clearAllCaches() 彻底清空。
//  - 只在内存里，刷新页面即清空，不落盘。
//  - 版本号防竞态：写入（patch / invalidate）会让「写入之前发出的请求」的结果作废并自动补发一次，
//    避免「刚保存的记录又被一个更早发出的旧响应盖掉」。
//  - 同一个 key 并发只发一次请求（Layout / 今天 / 我的 对邀请数等重复查询自动合并）。

const entries = new Map();   // `${userId}\u0000${key}` -> entry
const listeners = new Map(); // 同上 -> Set<fn>

const id = (userId, key) => `${userId}\u0000${key}`;

function getEntry(userId, key) {
  const k = id(userId, key);
  let e = entries.get(k);
  if (!e) {
    e = { value: undefined, has: false, version: 0, at: 0, stale: false, inflight: null, error: null, dead: false };
    entries.set(k, e);
  }
  return e;
}

function emit(userId, key) {
  const set = listeners.get(id(userId, key));
  if (set) [...set].forEach((fn) => fn());
}

/** 当前缓存值（没有则 undefined）。 */
export function peek(userId, key) {
  if (!userId) return undefined;
  const e = entries.get(id(userId, key));
  return e && e.has ? e.value : undefined;
}

/** 条目的加载状态：{ has, error, loading }，供 hook 判断「首次加载中 / 后台刷新失败」。 */
export function status(userId, key) {
  const e = userId ? entries.get(id(userId, key)) : null;
  return { has: Boolean(e && e.has), error: e ? e.error : null, loading: Boolean(e && e.inflight) };
}

/** 缓存条目是否需要后台刷新：从没取过 / 被标记过期 / 超过 maxAgeMs。 */
export function needsRefresh(userId, key, maxAgeMs = 0) {
  if (!userId) return false;
  const e = entries.get(id(userId, key));
  if (!e || !e.has) return true;
  if (e.stale && !e.inflight) return true;
  if (e.inflight) return false;
  return Date.now() - e.at >= maxAgeMs;
}

export function subscribe(userId, key, fn) {
  const k = id(userId, key);
  if (!listeners.has(k)) listeners.set(k, new Set());
  listeners.get(k).add(fn);
  return () => {
    const set = listeners.get(k);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) listeners.delete(k);
  };
}

/**
 * 取数并写入缓存。同一 key 并发只发一次。
 * fetcher({ publish }) 返回最终值；中途可 publish(partial) 先给出阶段性结果（例如先出最近一段，再补历史）。
 * 取数期间如果发生了 patch / invalidate（版本号变了），本次结果作废并自动重取一次。
 */
export function load(userId, key, fetcher) {
  if (!userId) return Promise.resolve(undefined);
  const e = getEntry(userId, key);
  if (e.inflight) return e.inflight;
  if (e.error) { e.error = null; emit(userId, key); }  // 重试：错误态回到「加载中」
  const run = async (attempt) => {
    const startVersion = e.version;
    const publish = (partial) => {
      if (e.dead || e.version !== startVersion) return; // 期间被 patch / invalidate / 清空：阶段性结果也作废
      e.value = partial; e.has = true; e.at = Date.now(); e.stale = true; // 阶段性结果仍需完整刷新
      e.error = null;
      emit(userId, key);
    };
    const value = await fetcher({ publish });
    if (e.dead) return value;                       // 已被清空（退出登录 / 换号）：不写回缓存
    if (e.version !== startVersion) {
      if (attempt < 2) return run(attempt + 1);     // 数据在途中被改动：以最新数据库状态重取
    }
    e.value = value; e.has = true; e.at = Date.now(); e.stale = false; e.error = null;
    emit(userId, key);
    return value;
  };
  const p = run(0)
    .catch((err) => { if (!e.dead) { e.error = err; e.stale = false; emit(userId, key); } throw err; })
    .finally(() => { if (e.inflight === p) e.inflight = null; });
  e.inflight = p;
  return p;
}

/** 直接写入一份新取到的值（页面自己取数、想让别的页面也能立即用上时）。 */
export function put(userId, key, value) {
  if (!userId) return;
  const e = getEntry(userId, key);
  e.value = value; e.has = true; e.at = Date.now(); e.stale = false; e.error = null;
  emit(userId, key);
}

/** 本地修补缓存值（保存 / 删除 / 补填后立即反映到列表）；同时让在途请求的旧结果作废。 */
export function patch(userId, key, updater) {
  if (!userId) return;
  const e = getEntry(userId, key);
  e.version += 1;
  if (e.has) {
    e.value = updater(e.value);
    emit(userId, key);
  }
}

/**
 * 标记过期：保留当前值先显示，下一次挂载 / 订阅者会触发后台刷新。
 * { drop: true } 直接丢弃当前值（改动无法在本地修补时用，之后的读取会等新数据）。
 */
export function invalidate(userId, key, { drop = false } = {}) {
  if (!userId) return;
  const e = getEntry(userId, key);
  e.version += 1;
  e.stale = true;
  if (drop) { e.value = undefined; e.has = false; }
  emit(userId, key);
}

/** 清空某个用户的全部缓存（退出登录 / 换号时）。userId 缺省则清空所有人。 */
export function clearAllCaches(userId) {
  const prefix = userId ? `${userId}\u0000` : null;
  for (const k of [...entries.keys()]) {
    if (!prefix || k.startsWith(prefix)) {
      const e = entries.get(k);
      e.version += 1; e.value = undefined; e.has = false; e.inflight = null; e.dead = true;
      entries.delete(k);
    }
  }
  for (const [k, set] of [...listeners.entries()]) {
    if (!prefix || k.startsWith(prefix)) [...set].forEach((fn) => fn());
  }
}
