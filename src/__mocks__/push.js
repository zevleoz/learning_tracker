// push.js 在测试里的空桩（真实文件含 import.meta.env，jest 无法解析）。见 jest.config.js。
export function urlBase64ToUint8Array() { return new Uint8Array(0); }
export function isPushSupported() { return false; }
export function isIOSNeedsInstall() { return false; }
export function getPermission() { return 'unsupported'; }
export async function subscribe() { return { ok: false, reason: 'unsupported' }; }
export async function unsubscribe() { return { ok: true }; }
export async function setAppBadge() {}
export async function hasDeviceSubscription() { return false; }
export async function syncSubscription() { return { ok: false, reason: 'not-granted' }; }
export async function sendTestNotification() { return { ok: false, message: '' }; }
