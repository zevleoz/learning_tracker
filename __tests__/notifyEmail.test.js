import { runTick, sendTest, addDays, normalizePrefs } from '../api-lib/notify.mjs';
import {
  buildInactiveEmail, createMailer, resetEmailWarning, signUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken,
} from '../api-lib/notify-email.mjs';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: (...a) => mockSendMail(...a) }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: (...a) => mockCreateTransport(...a) },
}));

const SECRET = 'unsub-secret';
const TODAY = '2026-10-21';
const at = (ymd, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + ((h - 8) * 60 + m) * 60000);
};
const ago = (n) => addDays(TODAY, -n);
const sess = (date, startTime = '19:00:00') => ({
  date, startTime, courseId: 'c1', category: 3, form: '自主练习', minutes: 45,
});
const ENV = {
  SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'p',
  EMAIL_FROM: '一表人才 <noreply@example.com>', APP_URL: 'https://app.example.com/', NOTIFY_SECRET: SECRET,
};

beforeEach(() => {
  mockSendMail.mockReset().mockResolvedValue({});
  mockCreateTransport.mockClear();
  resetEmailWarning();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('退订 token', () => {
  test('合法 token 还原用户 id', () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken('u1', SECRET), SECRET)).toBe('u1');
  });
  test('篡改 / 换密钥 / 缺失 / 垃圾都无效', () => {
    const t = signUnsubscribeToken('u1', SECRET);
    const [data, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'u2', p: 'email-fallback-unsub' })).toString('base64url');
    expect(verifyUnsubscribeToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${data}.${sig.slice(0, -2)}xx`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(t, 'other-secret')).toBeNull();
    expect(verifyUnsubscribeToken('', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('garbage', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(undefined, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${t}.x`, SECRET)).toBeNull();
  });
  test('用途不符的签名无效', () => {
    const crypto = require('node:crypto');
    const data = Buffer.from(JSON.stringify({ u: 'u1', p: 'something-else' })).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    expect(verifyUnsubscribeToken(`${data}.${sig}`, SECRET)).toBeNull();
  });
});

