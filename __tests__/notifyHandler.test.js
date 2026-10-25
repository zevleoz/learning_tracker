import handler, { normalizeRequest, secretMatches } from '../api/notify/index.js';

const mockSend = jest.fn();
const mockSetVapid = jest.fn();
jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: (...a) => mockSetVapid(...a),
    sendNotification: (...a) => mockSend(...a),
  },
}));

function makeRes() {
  return {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; },
  };
}

const ENV = { ...process.env };
const SECRET = 'test-secret-value';

function setEnv() {
  process.env.NOTIFY_SECRET = SECRET;
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.VAPID_PUBLIC_KEY = 'pub-test';
  process.env.VAPID_PRIVATE_KEY = 'priv-test';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
}

// 按 URL 回放 PostgREST 响应的 fetch mock
function mockSupabase(routes) {
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    for (const [match, resp] of routes) {
      if (url.includes(match)) {
        const r = typeof resp === 'function' ? resp(url, init) : resp;
        return { ok: r.status < 300, status: r.status, json: async () => r.body };
      }
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  return calls;
}

beforeEach(() => {
  setEnv();
  mockSend.mockReset();
  mockSetVapid.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ENV };
  delete global.fetch;
  jest.restoreAllMocks();
});

const post = (body, headers = { 'x-notify-secret': SECRET }) => ({ method: 'POST', headers, body });

describe('/api/notify 鉴权', () => {
  test('非 POST → 405', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.code).toBe(405);
  });

  test('缺少或错误的密钥 → 401，且不访问数据库', async () => {
    mockSupabase([]);
    for (const headers of [{}, { 'x-notify-secret': 'wrong' }, { authorization: 'Bearer wrong' }]) {
      const res = makeRes();
      await handler(post({ type: 'tick' }, headers), res);
      expect(res.code).toBe(401);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('服务端未配置 NOTIFY_SECRET → 503（不会放行空密钥）', async () => {
    delete process.env.NOTIFY_SECRET;
    const res = makeRes();
    await handler(post({ type: 'tick' }, {}), res);
    expect(res.code).toBe(503);
  });

  test('缺少 VAPID / service role 配置 → 503', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = makeRes();
    await handler(post({ type: 'tick' }), res);
    expect(res.code).toBe(503);
  });

  test('Authorization: Bearer 也可通过', async () => {
    mockSupabase([]);
    const res = makeRes();
    await handler(post({ type: 'tick' }, { authorization: `Bearer ${SECRET}` }), res);
    expect(res.code).toBe(200);
  });

  test('secretMatches 常量时间比较', () => {
    expect(secretMatches('a', 'a')).toBe(true);
    expect(secretMatches('a', 'b')).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });
});

describe('/api/notify 请求归一', () => {
  test('缺省 type 即 tick', () => {
    expect(normalizeRequest({}).type).toBe('tick');
  });
  test('数据库 Webhook：仅 status=0 的 INSERT 当作邀请', () => {
    const rec = { student_id: 's', teacher_id: 't', status: 0 };
    expect(normalizeRequest({ type: 'INSERT', table: 'teacher_student_connections', record: rec })).toMatchObject({
      type: 'invite', studentId: 's', teacherId: 't',
    });
    expect(normalizeRequest({ type: 'UPDATE', table: 'teacher_student_connections', record: rec }).type).toBe('ignore');
    expect(normalizeRequest({ type: 'INSERT', table: 'teacher_student_connections', record: { ...rec, status: 1 } }).type).toBe('ignore');
  });
});

