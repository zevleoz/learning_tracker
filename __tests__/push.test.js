/**
 * src/lib/push.js 含 import.meta.env（Vite 专用语法），jest 的 CommonJS 转换无法解析。
 * 这里读取源码，把 import.meta.env 换成可控的全局变量、把 import/export 改写成 CJS 后加载。
 * （push.js 只有一个具名 import 与若干 `export function`，改写足够用。）
 */
import fs from 'node:fs';
import path from 'node:path';

function loadPush() {
  const file = path.resolve(__dirname, '../src/lib/push.js');
  let src = fs.readFileSync(file, 'utf8').replace(/import\.meta\.env/g, 'globalThis.__TEST_ENV__');
  src = src.replace(/^import \{ supabase \} from '\.\/supabase';$/m, "const { supabase } = require('./supabase');");
  const names = [];
  src = src.replace(/^export (async )?function (\w+)/gm, (_m, asyncKw, name) => {
    names.push(name);
    return `${asyncKw || ''}function ${name}`;
  });
  if (/^(import|export) /m.test(src)) throw new Error('push.js 出现了测试加载器未处理的 import/export 形式');
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', `${src}\n${names.map((n) => `exports.${n} = ${n};`).join('\n')}`)(
    mod,
    mod.exports,
    require,
  );
  return mod.exports;
}

const supabaseMock = require('../src/__mocks__/supabase.js');
const { supabase } = supabaseMock;

