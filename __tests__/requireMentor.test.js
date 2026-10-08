import { requireMentor, bearerToken, sendDenied } from '../api-lib/require-mentor.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// 按 URL 分派：auth 校验 + profiles 角色查询
function mockAuthFetch({ user = { id: 'uid-1' }, userStatus = 200, role = 2, profileStatus = 200 } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('/auth/v1/user')) return jsonResponse(userStatus, user);
    if (String(url).includes('/rest/v1/profiles')) return jsonResponse(profileStatus, [{ role }]);
    throw new Error(`unexpected fetch: ${url}`);
  });
  return calls;
}

const reqWith = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('requireMentor（SEC-1 服务端鉴权）', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    mockAuthFetch();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete global.fetch;
  });

  test('无 token → 401，且不发起任何上游请求', async () => {
    const calls = mockAuthFetch();
    const result = await requireMentor(reqWith(''));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(calls).toHaveLength(0);
  });

  test('token 无效（auth 返回 401）→ 401', async () => {
    mockAuthFetch({ userStatus: 401, user: { message: 'invalid jwt' } });
    const result = await requireMentor(reqWith('bad-token'));
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  test('学生角色（role=1）→ 403', async () => {
    mockAuthFetch({ role: 1 });
    const result = await requireMentor(reqWith('student-token'));
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(result.error).toContain('导师');
  });

  test('导师角色（role=2）→ 放行并返回 role', async () => {
    mockAuthFetch({ role: 2 });
    const result = await requireMentor(reqWith('mentor-token'));
    expect(result.ok).toBe(true);
    expect(result.role).toBe(2);
  });

  test('profiles 查不到记录 → 403（fail-closed）', async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/auth/v1/user')) return jsonResponse(200, { id: 'uid-1' });
      return jsonResponse(200, []);
    });
    const result = await requireMentor(reqWith('mentor-token'));
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  test('缺少服务端环境变量 → 503', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    const result = await requireMentor(reqWith('mentor-token'));
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  test('认证服务网络失败 → 502', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await requireMentor(reqWith('mentor-token'));
    expect(result).toMatchObject({ ok: false, status: 502 });
  });

  test('token 请求携带 anon key 且回传 profiles 查询', async () => {
    const calls = mockAuthFetch({ role: 2 });
    await requireMentor(reqWith('mentor-token'));
    expect(calls[0].url).toContain('/auth/v1/user');
    expect(calls[0].options.headers.Authorization).toBe('Bearer mentor-token');
    expect(calls[1].url).toContain('/rest/v1/profiles?id=eq.uid-1&select=role');
  });
});

describe('bearerToken / sendDenied', () => {
  test('解析大小写不同的 Bearer 头', () => {
    expect(bearerToken({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(bearerToken({ headers: { Authorization: 'bearer  abc  ' } })).toBe('abc');
    expect(bearerToken({ headers: {} })).toBe('');
    expect(bearerToken({})).toBe('');
  });

  test('sendDenied 输出统一 JSON 结构', () => {
    const res = {
      code: null,
      body: null,
      status(code) {
        this.code = code;
        return this;
      },
      json(data) {
        this.body = data;
      },
    };
    sendDenied(res, { status: 403, error: '仅导师及以上账号可使用该功能' });
    expect(res.code).toBe(403);
    expect(res.body).toEqual({ ok: false, error: '仅导师及以上账号可使用该功能' });
  });
});