describe('邮件内容', () => {
  const payload = { body: '三天没记录了。上次是 数学 · 练习，点一下就能补上。', url: '/records?log=1&course=c1&category=3&form=%E8%87%AA%E4%B8%BB&minutes=45' };
  const unsub = unsubscribeUrl('https://app.example.com', 'u1', SECRET);

  test('文本与 HTML 都含预填链接、记一笔按钮、退订链接', () => {
    const mail = buildInactiveEmail({ payload, appUrl: 'https://app.example.com', unsubUrl: unsub });
    expect(mail.subject).toBe('三天没记录了');
    const link = `https://app.example.com${payload.url}`;
    expect(mail.text).toContain(payload.body);
    expect(mail.text).toContain(link);
    expect(mail.text).toContain(unsub);
    expect(mail.html).toContain('记一笔');
    expect(mail.html).toContain('#A3202A');
    expect(mail.html).toContain(link.replace(/&/g, '&amp;'));
    expect(mail.html).toContain(unsub.replace(/&/g, '&amp;'));
  });

  test('createMailer 发信：发件人、List-Unsubscribe 头、退订 token 对应该用户', async () => {
    const mailer = createMailer(ENV);
    await mailer.sendInactive({ to: 's@example.com', userId: 'u1', payload });
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 465, secure: true }));
    const msg = mockSendMail.mock.calls[0][0];
    expect(msg).toMatchObject({ from: ENV.EMAIL_FROM, to: 's@example.com', subject: '三天没记录了' });
    const m = /<(https:\/\/app\.example\.com\/api\/notify\?type=unsubscribe&token=([^>]+))>/.exec(msg.headers['List-Unsubscribe']);
    expect(m).not.toBeNull();
    expect(verifyUnsubscribeToken(decodeURIComponent(m[2]), SECRET)).toBe('u1');
    expect(msg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(msg.text).toContain('https://app.example.com/records?log=1');
    expect(msg.html).toContain('<a ');
  });

  test('SMTP 未配置 → null，只记一次日志', () => {
    expect(createMailer({})).toBeNull();
    expect(createMailer({ ...ENV, SMTP_HOST: '' })).toBeNull();
    expect(createMailer({ ...ENV, APP_URL: '' })).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
function makeStore(over = {}) {
  const calls = { claim: [], release: [], deleted: [], channel: [] };
  const claimed = new Set();
  return {
    calls,
    listSubscriptions: async () => over.subs || [],
    listSubscriptionsFor: async (id) => (over.subs || []).filter((s) => s.user_id === id),
    listLoggedOn: async () => over.loggedOn || [],
    loadUserEmail: async (id) => (over.emails ? over.emails[id] : `${id}@example.com`),
    loadProfiles: async (ids) => (over.profiles || []).filter((p) => ids.includes(p.id)),
    loadSessions: async () => new Map(Object.entries(over.sessions || {})),
    loadPendingCounts: async () => new Map(),
    loadCourseNames: async () => ({ c1: '数学' }),
    loadDeliveries: async () => over.deliveries || [],
    claimDaily: async (uid, date, kind, channel) => {
      calls.claim.push([uid, date, kind, channel]);
      if (claimed.has(uid)) return false;
      claimed.add(uid);
      return true;
    },
    releaseDaily: async (uid) => { calls.release.push(uid); claimed.delete(uid); },
    setDeliveryChannel: async (uid, d, ch) => { calls.channel.push([uid, ch]); },
    deleteSubscription: async (ep) => { calls.deleted.push(ep); },
    touchSubscriptions: async () => {},
    ...over.extra,
  };
}
const profile = (id, prefs = {}) => ({ id, created_at: '2020-01-01T00:00:00Z', notification_prefs: { daily_reminder: false, ...prefs } });
const sub = (uid) => ({ user_id: uid, endpoint: `https://push.example/${uid}`, p256dh: 'p', auth: 'a' });
const NOW = at(TODAY, '20:00'); // 惯用时间默认 19:30，已到点

describe('邮件兜底判定（runTick）', () => {
  const mailerFor = () => ({ sendInactive: jest.fn().mockResolvedValue(undefined) });
  const noPush = jest.fn().mockResolvedValue({ statusCode: 201 });

  test('第 3 天、没有订阅 → 发邮件，占位写 channel=email', async () => {
    const mailer = mailerFor();
    const store = makeStore({ loggedOn: ['a'], profiles: [profile('a')], sessions: { a: [sess(ago(3))] } });
    const res = await runTick({ store, sendPush: noPush, mailer, now: NOW });
    expect(res.emailed).toBe(1);
    expect(store.calls.claim).toEqual([['a', TODAY, 'inactive', 'email']]);
    expect(mailer.sendInactive).toHaveBeenCalledWith(expect.objectContaining({
      to: 'a@example.com', userId: 'a',
      payload: expect.objectContaining({ body: expect.stringContaining('三天没记录了。上次是 数学 · 练习'), url: expect.stringContaining('/records?log=1&course=c1') }),
    }));
    expect(noPush).not.toHaveBeenCalled();
  });

  test('有可用订阅 → 只推送，不发邮件', async () => {
    const mailer = mailerFor();
    const store = makeStore({ subs: [sub('a')], loggedOn: ['a'], profiles: [profile('a')], sessions: { a: [sess(ago(3))] } });
    const res = await runTick({ store, sendPush: noPush, mailer, now: NOW });
    expect(res).toMatchObject({ sent: 1, emailed: 0 });
    expect(mailer.sendInactive).not.toHaveBeenCalled();
    expect(store.calls.claim).toEqual([['a', TODAY, 'inactive']]);
  });

  test('订阅全部在本轮被 410 删除 → 第 3 天改发邮件，沿用同一占位并改渠道', async () => {
    const mailer = mailerFor();
    const gone = jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    const store = makeStore({ subs: [sub('a')], profiles: [profile('a')], sessions: { a: [sess(ago(3))] } });
    const res = await runTick({ store, sendPush: gone, mailer, now: NOW });
    expect(res).toMatchObject({ sent: 0, removed: 1, emailed: 1 });
    expect(store.calls.deleted).toEqual(['https://push.example/a']);
    expect(store.calls.claim).toHaveLength(1);
    expect(store.calls.channel).toEqual([['a', 'email']]);
    expect(mailer.sendInactive).toHaveBeenCalledTimes(1);
  });

  test('第 7 天：既没订阅也不发邮件；订阅全失效也不发', async () => {
    const mailer = mailerFor();
    const store = makeStore({ loggedOn: [], profiles: [profile('a')], sessions: { a: [sess(ago(7))] } });
    await runTick({ store, sendPush: noPush, mailer, now: NOW });
    const gone = jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 404 }));
    const store2 = makeStore({
      subs: [sub('a')], profiles: [profile('a')], sessions: { a: [sess(ago(7))] },
      deliveries: [{ user_id: 'a', sent_date: ago(4), kind: 'inactive' }],
    });
    await runTick({ store: store2, sendPush: gone, mailer, now: NOW });
    expect(mailer.sendInactive).not.toHaveBeenCalled();
  });

  test('SMTP 未配置（mailer=null）→ 静默跳过，不报错也不查候选', async () => {
    const listLoggedOn = jest.fn();
    const store = makeStore({ loggedOn: ['a'], profiles: [profile('a')], sessions: { a: [sess(ago(3))] }, extra: { listLoggedOn } });
    const res = await runTick({ store, sendPush: noPush, mailer: null, now: NOW });
    expect(res).toMatchObject({ emailed: 0, sent: 0 });
    expect(listLoggedOn).not.toHaveBeenCalled();
  });

  test('关闭 email_fallback 或关闭「几天没记录」→ 不发邮件', async () => {
    for (const prefs of [{ email_fallback: false }, { inactive_reminder: false }]) {
      const mailer = mailerFor();
      const store = makeStore({ loggedOn: ['a'], profiles: [profile('a', prefs)], sessions: { a: [sess(ago(3))] } });
      await runTick({ store, sendPush: noPush, mailer, now: NOW });
      expect(mailer.sendInactive).not.toHaveBeenCalled();
    }
  });

  test('静默时段与惯用时间：同推送一致', async () => {
    const mailer = mailerFor();
    const store = makeStore({ loggedOn: ['a'], profiles: [profile('a')], sessions: { a: [sess(ago(3), '20:10:00')] } });
    const early = await runTick({ store, sendPush: noPush, mailer, now: at(TODAY, '19:00') }); // 惯用时间默认 19:30 之前
    const quiet = await runTick({ store, sendPush: noPush, mailer, now: at(TODAY, '23:00') });
    expect(early.emailed).toBe(0);
    expect(quiet.skipped).toBe('quiet-hours');
    expect(mailer.sendInactive).not.toHaveBeenCalled();
  });

  test('发信失败 → 释放占位，不让轮询失败；缺邮箱同理', async () => {
    const mailer = { sendInactive: jest.fn().mockRejectedValue(new Error('smtp down')) };
    const store = makeStore({ loggedOn: ['a'], profiles: [profile('a')], sessions: { a: [sess(ago(3))] } });
    const res = await runTick({ store, sendPush: noPush, mailer, now: NOW });
    expect(res.emailed).toBe(0);
    expect(store.calls.release).toEqual(['a']);
    const store2 = makeStore({ loggedOn: ['a'], emails: { a: '' }, profiles: [profile('a')], sessions: { a: [sess(ago(3))] } });
    const mailer2 = mailerFor();
    await expect(runTick({ store: store2, sendPush: noPush, mailer: mailer2, now: NOW })).resolves.toMatchObject({ emailed: 0 });
    expect(store2.calls.release).toEqual(['a']);
  });

  test('没有订阅的人不会收到每日提醒（也不发邮件）', async () => {
    const mailer = mailerFor();
    const store = makeStore({ loggedOn: ['a'], profiles: [profile('a', { daily_reminder: true })], sessions: { a: [sess(ago(3))] } });
    store.listLoggedOn = async () => [];
    const res = await runTick({ store, sendPush: noPush, mailer, now: NOW });
    expect(res.emailed).toBe(0);
    expect(store.calls.claim).toEqual([]);
  });
});

