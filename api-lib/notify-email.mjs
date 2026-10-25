// 「三天没记录」邮件兜底（服务端使用）。这是唯一的邮件场景：
//   - 只在第 3 天、且学生没有任何可用的推送订阅时发一封；第 7 天绝不发邮件，有可用订阅的人也不发。
//   - SMTP 用 nodemailer（与服务商无关）。未配置时静默跳过（只记一次日志），绝不让轮询失败。
//   - 退订链接是带签名的 token（HMAC-SHA256，密钥 NOTIFY_SECRET；内容 = 用户 id + 用途），
//     由 GET /api/notify?type=unsubscribe&token=… 处理，把 notification_prefs.email_fallback 置为 false。
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

export const UNSUBSCRIBE_PURPOSE = 'email-fallback-unsub';
export const EMAIL_SUBJECT = '三天没记录了';
export const CREST_RED = '#A3202A';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(secret, data) {
  return crypto.createHmac('sha256', String(secret)).update(data).digest('base64url');
}

/** @returns {string} `<base64url(json)>.<hmac>` */
export function signUnsubscribeToken(userId, secret) {
  const data = b64url(JSON.stringify({ u: String(userId), p: UNSUBSCRIBE_PURPOSE }));
  return `${data}.${hmac(secret, data)}`;
}

/** @returns {string|null} 合法返回用户 id；缺失、被篡改、用途不符一律 null。 */
export function verifyUnsubscribeToken(token, secret) {
  if (!token || !secret || typeof token !== 'string') return null;
  const [data, sig, extra] = token.split('.');
  if (!data || !sig || extra !== undefined) return null;
  const expected = hmac(secret, data);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (parsed?.p !== UNSUBSCRIBE_PURPOSE || typeof parsed.u !== 'string' || !parsed.u) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function unsubscribeUrl(appUrl, userId, secret) {
  const token = signUnsubscribeToken(userId, secret);
  return `${appUrl}/api/notify?type=unsubscribe&token=${encodeURIComponent(token)}`;
}

/**
 * @param {{ payload: {body: string, url: string}, appUrl: string, unsubUrl: string }} args
 *   payload 就是推送用的那份（正文写着上次记了什么，url 是预填好的 /records?log=1&…）
 */
export function buildInactiveEmail({ payload, appUrl, unsubUrl }) {
  const link = `${appUrl}${payload.url}`;
  const text = [
    payload.body,
    '',
    `记一笔：${link}`,
    '',
    '—',
    `不想再收到这类邮件？一键退订：${unsubUrl}`,
  ].join('\n');
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;padding:24px 16px;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1d1f24;">
<div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;">
<p style="margin:0 0 6px;font-size:13px;color:#5f6570;">一表人才</p>
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.4;">${EMAIL_SUBJECT}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.7;">${escapeHtml(payload.body)}</p>
<p style="margin:0 0 8px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:${CREST_RED};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 26px;border-radius:8px;">记一笔</a></p>
</div>
<p style="max-width:440px;margin:14px auto 0;font-size:12px;line-height:1.6;color:#8a8f98;text-align:center;">只在三天没记录时提醒一次。<a href="${escapeHtml(unsubUrl)}" style="color:#8a8f98;">不想收到邮件？一键退订</a></p>
</body></html>`;
  return { subject: EMAIL_SUBJECT, text, html };
}

let warnedUnconfigured = false;
/** 仅供测试重置「只记一次」的状态。 */
export function resetEmailWarning() {
  warnedUnconfigured = false;
}

/**
 * 读环境变量创建发信器；SMTP / APP_URL / NOTIFY_SECRET 不全则返回 null（记一次日志）。
 * @returns {null | { sendInactive: (args: { to: string, userId: string, payload: object }) => Promise<void> }}
 */
export function createMailer(env = process.env, { createTransport = nodemailer.createTransport } = {}) {
  const host = env.SMTP_HOST;
  const from = env.EMAIL_FROM;
  const appUrl = String(env.APP_URL || '').replace(/\/+$/, '');
  const secret = env.NOTIFY_SECRET;
  if (!host || !from || !appUrl || !secret) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[notify] 邮件兜底未启用：SMTP_HOST / EMAIL_FROM / APP_URL 未配置，已跳过');
    }
    return null;
  }
  const port = Number(env.SMTP_PORT) || 465;
  const secure = env.SMTP_SECURE != null && env.SMTP_SECURE !== ''
    ? /^(1|true|yes)$/i.test(String(env.SMTP_SECURE))
    : port === 465;
  const transport = createTransport({
    host,
    port,
    secure,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
  });
  return {
    async sendInactive({ to, userId, payload }) {
      const unsubUrl = unsubscribeUrl(appUrl, userId, secret);
      const mail = buildInactiveEmail({ payload, appUrl, unsubUrl });
      await transport.sendMail({
        from,
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        // RFC 8058：邮箱客户端的「退订」按钮直接发 POST；链接本身只打开确认页，避免安全扫描器预取误退订
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
    },
  };
}

const UNSUB_MESSAGES = {
  confirm: '确认后，三天没记录时不会再发邮件提醒你。随时可以在「我的 › 提醒」里重新打开。',
  done: '已退订：不会再用邮件提醒你了。',
  invalid: '这个退订链接无效或已损坏。',
  error: '暂时没能退订，请稍后再试。',
};

/**
 * 退订页面。state：confirm（GET 打开链接时，只展示确认按钮，不改数据）/ done / invalid / error。
 * confirm 状态需要 token，用于表单 POST 回同一地址。
 * 兼容旧调用：传布尔值 true/false 视为 done/invalid。
 */
export function unsubscribePage(state, { token } = {}) {
  const key = state === true ? 'done' : state === false ? 'invalid' : state;
  const msg = UNSUB_MESSAGES[key] || UNSUB_MESSAGES.invalid;
  const form = key === 'confirm' && token
    ? `<form method="post" action="/api/notify?type=unsubscribe&amp;token=${encodeURIComponent(token)}" style="margin:24px 0 0;"><button type="submit" style="font:inherit;font-size:15px;font-weight:600;padding:12px 28px;border:0;border-radius:999px;background:${CREST_RED};color:#fff;cursor:pointer;">确认退订</button></form>`
    : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>一表人才</title></head><body style="margin:0;padding:48px 20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;text-align:center;color:#1d1f24;"><h1 style="font-size:18px;margin:0 0 10px;">一表人才</h1><p style="font-size:15px;margin:0 auto;max-width:28em;line-height:1.6;">${msg}</p>${form}</body></html>`;
}
