// AI 监督流程入口（路由固定为单段 /api/supervision）。
//
//   1) 定时任务（pg_cron 每 15 分钟）：POST {"type":"run"}，头 x-notify-secret = NOTIFY_SECRET
//      生成「新生每日一句」和「周一的周小结」草稿，返回摘要。重复触发安全（唯一键 + 先查后建）。
//   2) 重新生成：POST {"type":"regenerate","draft_id":"…"}，头 Authorization: Bearer <导师 access token>
//      必须是该学生的已连接导师（status = 1）；管理员（role ≥ 3）可处理任意学生。
//   3) 本地调提示词：POST {"type":"preview","kind","dayN","records","issues"}
//      只在非生产环境、且带头 x-supervision-dev: 1 时可用，不碰数据库；生产环境一律 404。
//
// 草稿只给导师看，学生端没有任何入口。服务端密钥只来自环境变量，绝不进入前端 bundle。
import crypto from 'node:crypto';
import { requireMentor, sendDenied } from '../../api-lib/require-mentor.js';
import { generateDraft } from '../../api-lib/supervision-prompt.mjs';
import { createSupabaseStore, regenerateDraft, runSupervisionJob } from '../../api-lib/supervision.mjs';

export const config = {
  maxDuration: 60,
};

const ADMIN_ROLE = 3;
const MAX_PREVIEW_RECORDS = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headerValue(req, name) {
  const v = req?.headers?.[name];
  return Array.isArray(v) ? v[0] : v || '';
}

function secretMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseBody(req) {
  const raw = req.body;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return {};
}

function defaultMakeStore() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseStore({ url, serviceKey });
}

/** 依赖可注入（测试用）；默认导出的 handler 用真实依赖。 */
export function createHandler({ makeStore = defaultMakeStore, generate = generateDraft } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: '仅支持 POST 请求' });
      return;
    }
    const body = parseBody(req);
    if (body === null) {
      res.status(400).json({ ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    const type = String(body.type || '').toLowerCase();

    try {
      if (type === 'preview') return await handlePreview(req, res, body, generate);
      if (type === 'run') return await handleRun(req, res, makeStore, generate);
      if (type === 'regenerate') return await handleRegenerate(req, res, body, makeStore, generate);
      res.status(400).json({ ok: false, error: `未知的 type：${type || '（空）'}` });
    } catch (err) {
      console.error('[supervision] 失败', type, err?.message);
      res.status(500).json({ ok: false, error: '监督任务执行失败' });
    }
  };
}

async function handlePreview(req, res, body, generate) {
  // 生产环境（含 Vercel 预览部署）不暴露；其它情况下还要显式带开发头。统一 404，不泄露这个入口存在。
  if (process.env.NODE_ENV === 'production' || headerValue(req, 'x-supervision-dev') !== '1') {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  const kind = body.kind === 'weekly' ? 'weekly' : body.kind === 'daily' ? 'daily' : null;
  if (!kind || !Array.isArray(body.records) || body.records.length === 0 || body.records.length > MAX_PREVIEW_RECORDS) {
    res.status(400).json({ ok: false, error: 'kind 需为 daily / weekly，records 为 1–80 条的数组' });
    return;
  }
  try {
    const draft = await generate({
      kind,
      dayN: Number(body.dayN) || undefined,
      records: body.records,
      issues: Array.isArray(body.issues) ? body.issues.map(String) : [],
    }, process.env);
    res.status(200).json({ ok: true, ...draft });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message || '模型调用失败' });
  }
}

async function handleRun(req, res, makeStore, generate) {
  const expected = process.env.NOTIFY_SECRET;
  if (!expected) {
    res.status(503).json({ ok: false, error: '服务端未配置 NOTIFY_SECRET' });
    return;
  }
  if (!secretMatches(headerValue(req, 'x-notify-secret'), expected)) {
    res.status(401).json({ ok: false, error: '未授权' });
    return;
  }
  const store = makeStore();
  if (!store) {
    res.status(503).json({ ok: false, error: '服务端未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const summary = await runSupervisionJob({ store, generate, env: process.env });
  res.status(200).json({ ok: true, ...summary });
}

async function handleRegenerate(req, res, body, makeStore, generate) {
  const auth = await requireMentor(req);
  if (!auth.ok) {
    sendDenied(res, auth);
    return;
  }
  const draftId = typeof body.draft_id === 'string' ? body.draft_id : '';
  if (!UUID_RE.test(draftId)) {
    res.status(400).json({ ok: false, error: '缺少或无效的 draft_id' });
    return;
  }
  const store = makeStore();
  if (!store) {
    res.status(503).json({ ok: false, error: '服务端未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const draft = await store.getDraft(draftId);
  if (!draft) {
    res.status(404).json({ ok: false, error: '找不到这份草稿' });
    return;
  }
  const allowed = auth.role >= ADMIN_ROLE || (await store.hasActiveConnection(auth.user.id, draft.student_id));
  if (!allowed) {
    res.status(403).json({ ok: false, error: '你没有这位学生的已连接关系' });
    return;
  }
  try {
    const updated = await regenerateDraft({ store, draft, generate, env: process.env });
    res.status(200).json({ ok: true, draft: updated });
  } catch (err) {
    const status = err?.status || 502;
    res.status(status).json({ ok: false, error: err?.message || '重新生成失败' });
  }
}

export default createHandler();
