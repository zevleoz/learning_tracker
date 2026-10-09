// Y4 上游转发的共享实现（服务端使用，绝不进入前端 bundle）。
// 同时被 Vercel Serverless Function 与 Vite 本地开发中间件引用。

export const Y4_HOST = 'report.p4learning-ark.app';
export const Y4_API_BASE = `https://${Y4_HOST}/api/v1`;

// 上游偶发「连接挂起」实测可达 30 秒以上（Cloudflare 隧道冷启动/抖动）。
// 因此每次尝试都带超时，超时即中止并交给 attempts 重试。
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 7000;

/**
 * 通过服务端到服务端的 fetch 转发 GET 请求（Vercel 云端使用）。
 * API Key 在此注入，浏览器永远接触不到。
 *
 * attempts：单次尝试失败（网络错误或超时）后的尝试次数。
 *   只读列表/文档建议 2；e4-protocol 会触发上游 AI 生成（10-30 秒）且不可廉价重放，
 *   固定 1 次并把 timeoutMs 放大。
 * timeoutMs：单次尝试的超时（挂起保护）。可传数组作为阶梯，例如 [6000, 12000]
 *   ——上游正常时 2-5 秒，偶发慢到 7 秒以上，先快速失败再给第二次更长的窗口，
 *   避免「两次都在短超时内被杀」造成误判失败。
 * fallbackBase：备用端点（例如直连 origin 失败时回退到 Cloudflare 域名）。
 *   主端点的全部尝试都失败后才会用到；与主端点相同则自动忽略。
 * authHeader：鉴权头形态，'authorization'（默认，Bearer）或 'x-api-key'。
 *   后者用于让 Cloudflare 缓存规则能命中（CF 默认不缓存带 Authorization 的请求）。
 */
export async function forwardViaFetch({
  base = Y4_API_BASE,
  fallbackBase = '',
  apiKey,
  subpath,
  search = '',
  attempts = 1,
  timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
  authHeader = 'authorization',
}) {
  const timeouts = Array.isArray(timeoutMs) ? timeoutMs : [timeoutMs];
  const tries = Math.max(1, attempts, timeouts.length);
  const headers = authHeader === 'x-api-key'
    ? { 'X-Api-Key': apiKey }
    : { Authorization: `Bearer ${apiKey}` };

  const primary = base.replace(/\/$/, '');
  const endpoints = [primary];
  const fallback = String(fallbackBase || '').replace(/\/$/, '');
  if (fallback && fallback !== primary) endpoints.push(fallback);

  let lastErr;
  for (const endpointBase of endpoints) {
    const url = `${endpointBase}/${subpath}${search}`;
    for (let i = 0; i < tries; i += 1) {
      const perTryTimeout = timeouts[Math.min(i, timeouts.length - 1)];
      try {
        const upstream = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(perTryTimeout),
        });
        const buffer = Buffer.from(await upstream.arrayBuffer());
        return {
          status: upstream.status,
          contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
          cacheControl: upstream.headers.get('cache-control'),
          body: buffer,
        };
      } catch (err) {
        lastErr = err;
        if (i + 1 < tries) await new Promise((r) => setTimeout(r, 400)); // 稍等再试
      }
    }
  }
  throw lastErr;
}

export function jsonError(status, error) {
  return { status, body: JSON.stringify({ ok: false, error }), contentType: 'application/json; charset=utf-8' };
}

/**
 * 极短 TTL 的内存缓存（每个 serverless 实例各持一份，不跨实例共享）。
 *
 * 用途：只读列表的重复查询（例如反复点选同一位学生）不必再走一次跨境往返。
 * 代价：TTL 内看不到刚生成的新数据 —— 因此默认关闭（ttlMs = 0），
 * 需要时用 Y4_CACHE_TTL_MS 打开，建议不超过 30 秒。
 * 绝不要用于 e4-protocol（会触发上游 AI 生成）。
 */
export function createTtlCache({ ttlMs = 0, max = 200 } = {}) {
  const store = new Map();
  const config = { ttlMs: Number(ttlMs) || 0, max };
  return {
    // ttlMs 可在运行期调整（例如按环境变量逐请求同步），0 表示关闭
    get ttlMs() {
      return config.ttlMs;
    },
    set ttlMs(value) {
      config.ttlMs = Number(value) || 0;
    },
    get(key) {
      if (!config.ttlMs) return null;
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at >= config.ttlMs) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value) {
      if (!config.ttlMs) return;
      if (!store.has(key) && store.size >= config.max) store.delete(store.keys().next().value);
      store.set(key, { at: Date.now(), value });
    },
  };
}
