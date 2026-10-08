// 服务端鉴权：/api/y4/* 与 /api/llm/* 只允许导师及以上账号调用。
// 校验方式：客户端携带 Supabase access_token（Authorization: Bearer ...），
// 先向 Supabase Auth 验证登录态，再用同一 token 读 profiles.role（RLS 走已验证身份）。
//
// 环境变量（serverless 读不到 VITE_* 前缀的变量）：
//   SUPABASE_URL / SUPABASE_ANON_KEY —— Vercel 需单独配置
// 本地开发由 vite.config.js 的中间件从 .env 系列文件注入。

export const MENTOR_ROLE = 2;

function serverConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  return { url, anonKey };
}

export function bearerToken(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(raw));
  return m ? m[1].trim() : '';
}

/**
 * @returns {Promise<{ ok: true, user: object, role: number } | { ok: false, status: number, error: string }>}
 */
export async function requireMentor(req) {
  const { url, anonKey } = serverConfig();
  if (!url || !anonKey) {
    return { ok: false, status: 503, error: '服务端未配置 SUPABASE_URL / SUPABASE_ANON_KEY' };
  }

  const token = bearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: '未登录或登录已过期，请重新登录' };
  }

  let userRes;
  try {
    userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return { ok: false, status: 502, error: `无法连接认证服务：${err?.message || 'network error'}` };
  }
  if (!userRes.ok) {
    return { ok: false, status: 401, error: '登录状态无效，请重新登录' };
  }
  const user = await userRes.json().catch(() => null);
  if (!user?.id) {
    return { ok: false, status: 401, error: '登录状态无效，请重新登录' };
  }

  let profRes;
  try {
    profRes = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } }
    );
  } catch (err) {
    return { ok: false, status: 502, error: `无法查询用户角色：${err?.message || 'network error'}` };
  }
  if (!profRes.ok) {
    return { ok: false, status: 502, error: `查询用户角色失败（HTTP ${profRes.status}）` };
  }
  const rows = await profRes.json().catch(() => null);
  const role = Number(Array.isArray(rows) ? rows[0]?.role : NaN);
  if (!Number.isFinite(role) || role < MENTOR_ROLE) {
    return { ok: false, status: 403, error: '仅导师及以上账号可使用该功能' };
  }

  return { ok: true, user, role };
}

/** Vercel handler 的统一拒绝出口。 */
export function sendDenied(res, result) {
  res.status(result.status).json({ ok: false, error: result.error });
}