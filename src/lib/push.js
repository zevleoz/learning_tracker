// 浏览器端 Web Push 封装。UI（提醒设置页）在 WS7，这里只提供能力检测与订阅管理。
// 订阅保存到 push_subscriptions；服务端见 api/notify 与 api-lib/notify.mjs。
import { supabase } from './supabase';

/** base64url 的 VAPID 公钥 → pushManager.subscribe 需要的 Uint8Array。 */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true; // iOS Safari
  return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches);
}

/** iOS Safari 只有「添加到主屏幕」后（standalone）才支持 Web Push。 */
export function isIOSNeedsInstall() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ 的 UA 伪装成 Mac
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS && !isStandalone();
}

/** @returns {'granted'|'denied'|'default'|'unsupported'} */
export function getPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

function vapidPublicKey() {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
}

/**
 * 请求权限、订阅并保存到 push_subscriptions。
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'unsupported'|'needs-install'|'denied'|'no-key'|'save-failed' }>}
 */
export async function subscribe(userId, { vapidKey } = {}) {
  if (!userId) return { ok: false, reason: 'save-failed' };
  if (!isPushSupported()) {
    return { ok: false, reason: isIOSNeedsInstall() ? 'needs-install' : 'unsupported' };
  }
  const key = vapidKey || vapidPublicKey();
  if (!key) return { ok: false, reason: 'no-key' };

  const permission =
    Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }

  return saveSubscription(subscription);
}

/** 把浏览器里的订阅写到服务器（幂等：同一 endpoint 重复写只会更新）。失败时带上服务器给的原因，便于排查。 */
async function saveSubscription(subscription) {
  const json = subscription.toJSON();
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: (navigator.userAgent || '').slice(0, 300),
  });
  if (error) return { ok: false, reason: 'save-failed', detail: String(error.message || error.code || '').slice(0, 160) };
  return { ok: true };
}

/**
 * 已授权且浏览器里有订阅时，把它重新写到服务器。
 * 用于：打开应用时自愈（之前保存失败、换账号登录同一台设备），以及发送测试通知前确认服务器有这台设备。
 */
export async function syncSubscription() {
  if (!isPushSupported() || Notification.permission !== 'granted') return { ok: false, reason: 'not-granted' };
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  if (!registration) return { ok: false, reason: 'no-service-worker' };
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { ok: false, reason: 'no-subscription' };
  return saveSubscription(subscription);
}

/** 取消本设备的订阅并删除对应的库内记录。 */
export async function unsubscribe() {
  if (!isPushSupported()) return { ok: true };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { ok: true };
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  return error ? { ok: false } : { ok: true };
}

/** 设置桌面图标角标（不支持的浏览器静默忽略）。n<=0 清除。 */
export async function setAppBadge(n) {
  try {
    if (typeof navigator === 'undefined') return;
    if (n > 0 && typeof navigator.setAppBadge === 'function') await navigator.setAppBadge(n);
    else if (typeof navigator.clearAppBadge === 'function') await navigator.clearAppBadge();
  } catch {
    // 角标只是锦上添花
  }
}

/** 这台设备当前是否有推送订阅（用于决定是否显示「发送测试通知」）。 */
export async function hasDeviceSubscription() {
  try {
    if (!isPushSupported() || Notification.permission !== 'granted') return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * 让服务端给自己的订阅发一条测试通知（用登录 token 鉴权）。
 * @returns {Promise<{ ok: boolean, sent?: number, message: string }>}
 */
export async function sendTestNotification() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { ok: false, message: '登录已过期，请重新登录' };
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'test' }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.sent > 0) return { ok: true, sent: body.sent, message: '已发送，几秒内会收到' };
    return { ok: false, sent: 0, message: body.message || body.error || '没能发送，请稍后再试' };
  } catch {
    return { ok: false, message: '网络不通，请稍后再试' };
  }
}