describe('push.js', () => {
  const ORIGINALS = {};
  beforeEach(() => {
    supabase.__resetMocks();
    globalThis.__TEST_ENV__ = { VITE_VAPID_PUBLIC_KEY: 'BAQD-_8' };
    ORIGINALS.sw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  });
  afterEach(() => {
    delete globalThis.__TEST_ENV__;
    delete window.PushManager;
    delete window.Notification;
    delete globalThis.Notification;
    delete navigator.standalone;
    delete navigator.setAppBadge;
    delete navigator.clearAppBadge;
    if (ORIGINALS.sw) Object.defineProperty(navigator, 'serviceWorker', ORIGINALS.sw);
    else delete navigator.serviceWorker;
    delete navigator.userAgent; // 去掉测试里的自有属性，恢复原型上的 UA
  });

  const setUA = (ua) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });

  function installPushEnv({ permission = 'granted', existing = null } = {}) {
    const sub = {
      endpoint: 'https://push.example/e1',
      toJSON: () => ({ endpoint: 'https://push.example/e1', keys: { p256dh: 'P', auth: 'A' } }),
      unsubscribe: jest.fn().mockResolvedValue(true),
    };
    const pushManager = {
      getSubscription: jest.fn().mockResolvedValue(existing),
      subscribe: jest.fn().mockResolvedValue(sub),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager }) },
    });
    window.PushManager = function PushManager() {};
    window.Notification = { permission, requestPermission: jest.fn().mockResolvedValue('granted') };
    globalThis.Notification = window.Notification;
    return { sub, pushManager };
  }

  test('isPushSupported 取决于 serviceWorker / PushManager / Notification', () => {
    const push = loadPush();
    expect(push.isPushSupported()).toBe(false);
    installPushEnv();
    expect(push.isPushSupported()).toBe(true);
  });

  test('getPermission：不支持时返回 unsupported', () => {
    const push = loadPush();
    expect(push.getPermission()).toBe('unsupported');
    installPushEnv({ permission: 'denied' });
    expect(push.getPermission()).toBe('denied');
  });

  test('isIOSNeedsInstall：iOS Safari 未添加到主屏幕才需要', () => {
    const push = loadPush();
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
    expect(push.isIOSNeedsInstall()).toBe(true);
    navigator.standalone = true;
    expect(push.isIOSNeedsInstall()).toBe(false);
    delete navigator.standalone;
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36');
    expect(push.isIOSNeedsInstall()).toBe(false);
  });

  test('urlBase64ToUint8Array 解码 base64url', () => {
    const push = loadPush();
    expect(Array.from(push.urlBase64ToUint8Array('BAQD-_8'))).toEqual([4, 4, 3, 251, 255]);
  });

  test('subscribe：订阅并通过 RPC 保存', async () => {
    const push = loadPush();
    const { pushManager } = installPushEnv();
    const res = await push.subscribe('user-1');
    expect(res).toEqual({ ok: true });
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
    const rpc = supabase.__getCallHistory().find((c) => c.method === 'rpc');
    expect(rpc.table).toBe('register_push_subscription');
    expect(rpc.args).toMatchObject({ p_endpoint: 'https://push.example/e1', p_p256dh: 'P', p_auth: 'A' });
  });

  test('subscribe：已有订阅时复用，不重复订阅', async () => {
    const push = loadPush();
    const { sub, pushManager } = installPushEnv({ existing: undefined });
    pushManager.getSubscription.mockResolvedValue(sub);
    await push.subscribe('user-1');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  test('subscribe：权限被拒 / 无公钥 / 不支持 / iOS 需安装', async () => {
    const push = loadPush();
    installPushEnv({ permission: 'denied' });
    expect(await push.subscribe('u')).toEqual({ ok: false, reason: 'denied' });

    installPushEnv();
    globalThis.__TEST_ENV__ = {};
    expect(await push.subscribe('u')).toEqual({ ok: false, reason: 'no-key' });

    delete window.PushManager;
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
    expect(await push.subscribe('u')).toEqual({ ok: false, reason: 'needs-install' });
    setUA('Mozilla/5.0 (X11; Linux x86_64) Firefox/120');
    expect(await push.subscribe('u')).toEqual({ ok: false, reason: 'unsupported' });
  });

  test('subscribe：保存失败时返回 save-failed', async () => {
    const push = loadPush();
    installPushEnv();
    supabase.__setRpcResponse('register_push_subscription', { data: null, error: { message: 'boom' } });
    expect(await push.subscribe('u')).toEqual({ ok: false, reason: 'save-failed' });
  });

  test('unsubscribe：取消浏览器订阅并按 endpoint 删除库内记录', async () => {
    const push = loadPush();
    const env = installPushEnv();
    env.pushManager.getSubscription.mockResolvedValue(env.sub);
    // 项目内的 supabase mock 的 delete() 不支持 .eq 链式写法，这里用一个最小链替代
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn(() => ({ eq }));
    const fromSpy = jest.spyOn(supabase, 'from').mockReturnValue({ delete: del });

    expect(await push.unsubscribe()).toEqual({ ok: true });
    expect(env.sub.unsubscribe).toHaveBeenCalled();
    expect(fromSpy).toHaveBeenCalledWith('push_subscriptions');
    expect(eq).toHaveBeenCalledWith('endpoint', 'https://push.example/e1');
    fromSpy.mockRestore();
  });

  test('unsubscribe：本设备没有订阅时直接成功', async () => {
    const push = loadPush();
    installPushEnv({ existing: null });
    expect(await push.unsubscribe()).toEqual({ ok: true });
  });

  test('setAppBadge：功能检测，不支持时静默', async () => {
    const push = loadPush();
    await expect(push.setAppBadge(3)).resolves.toBeUndefined();
    navigator.setAppBadge = jest.fn().mockResolvedValue();
    navigator.clearAppBadge = jest.fn().mockResolvedValue();
    await push.setAppBadge(3);
    expect(navigator.setAppBadge).toHaveBeenCalledWith(3);
    await push.setAppBadge(0);
    expect(navigator.clearAppBadge).toHaveBeenCalled();
    navigator.setAppBadge = jest.fn().mockRejectedValue(new Error('nope'));
    await expect(push.setAppBadge(2)).resolves.toBeUndefined();
  });
});
