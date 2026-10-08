// Y4 上游转发的共享实现（服务端使用，绝不进入前端 bundle）。
// 同时被 Vercel Serverless Function 与 Vite 本地开发中间件引用。

export const Y4_HOST = 'report.p4learning-ark.app';
export const Y4_API_BASE = `https://${Y4_HOST}/api/v1`;

/**
 * 通过服务端到服务端的 fetch 转发 GET 请求（Vercel 云端使用）。
 * API Key 在此注入，浏览器永远接触不到。
 *
 * attempts：网络层失败（fetch 抛错，如 Cloudflare 瞬断）时的尝试次数。
 * 上游偶发连接抖动实测不低，只读列表类请求重试一次可显著降低失败率；
 * e4-protocol 这类会触发上游 AI 生成、耗时 10-30 秒的端点不要重试（保持 1 次）。
 */
export async function forwardViaFetch({ base = Y4_API_BASE, apiKey, subpath, search = '', attempts = 1 }) {
  const url = `${base.replace(/\/$/, '')}/${subpath}${search}`;
  let lastErr;
  for (let i = 0; i < Math.max(1, attempts); i += 1) {
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
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
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 400)); // 稍等再试
    }
  }
  throw lastErr;
}

export function jsonError(status, error) {
  return { status, body: JSON.stringify({ ok: false, error }), contentType: 'application/json; charset=utf-8' };
}