describe('/api/notify 流程', () => {
  test('invite：立即向学生所有订阅推送，410 的订阅被删除', async () => {
    const calls = mockSupabase([
      ['profiles?select=id,notification_prefs', { status: 200, body: [{ id: 'stu', notification_prefs: {} }] }],
      ['profiles?select=full_name', { status: 200, body: [{ full_name: '王老师' }] }],
      ['learning_sessions?select=student_id&category=eq.3', { status: 200, body: [{ student_id: 'stu' }, { student_id: 'stu' }] }],
      ['push_subscriptions?select=', {
        status: 200,
        body: [
          { user_id: 'stu', endpoint: 'https://push.example/live', p256dh: 'p', auth: 'a' },
          { user_id: 'stu', endpoint: 'https://push.example/dead', p256dh: 'p', auth: 'a' },
        ],
      }],
    ]);
    mockSend.mockImplementation(async (sub) => {
      if (sub.endpoint.endsWith('/dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return { statusCode: 201 };
    });

    const res = makeRes();
    await handler(post({ type: 'invite', student_id: 'stu', teacher_id: 'tea' }), res);

    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: 1, removed: 1 });
    expect(mockSetVapid).toHaveBeenCalledWith('mailto:test@example.com', 'pub-test', 'priv-test');
    const payload = JSON.parse(mockSend.mock.calls[0][1]);
    expect(payload.body).toContain('王老师');
    expect(payload.badge).toBe(2);   // 每条推送都带待补填数量
    const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('push_subscriptions'));
    expect(del.url).toContain(encodeURIComponent('https://push.example/dead'));
    // service role 密钥只出现在服务端到 Supabase 的请求里
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer service-role-test');
  });

  test('invite 缺少 student_id → 400', async () => {
    mockSupabase([]);
    const res = makeRes();
    await handler(post({ type: 'invite' }), res);
    expect(res.code).toBe(400);
  });

  test('未知 type → 400；字符串 body 也能解析', async () => {
    mockSupabase([]);
    const res = makeRes();
    await handler(post('{"type":"bogus"}'), res);
    expect(res.code).toBe(400);
    const bad = makeRes();
    await handler(post('{not json'), bad);
    expect(bad.code).toBe(400);
  });

  test('tick：没有订阅时快速返回', async () => {
    mockSupabase([['push_subscriptions', { status: 200, body: [] }]]);
    const res = makeRes();
    // 固定在非静默时段，避免依赖运行时刻
    jest.useFakeTimers().setSystemTime(new Date('2026-10-21T04:00:00Z')); // 上海 12:00
    await handler(post({ type: 'tick' }), res);
    jest.useRealTimers();
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('/api/notify tick 端到端（mock Supabase）', () => {
  // 上海 2026-10-21 19:00（周三）
  const NOW = new Date('2026-10-21T11:00:00Z');
  const sessionsFor = (lastDate) => [lastDate, '2026-10-01', '2026-10-02'].map((d) => ({
    student_id: 'stu', session_date: d, start_time: '19:00:00', course_id: 'c1', category: 3, form: '自主练习', duration_minutes: 45,
  }));
  const routes = (extra = []) => [
    ['push_subscriptions?select=', { status: 200, body: [{ user_id: 'stu', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }] }],
    ['profiles?select=id,notification_prefs,created_at', { status: 200, body: [{ id: 'stu', notification_prefs: {}, created_at: '2025-01-01T00:00:00Z' }] }],
    ['courses?select=id,name', { status: 200, body: [{ id: 'c1', name: 'AP 微积分 BC' }] }],
    ['learning_sessions?select=student_id&category=eq.3', { status: 200, body: [{ student_id: 'stu' }] }],
    ...extra,
  ];

  async function tick(extra) {
    const calls = mockSupabase(routes(extra));
    mockSend.mockResolvedValue({ statusCode: 201 });
    jest.useFakeTimers().setSystemTime(NOW);
    const res = makeRes();
    await handler(post({ type: 'tick' }), res);
    jest.useRealTimers();
    return { res, calls };
  }

  test('最后记录在 3 天前：推一条带预填链接与 badge 的提醒，并占位', async () => {
    const { res, calls } = await tick([['learning_sessions?select=student_id,session_date', { status: 200, body: sessionsFor('2026-10-18') }]]);
    expect(res.body).toMatchObject({ ok: true, due: 1, sent: 1 });
    const payload = JSON.parse(mockSend.mock.calls[0][1]);
    expect(payload).toMatchObject({ tag: 'yb-inactive', badge: 1 });
    expect(payload.body).toBe('三天没记录了。上次是 AP 微积分 BC · 练习，点一下就能补上。');
    expect(payload.url).toContain('/records?log=1&course=c1&category=3');
    const claim = calls.find((c) => c.method === 'POST' && c.url.includes('push_deliveries'));
    expect(JSON.parse(claim.body)).toEqual({ user_id: 'stu', sent_date: '2026-10-21', kind: 'inactive' });
  });

  test('最后记录在 5 天前：不推送', async () => {
    const { res } = await tick([['learning_sessions?select=student_id,session_date', { status: 200, body: sessionsFor('2026-10-16') }]]);
    expect(res.body).toMatchObject({ ok: true, due: 0, sent: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('/api/notify reinvite（导师令牌）', () => {
  const TEACHER = '11111111-1111-4111-8111-111111111111';
  const STUDENT = '22222222-2222-4222-8222-222222222222';
  const bearer = { authorization: 'Bearer mentor-jwt' };

  function routesFor({ role = 2, pending = [{ id: 'c1' }] } = {}) {
    return [
      ['/auth/v1/user', { status: 200, body: { id: TEACHER } }],
      ['select=role', { status: 200, body: [{ role }] }],
      ['teacher_student_connections', { status: 200, body: pending }],
      ['profiles?select=id,notification_prefs', { status: 200, body: [{ id: STUDENT, notification_prefs: {} }] }],
      ['profiles?select=full_name', { status: 200, body: [{ full_name: '王老师' }] }],
      ['push_subscriptions?select=', {
        status: 200,
        body: [{ user_id: STUDENT, endpoint: 'https://push.example/live', p256dh: 'p', auth: 'a' }],
      }],
    ];
  }

  beforeEach(() => {
    process.env.SUPABASE_ANON_KEY = 'anon-test';
  });

  test('有 status=0 的连接：用导师令牌发出邀请推送，且只查这位导师与这位学生', async () => {
    const calls = mockSupabase(routesFor());
    mockSend.mockResolvedValue({ statusCode: 201 });
    const res = makeRes();
    await handler(post({ type: 'reinvite', student_id: STUDENT }, bearer), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: 1 });
    expect(JSON.parse(mockSend.mock.calls[0][1]).body).toContain('王老师');
    const check = calls.find((c) => c.url.includes('teacher_student_connections'));
    expect(check.url).toContain('status=eq.0');
    expect(check.url).toContain(`teacher_id=eq.${TEACHER}`);
    expect(check.url).toContain(`student_id=eq.${STUDENT}`);
  });

  test('没有 status=0 的连接（例如已接受 / 不是自己的学生）→ 403，不推送', async () => {
    mockSupabase(routesFor({ pending: [] }));
    const res = makeRes();
    await handler(post({ type: 'reinvite', student_id: STUDENT }, bearer), res);
    expect(res.code).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('没有令牌 → 401；学生令牌 → 403；NOTIFY_SECRET 不能代替导师令牌', async () => {
    mockSupabase(routesFor());
    const none = makeRes();
    await handler(post({ type: 'reinvite', student_id: STUDENT }, {}), none);
    expect(none.code).toBe(401);

    mockSupabase(routesFor({ role: 1 }));
    const student = makeRes();
    await handler(post({ type: 'reinvite', student_id: STUDENT }, bearer), student);
    expect(student.code).toBe(403);

    mockSupabase(routesFor());
    const secret = makeRes();
    await handler(post({ type: 'reinvite', student_id: STUDENT }, { 'x-notify-secret': SECRET }), secret);
    expect(secret.code).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('student_id 不是 uuid → 400', async () => {
    mockSupabase(routesFor());
    const res = makeRes();
    await handler(post({ type: 'reinvite', student_id: 'x' }, bearer), res);
    expect(res.code).toBe(400);
  });

  test('导师令牌不能触发 tick / invite（原有行为不变）', async () => {
    mockSupabase(routesFor());
    for (const type of ['tick', 'invite']) {
      const res = makeRes();
      await handler(post({ type, student_id: STUDENT }, bearer), res);
      expect(res.code).toBe(401);
    }
  });
});