describe('prefs', () => {
  test('email_fallback 默认 true，布尔才采用', () => {
    expect(normalizePrefs(null).email_fallback).toBe(true);
    expect(normalizePrefs({ email_fallback: false }).email_fallback).toBe(false);
    expect(normalizePrefs({ email_fallback: 'no' }).email_fallback).toBe(true);
  });
});

describe('sendTest 限流', () => {
  const base = (over = {}) => {
    const claimTest = jest.fn().mockResolvedValue(true);
    const store = makeStore({ subs: [sub('a')], profiles: [profile('a', over.prefs)], extra: { claimTest, loadPendingCounts: async () => new Map([['a', 2]]) } });
    return { store, claimTest };
  };
  const push = () => jest.fn().mockResolvedValue({ statusCode: 201 });

  test('发送内容、徽标，且不写 push_deliveries', async () => {
    const { store } = base();
    const sendPush = push();
    const r = await sendTest({ store, sendPush, userId: 'a', now: NOW });
    expect(r.sent).toBe(1);
    expect(JSON.parse(sendPush.mock.calls[0][1])).toMatchObject({ title: '一表人才', body: '测试通知：提醒已经开启。', url: '/me/reminders', badge: 2 });
    expect(store.calls.claim).toEqual([]);
  });
  test('60 秒内再发 → 限流，不推送', async () => {
    const last = new Date(NOW.getTime() - 20000).toISOString();
    const { store, claimTest } = base({ prefs: { last_test_at: last } });
    const sendPush = push();
    const r = await sendTest({ store, sendPush, userId: 'a', now: NOW });
    expect(r).toMatchObject({ rateLimited: true, retryAfter: 40, sent: 0 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(claimTest).not.toHaveBeenCalled();
  });
  test('超过 60 秒可再发；并发抢占失败也算限流', async () => {
    const last = new Date(NOW.getTime() - 61000).toISOString();
    const { store, claimTest } = base({ prefs: { last_test_at: last } });
    expect((await sendTest({ store, sendPush: push(), userId: 'a', now: NOW })).sent).toBe(1);
    expect(claimTest).toHaveBeenCalledWith('a', expect.objectContaining({ last_test_at: last }), NOW.toISOString(), new Date(NOW.getTime() - 60000).toISOString());
    claimTest.mockResolvedValue(false);
    const sendPush = push();
    expect((await sendTest({ store, sendPush, userId: 'a', now: NOW })).rateLimited).toBe(true);
    expect(sendPush).not.toHaveBeenCalled();
  });
  test('全部没送达 → 还原 last_test_at，不占限流额度', async () => {
    const { store } = base({ prefs: { daily_reminder: true } });
    store.releaseTest = jest.fn().mockResolvedValue();
    const failing = jest.fn().mockRejectedValue(Object.assign(new Error('BadJwtToken'), { statusCode: 403 }));
    const r = await sendTest({ store, sendPush: failing, userId: 'a', now: NOW });
    expect(r).toMatchObject({ sent: 0, failed: 1, message: '没能送达，请稍后再试' });
    expect(store.releaseTest).toHaveBeenCalledWith('a', expect.objectContaining({ daily_reminder: true }));
    expect(store.releaseTest.mock.calls[0][1]).not.toHaveProperty('last_test_at');
  });
  test('没有订阅 → 提示且不占限流额度', async () => {
    const claimTest = jest.fn();
    const store = makeStore({ profiles: [profile('a')], extra: { claimTest } });
    const r = await sendTest({ store, sendPush: push(), userId: 'a', now: NOW });
    expect(r).toMatchObject({ sent: 0, skipped: 'no-subscription', message: '这台设备还没开启通知' });
    expect(claimTest).not.toHaveBeenCalled();
  });
});
