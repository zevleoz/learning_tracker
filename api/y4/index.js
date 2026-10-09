// 同源 Y4 代理（路由固定为单段 /api/y4）：
// 浏览器只请求 /api/y4?path=<子路径>，Y4_API_KEY 仅存在于 Vercel 环境变量，从不下发到前端。
//
// 为什么不是 api/y4/[...path].js：线上实测（2026-10-09）Vercel 只把「一段」路径
// 交给该 catch-all —— /api/y4/students 能进函数，/api/y4/students/48(/reports)
// 直接被 Vercel 以 404 拦在函数之外。改用单段静态路由 + ?path= 后不再依赖
// catch-all 语义（与 api/llm/* 同形态，线上已验证可达）。
import { Y4_API_BASE, forwardViaFetch, jsonError, createTtlCache } from '../../api-lib/y4-forward.mjs';
import { requireMentor, sendDenied } from '../../api-lib/require-mentor.js';
import { validateY4Subpath, resolveY4Subpath, resolveY4Search } from '../../api-lib/y4-path.js';

// 只读列表的极短缓存：每个 serverless 实例各持一份，默认关闭（Y4_CACHE_TTL_MS=0）
const cache = createTtlCache();

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

  // 子路径与查询串统一由 resolveY4Target 解析（以 req.url 为准，见 api-lib/y4-path.js）
  const rawSubpath = resolveY4Subpath(req);
  const check = validateY4Subpath(rawSubpath);
  if (!check.ok) {
    console.warn('[y4-proxy] 拒绝路径', { url: req.url, rawSubpath, reason: check.reason });
    res.status(400).json({ ok: false, error: check.reason });
    return;
  }
  const subpath = check.subpath;
  const search = resolveY4Search(req);
  // e4-protocol 会触发上游 AI 生成（10-30 秒）：不重试，超时放宽到 50 秒；
  // 其余只读列表/文档：阶梯超时 + 失败重试一次（防上游连接挂起）
  const isProtocol = subpath.endsWith('/e4-protocol');

  // 只读列表的短缓存（默认 Y4_CACHE_TTL_MS=0 关闭；e4-protocol 永不缓存）
  cache.ttlMs = Number(process.env.Y4_CACHE_TTL_MS) || 0;
  const cacheKey = `${subpath}${search}`;
  const cacheable = !isProtocol && cache.ttlMs > 0;

  if (cacheable) {
    const hit = cache.get(cacheKey);
    if (hit) {
      res.status(hit.status);
      res.setHeader('Content-Type', hit.contentType);
      res.setHeader('Cache-Control', `private, max-age=${Math.floor(cache.ttlMs / 1000)}`);
      res.setHeader('X-Y4-Cache', 'HIT');
      res.send(hit.body);
      return;
    }
  }

  try {
    const startedAt = Date.now();
    const result = await forwardViaFetch({
      base: process.env.Y4_API_BASE || Y4_API_BASE,
      // 备用端点：主端点（如直连 origin）全部尝试失败时自动回退，默认回到 CF 域名
      fallbackBase: isProtocol ? '' : (process.env.Y4_API_BASE_FALLBACK || Y4_API_BASE),
      apiKey,
      subpath,
      search,
      attempts: isProtocol ? 1 : 2,
      timeoutMs: isProtocol ? 50000 : [6000, 12000],
      // 上游支持 X-Api-Key 后设为 x-api-key，可让 Cloudflare 缓存规则命中
      authHeader: process.env.Y4_AUTH_HEADER || 'authorization',
    });
    const ms = Date.now() - startedAt;
    if (result.status >= 400) {
      // 上游 4xx/5xx 进 Vercel Runtime Logs：线上排障直接看状态、耗时与上游原文
      console.warn('[y4-proxy] upstream', {
        subpath,
        status: result.status,
        ms,
        body: String(result.body).slice(0, 120),
      });
    }
    if (cacheable && result.status === 200 && !search) {
      // 只缓存不带查询串的成功响应，避免把变体参数的结果混在一起
      cache.set(cacheKey, { status: result.status, contentType: result.contentType, body: result.body });
    }
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    if (result.cacheControl) res.setHeader('Cache-Control', result.cacheControl);
    if (cacheable) res.setHeader('X-Y4-Cache', 'MISS');
    res.send(result.body);
  } catch (err) {
    console.warn('[y4-proxy] upstream error', { subpath, error: err.message || 'network error' });
    const e = jsonError(502, `无法连接 Y4 服务：${err.message || 'network error'}`);
    res.status(e.status);
    res.setHeader('Content-Type', e.contentType);
    res.send(e.body);
  }
}
