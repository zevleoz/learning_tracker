// Web Push 通知入口（路由固定为单段 /api/notify，与 api/y4 同形态）。
//
// 调用方（均需携带 NOTIFY_SECRET，二选一：x-notify-secret 头，或 Authorization: Bearer）：
//   1) 定时轮询（pg_cron + pg_net，约每 15 分钟）：POST /api/notify  body {"type":"tick"}（缺省即 tick）
//   2) 邀请即时推送：POST /api/notify  body {"type":"invite","student_id":"<uuid>","teacher_name":"..."}
//      也兼容 Supabase 数据库 Webhook 的载荷（teacher_student_connections 的 INSERT，status=0）
//
//   3) 学生自己点「发送测试通知」：POST /api/notify  body {"type":"test"}，
//      用登录学生的 Supabase access token（Authorization: Bearer <jwt>）鉴权，向 Supabase Auth 校验；
//      只发给该用户自己的订阅，不占每日额度，每用户 60 秒一次。用户 JWT 永远无法触发 tick / invite。
//   3b) 导师重新邀请（学生拒绝过后再次邀请）：POST /api/notify  body {"type":"reinvite","student_id":"<uuid>"}，
//      用导师的 Supabase access token 鉴权（requireMentor）；只在该导师与该学生存在 status=0 的连接时才发邀请推送。
//   4) 邮件退订（token 由 NOTIFY_SECRET 签名）：
//      GET  /api/notify?type=unsubscribe&token=… 只展示确认页（不改数据，防止邮件安全扫描器预取误退订）
//      POST /api/notify?type=unsubscribe&token=… 真正退订（确认页按钮，或邮箱客户端 RFC 8058 一键退订）
//
// 服务端密钥只来自环境变量：SUPABASE_SERVICE_ROLE_KEY / VAPID_PRIVATE_KEY / NOTIFY_SECRET，
// 绝不进入前端 bundle。判定逻辑在 api-lib/notify.mjs（纯函数，已有单测）。
import crypto from 'node:crypto';
import webpush from 'web-push';
import {
  createSupabaseStore, runTick, sendInvite, sendTest, unsubscribeEmail,
} from '../../api-lib/notify.mjs';
import { createMailer, unsubscribePage, verifyUnsubscribeToken } from '../../api-lib/notify-email.mjs';
import { requireMentor, sendDenied } from '../../api-lib/require-mentor.js';

export const config = {
  maxDuration: 60,
};

function headerValue(req, name) {
  const v = req?.headers?.[name];
  return Array.isArray(v) ? v[0] : v || '';
}

/** 常量时间比较，避免通过响应时间猜测密钥。 */
export function secretMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function providedSecret(req) {
  const direct = headerValue(req, 'x-notify-secret');
  if (direct) return direct;
  const m = /^Bearer\s+(.+)$/i.exec(String(headerValue(req, 'authorization')));
  return m ? m[1].trim() : '';
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

/** 把「手写 invite」与「数据库 Webhook」两种载荷归一成 { type, studentId, teacherId, teacherName }。 */
export function normalizeRequest(body) {
  if (body?.table === 'teacher_student_connections' && body?.record) {
    const rec = body.record;
    if (body.type !== 'INSERT' || Number(rec.status ?? 0) !== 0) return { type: 'ignore' };
    return { type: 'invite', studentId: rec.student_id, teacherId: rec.teacher_id, teacherName: '' };
  }
  const type = String(body?.type || 'tick').toLowerCase();
  if (type === 'invite') {
    return {
      type: 'invite',
      studentId: body.student_id,
      teacherId: body.teacher_id,
      teacherName: typeof body.teacher_name === 'string' ? body.teacher_name.slice(0, 40) : '',
    };
  }
  if (type === 'reinvite') {
    return { type: 'reinvite', studentId: typeof body.student_id === 'string' ? body.student_id : '' };
  }
  return { type };
}

/** 用 Supabase Auth 校验学生的 access token。@returns {Promise<{ id: string } | null>} */
export async function verifyUserJwt(req, supabaseUrl) {
  const m = /^Bearer\s+(.+)$/i.exec(String(headerValue(req, 'authorization')));
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!m || !anonKey) return null;
  try {
    const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${m[1].trim()}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user?.id ? { id: user.id } : null;
  } catch {
    return null;
  }
}

async function handleUnsubscribe(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = req.query?.token;
  const send = (code, state) => {
    res.status(code);
    res.setHeader?.('Content-Type', 'text/html; charset=utf-8');
    res.send ? res.send(unsubscribePage(state, { token })) : res.json({ ok: state === 'done' || state === 'confirm', state });
  };
  const userId = verifyUnsubscribeToken(token, process.env.NOTIFY_SECRET);
  if (!userId) return send(400, 'invalid');
  // GET 只展示确认页，不写库：邮件安全扫描器会预取链接，不能因此把学生退订
  if (req.method === 'GET') return send(200, 'confirm');
  if (!supabaseUrl || !serviceKey) return send(503, 'error');
  try {
    await unsubscribeEmail({ store: createSupabaseStore({ url: supabaseUrl, serviceKey }), userId });
    return send(200, 'done');
  } catch (err) {
    console.error('[notify] 退订失败', err?.message);
    return send(500, 'error');
  }
}

