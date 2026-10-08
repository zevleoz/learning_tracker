// Y4 代理路径白名单（Vercel Serverless Function 与 Vite 本地代理共用）。
// 只放行 E4 平台真实使用的四种路径形态，防止携带服务端 API Key 打到 Y4 的任意端点：
//   students
//   students/:id/reports
//   reports/:id/e4-protocol
//   reports/:id/y4-md
// 其余一律拒绝（含 .. 穿越、空段、编码字符、大小写变体）。

const ID_RE = /^\d{1,15}$/;

/**
 * 从请求里解析 Y4 子路径（未校验，交给 validateY4Subpath）。
 *
 * 为什么不能只读 req.query.path：Vercel 的 catch-all 路由在部分部署形态下
 * 并不会填充 req.query.path（线上实测为空），而本地 vite 中间件读取的是 URL。
 * 这里与本地实现对齐：以 req.url 为准，并为「挂载前缀被裁掉」的形态兜底，
 * 最后才回退 req.query.path。
 *
 * @param {object} req 请求对象（只需 url / query）
 * @returns {string}
 */
export function resolveY4Subpath(req) {
  const url = String(req?.url || '');
  const pathOnly = url.split('?')[0];
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