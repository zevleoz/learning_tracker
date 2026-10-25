import handler from '../api/notify/index.js';
import { signUnsubscribeToken } from '../api-lib/notify-email.mjs';

const mockSend = jest.fn();
jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: (...a) => mockSend(...a) },
}));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn(() => ({ sendMail: jest.fn() })) } }));

const SECRET = 'test-secret-value';
const JWT = 'user-jwt-token';
const ENV = { ...process.env };

function makeRes() {
  return {
    code: null, body: null, headers: {}, text: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; },
    send(t) { this.text = t; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

// 按 URL 回放；记录所有调用
function mockFetch({ userOk = true, subs = [{ user_id: 'u1', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }], prefs = {}, claim = [{ id: 'u1' }] } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers });
    const j = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.includes('/auth/v1/user')) return userOk ? j(200, { id: 'u1' }) : j(401, {});
    if (url.includes('push_subscriptions?select=')) return j(200, subs);
    if (url.includes('profiles?select=id,notification_prefs')) return j(200, [{ id: 'u1', notification_prefs: prefs }]);
    if (url.includes('profiles?select=notification_prefs')) return j(200, [{ notification_prefs: prefs }]);
    if (init.method === 'PATCH' && url.includes('profiles?')) return j(200, claim);
    if (url.includes('learning_sessions')) return j(200, []);
    return j(200, []);
  });
  return calls;
}

beforeEach(() => {
  process.env.NOTIFY_SECRET = SECRET;
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:t@example.com';
  mockSend.mockReset().mockResolvedValue({ statusCode: 201 });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ENV };
  delete global.fetch;
  jest.restoreAllMocks();
});

const post = (body, headers) => ({ method: 'POST', headers, body });
const userHdr = { authorization: `Bearer ${JWT}` };

describe('用户 JWT 鉴权边界', () => {
  test.each([
    [{ type: 'tick' }],
    [{}],
    [{ type: 'invite', student_id: 'u1' }],
    [{ type: 'INSERT', table: 'teacher_student_connections', record: { student_id: 'u1', teacher_id: 't', status: 0 } }],
    [{ type: 'unknown' }],
  ])('带有效用户 JWT 也不能触发 %j', async (body) => {
    const calls = mockFetch();
    const res = makeRes();
    await handler(post(body, userHdr), res);
    expect(res.code).toBe(401);
    expect(calls).toHaveLength(0); // 连数据库、Auth 都没碰
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('NOTIFY_SECRET 不能冒充用户去发测试通知', async () => {
    mockFetch({ userOk: false });
    const res = makeRes();
    await handler(post({ type: 'test' }, { 'x-notify-secret': SECRET }), res);
    expect(res.code).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('test：无 / 无效 JWT → 401', async () => {
    mockFetch({ userOk: false });
    for (const headers of [{}, userHdr]) {
      const res = makeRes();
      await handler(post({ type: 'test' }, headers), res);
      expect(res.code).toBe(401);
    }
  });
});

describe('POST type=test', () => {
  test('用 anon key 向 Auth 校验 JWT，只发给该用户自己的订阅，不写 push_deliveries', async () => {
    const calls = mockFetch();
    const res = makeRes();
    await handler(post({ type: 'test' }, userHdr), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: 1 });
    const auth = calls.find((c) => c.url === 'https://proj.supabase.co/auth/v1/user');
    expect(auth.headers).toMatchObject({ apikey: 'anon-test', Authorization: `Bearer ${JWT}` });
    expect(calls.find((c) => c.url.includes('push_subscriptions?select=')).url).toContain('user_id=eq.u1');
    expect(calls.some((c) => c.url.includes('push_deliveries'))).toBe(false);
    expect(JSON.parse(mockSend.mock.calls[0][1])).toMatchObject({ body: '测试通知：提醒已经开启。', url: '/me/reminders' });
  });

  test('60 秒内再次点击 → 429', async () => {
    mockFetch({ prefs: { last_test_at: new Date(Date.now() - 10000).toISOString() } });
    const res = makeRes();
    await handler(post({ type: 'test' }, userHdr), res);
    expect(res.code).toBe(429);
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('没有订阅 → 200 + 提示', async () => {
    mockFetch({ subs: [] });
    const res = makeRes();
    await handler(post({ type: 'test' }, userHdr), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ sent: 0, message: '这台设备还没开启通知' });
  });
});

describe('退订', () => {
  test('GET 合法 token → 只展示确认页，不碰数据库（防邮件扫描器预取）', async () => {
    const calls = mockFetch({ prefs: { daily_reminder: true } });
    const res = makeRes();
    const token = signUnsubscribeToken('u1', SECRET);
    await handler({ method: 'GET', headers: {}, query: { type: 'unsubscribe', token } }, res);
    expect(res.code).toBe(200);
    expect(res.text).toContain('确认退订');
    expect(res.text).toContain(`token=${encodeURIComponent(token)}`);
    expect(res.text).not.toContain('已退订');
    expect(calls).toHaveLength(0);
  });

  test('POST 合法 token（确认按钮 / RFC 8058 一键退订）→ email_fallback=false', async () => {
    const calls = mockFetch({ prefs: { daily_reminder: true } });
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', query: { type: 'unsubscribe', token: signUnsubscribeToken('u1', SECRET) } }, res);
    expect(res.code).toBe(200);
    expect(res.text).toContain('已退订');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(JSON.parse(patch.body).notification_prefs).toEqual({ daily_reminder: true, email_fallback: false });
  });

  test('无效 / 篡改 token → 400，不碰数据库', async () => {
    const calls = mockFetch();
    for (const method of ['GET', 'POST']) {
      for (const token of [undefined, 'junk', `${signUnsubscribeToken('u1', SECRET)}x`, signUnsubscribeToken('u1', 'other')]) {
        const res = makeRes();
        await handler({ method, headers: {}, query: { type: 'unsubscribe', token } }, res);
        expect(res.code).toBe(400);
        expect(res.text).toContain('无效');
      }
    }
    expect(calls).toHaveLength(0);
  });
});
