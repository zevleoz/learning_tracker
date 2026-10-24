// Web Push 通知入口（路由固定为单段 /api/notify，与 api/y4 同形态）。
//
// 调用方（均需携带 NOTIFY_SECRET，二选一：x-notify-secret 头，或 Authorization: Bearer）：
//   1) 定时轮询（pg_cron + pg_net，约每 15 分钟）：POST /api/notify  body {"type":"tick"}（缺省即 tick）
//   2) 邀请即时推送：POST /api/notify  body {"type":"invite","student_id":"<uuid>","teacher_name":"..."}
//      也兼容 Supabase 数据库 Webhook 的载荷（teacher_student_connections 的 INSERT，status=0）
//
// 服务端密钥只来自环境变量：SUPABASE_SERVICE_ROLE_KEY / VAPID_PRIVATE_KEY / NOTIFY_SECRET，
// 绝不进入前端 bundle。判定逻辑在 api-lib/notify.mjs（纯函数，已有单测）。
import crypto from 'node:crypto';
import webpush from 'web-push';
import { createSupabaseStore, runTick, sendInvite } from '../../api-lib/notify.mjs';

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
  return { type };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: '仅支持 POST 请求' });
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

  const body = parseBody(req);
  if (body === null) {
    res.status(400).json({ ok: false, error: '请求体不是合法 JSON' });
    return;
  }
  const request = normalizeRequest(body);

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
      const result = await runTick({ store, sendPush });
      res.status(200).json({ ok: true, ...result });
      return;
    }
    res.status(400).json({ ok: false, error: `未知的 type：${request.type}` });
  } catch (err) {
    console.error('[notify] 失败', err?.message);
    res.status(500).json({ ok: false, error: '通知任务执行失败' });
  }
}