export default async function handler(req, res) {
  if ((req.method === 'GET' || req.method === 'POST') && String(req.query?.type || '').toLowerCase() === 'unsubscribe') {
    await handleUnsubscribe(req, res);
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: '仅支持 POST 请求' });
    return;
  }

  const body = parseBody(req);
  if (body === null) {
    res.status(400).json({ ok: false, error: '请求体不是合法 JSON' });
    return;
  }
  const request = normalizeRequest(body);

  // 唯一允许用户 JWT 的类型；其它类型（tick / invite / 未知）一律只认 NOTIFY_SECRET
  if (request.type === 'test') {
    await handleTest(req, res);
    return;
  }

  // 第二个允许用户 JWT 的类型：导师（role ≥ 2）重新邀请自己名下 status=0 的学生
  if (request.type === 'reinvite') {
    await handleReinvite(req, res, request);
    return;
  }

  const expected = process.env.NOTIFY_SECRET;
  if (!expected) {
    res.status(503).json({ ok: false, error: '服务端未配置 NOTIFY_SECRET' });
    return;
  }
  if (!secretMatches(providedSecret(req), expected)) {
    res.status(401).json({ ok: false, error: '未授权' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    res.status(503).json({
      ok: false,
      error: '服务端未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT',
    });
    return;
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const sendPush = (subscription, payload) =>
      webpush.sendNotification(subscription, payload, { TTL: 6 * 3600, urgency: 'normal' });
    const store = createSupabaseStore({ url: supabaseUrl, serviceKey });

    if (request.type === 'ignore') {
      res.status(200).json({ ok: true, skipped: 'ignored-event' });
      return;
    }
    if (request.type === 'invite') {
      if (!request.studentId) {
        res.status(400).json({ ok: false, error: '缺少 student_id' });
        return;
      }
      let teacherName = request.teacherName;
      if (!teacherName && request.teacherId) {
        teacherName = await store.loadProfileName(request.teacherId).catch(() => '');
      }
      const result = await sendInvite({ store, sendPush, studentId: request.studentId, teacherName });
      res.status(200).json({ ok: true, ...result });
      return;
    }
    if (request.type === 'tick') {
      const result = await runTick({ store, sendPush, mailer: createMailer(process.env) });
      res.status(200).json({ ok: true, ...result });
      return;
    }
    res.status(400).json({ ok: false, error: `未知的 type：${request.type}` });
  } catch (err) {
    console.error('[notify] 失败', err?.message);
    res.status(500).json({ ok: false, error: '通知任务执行失败' });
  }
}

async function handleTest(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    res.status(503).json({ ok: false, error: '服务端未配置推送' });
    return;
  }
  const user = await verifyUserJwt(req, supabaseUrl);
  if (!user) {
    res.status(401).json({ ok: false, error: '未登录或登录已过期，请重新登录' });
    return;
  }
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const sendPush = (subscription, payload) =>
      webpush.sendNotification(subscription, payload, { TTL: 600, urgency: 'high' });
    const store = createSupabaseStore({ url: supabaseUrl, serviceKey });
    const result = await sendTest({ store, sendPush, userId: user.id });
    if (result.rateLimited) {
      res.status(429).json({ ok: false, ...result });
      return;
    }
    res.status(200).json({ ok: result.sent > 0 || Boolean(result.skipped), ...result });
  } catch (err) {
    console.error('[notify] 测试通知失败', err?.message);
    res.status(500).json({ ok: false, error: '测试通知发送失败' });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 这位导师与该学生之间是否有一条待处理（status = 0）的邀请。 */
async function hasPendingInvite({ supabaseUrl, serviceKey, teacherId, studentId }) {
  const r = await fetch(
    `${supabaseUrl.replace(/\/$/, '')}/rest/v1/teacher_student_connections?select=id&status=eq.0`
      + `&teacher_id=eq.${encodeURIComponent(teacherId)}&student_id=eq.${encodeURIComponent(studentId)}&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!r.ok) throw new Error(`Supabase ${r.status}: teacher_student_connections`);
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function handleReinvite(req, res, request) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    res.status(503).json({ ok: false, error: '服务端未配置推送' });
    return;
  }
  const auth = await requireMentor(req);
  if (!auth.ok) {
    sendDenied(res, auth);
    return;
  }
  if (!UUID_RE.test(request.studentId || '')) {
    res.status(400).json({ ok: false, error: '缺少或无效的 student_id' });
    return;
  }
  try {
    const pending = await hasPendingInvite({
      supabaseUrl, serviceKey, teacherId: auth.user.id, studentId: request.studentId,
    });
    if (!pending) {
      res.status(403).json({ ok: false, error: '没有这位学生待处理的邀请' });
      return;
    }
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const sendPush = (subscription, payload) =>
      webpush.sendNotification(subscription, payload, { TTL: 6 * 3600, urgency: 'normal' });
    const store = createSupabaseStore({ url: supabaseUrl, serviceKey });
    const teacherName = await store.loadProfileName(auth.user.id).catch(() => '');
    const result = await sendInvite({ store, sendPush, studentId: request.studentId, teacherName });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[notify] 重新邀请推送失败', err?.message);
    res.status(500).json({ ok: false, error: '邀请推送发送失败' });
  }
}
