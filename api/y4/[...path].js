// 同源 Y4 代理：浏览器只请求 /api/y4/*，
// Y4_API_KEY 仅存在于 Vercel 环境变量，从不下发到前端。
import { Y4_API_BASE, forwardViaFetch, jsonError } from '../../api-lib/y4-forward.mjs';
import { requireMentor, sendDenied } from '../../api-lib/require-mentor.js';
import { validateY4Subpath, resolveY4Subpath } from '../../api-lib/y4-path.js';

export const config = {
  // e4-protocol 端点实时调用 AI，实测 10-30 秒
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: '仅支持 GET 请求' });
    return;
  }

  // 鉴权：仅导师及以上账号（token 由前端从 Supabase session 注入）
  const auth = await requireMentor(req);
  if (!auth.ok) {
    sendDenied(res, auth);
    return;
  }

  const apiKey = process.env.Y4_API_KEY;
  if (!apiKey) {
    res.status(503).json({ ok: false, error: '服务端未配置 Y4_API_KEY' });
    return;
  }

  // 子路径以 req.url 为准（Vercel 的 catch-all 不一定填充 req.query.path，见 resolveY4Subpath）
  const rawSubpath = resolveY4Subpath(req);
  const check = validateY4Subpath(rawSubpath);
  if (!check.ok) {
    console.warn('[y4-proxy] 拒绝路径', { url: req.url, rawSubpath, reason: check.reason });
    res.status(400).json({ ok: false, error: check.reason });
    return;
  }
  const subpath = check.subpath;
  const search = req.url.includes('?') ? `?${req.url.slice(req.url.indexOf('?') + 1)}` : '';
  // e4-protocol 会触发上游 AI 生成（10-30 秒）：不重试，超时放宽到 50 秒；
  // 其余只读列表/文档：单次 7 秒超时 + 失败重试一次（防上游连接挂起）
  const isProtocol = subpath.endsWith('/e4-protocol');

  try {
    const result = await forwardViaFetch({
      base: process.env.Y4_API_BASE || Y4_API_BASE,
      apiKey,
      subpath,
      search,
      attempts: isProtocol ? 1 : 2,
      timeoutMs: isProtocol ? 50000 : [6000, 12000],
    });
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    if (result.cacheControl) res.setHeader('Cache-Control', result.cacheControl);
    res.send(result.body);
  } catch (err) {
    const e = jsonError(502, `无法连接 Y4 服务：${err.message || 'network error'}`);
    res.status(e.status);
    res.setHeader('Content-Type', e.contentType);
    res.send(e.body);
  }
}
