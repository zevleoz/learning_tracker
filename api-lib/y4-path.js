// Y4 代理路径白名单（Vercel Serverless Function 与 Vite 本地代理共用）。
// 只放行 E4 平台真实使用的四种路径形态，防止携带服务端 API Key 打到 Y4 的任意端点：
//   students
//   students/:id/reports
//   reports/:id/e4-protocol
//   reports/:id/y4-md
// 其余一律拒绝（含 .. 穿越、空段、编码字符、大小写变体）。

const ID_RE = /^\d{1,15}$/;

/**
 * 从请求里解析 Y4 的「子路径 + 查询串」（未校验，交给 validateY4Subpath）。
 *
 * 为什么子路径走 ?path= 而不是 URL 路径段：线上实测（2026-10-09）
 * Vercel 只把「一段」路径交给 api/y4/[...path].js ——
 *   /api/y4/students            → 进函数（401，鉴权生效）
 *   /api/y4/students/48         → Vercel 直接 404，函数根本没被调用
 *   /api/y4/students/48/reports → 同上
 * 即 catch-all 实际被注册成单段参数路由。因此前端改为请求
 * /api/y4?path=<子路径>，函数固定落在单段静态路由上（与 /api/llm/* 同形态）。
 *
 * 兼容：URL 路径自带子路径的历史形态仍能解析（本地中间件、旧调用）。
 *
 * @param {object} req 请求对象（只需 url / query）
 * @returns {{ subpath: string, search: string }} search 形如 '?include_raw=1' 或 ''
 */
export function resolveY4Target(req) {
  const url = String(req?.url || '');
  const qIndex = url.indexOf('?');
  const rawQuery = qIndex >= 0 ? url.slice(qIndex + 1) : '';
  const pathOnly = qIndex >= 0 ? url.slice(0, qIndex) : url;

  if (rawQuery) {
    const packed = new URLSearchParams(rawQuery).get('path');
    if (packed && packed.trim()) {
      // 子路径里可能带自己的查询串：reports/46/y4-md?include_raw=1
      const qi = packed.indexOf('?');
      return {
        subpath: qi >= 0 ? packed.slice(0, qi) : packed,
        search: qi >= 0 ? packed.slice(qi) : '',
      };
    }
  }

  return {
    subpath: subpathFromUrlPath(pathOnly, req),
    search: rawQuery ? `?${rawQuery}` : '',
  };
}

function subpathFromUrlPath(pathOnly, req) {
  const marker = '/api/y4/';

  let rest;
  if (pathOnly.includes(marker)) {
    rest = pathOnly.slice(pathOnly.indexOf(marker) + marker.length);
  } else {
    // 兼容 req.url 已被裁成 '/students' 之类的形态（去掉可能的协议头与前导斜杠）
    rest = pathOnly.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/^\/+/, '');
    if (rest === 'api/y4') rest = '';
  }

  try {
    rest = decodeURIComponent(rest);
  } catch {
    // 编码非法：原样返回，由 validateY4Subpath 拒绝（% 会被判非法字符）
    return rest;
  }

  rest = rest.replace(/\/+$/, ''); // 容忍尾斜杠
  if (rest) return rest;

  // 兜底：URL 里取不到时再看 query（数组形态来自 Next 风格路由）
  const parts = req?.query?.path;
  if (Array.isArray(parts)) return parts.filter(Boolean).join('/');
  return typeof parts === 'string' ? parts.replace(/^\/+|\/+$/g, '') : '';
}

/** 只取子路径（不含查询串）。 */
export function resolveY4Subpath(req) {
  return resolveY4Target(req).subpath;
}

/** 只取需要转发给上游的查询串（形如 '?include_raw=1' 或 ''）。 */
export function resolveY4Search(req) {
  return resolveY4Target(req).search;
}

/**
 * 校验 catch-all 子路径。
 * @param {unknown} raw 来自 URL 的子路径（未含 query）
 * @returns {{ ok: true, subpath: string } | { ok: false, reason: string }}
 */
export function validateY4Subpath(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: '缺少 Y4 接口路径' };
  const subpath = raw.trim();
  if (!subpath) return { ok: false, reason: '缺少 Y4 接口路径' };

  // 合法调用只包含数字、固定单词与 `/`/`-`：编码字符、反斜杠、空白、控制字符一律拒绝
  if (/[%\\\s\x00-\x1f]/.test(subpath)) {
    return { ok: false, reason: 'Y4 接口路径包含非法字符' };
  }

  const segs = subpath.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) {
    return { ok: false, reason: 'Y4 接口路径包含非法段' };
  }

  const ok =
    (segs.length === 1 && segs[0] === 'students') ||
    (segs.length === 3 && segs[0] === 'students' && ID_RE.test(segs[1]) && segs[2] === 'reports') ||
    (segs.length === 3 &&
      segs[0] === 'reports' &&
      ID_RE.test(segs[1]) &&
      (segs[2] === 'e4-protocol' || segs[2] === 'y4-md'));

  if (!ok) return { ok: false, reason: '不被允许的 Y4 接口路径' };
  return { ok: true, subpath: segs.join('/') };
}