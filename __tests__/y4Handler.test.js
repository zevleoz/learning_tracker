import handler from '../api/y4/[...path].js';

// 线上回归：Vercel 的 catch-all 路由实测不填充 req.query.path，
// 旧实现只读 query → 子路径为空 → 误报「缺少 Y4 接口路径」。
// 这里直接调用 serverless handler，确认在 query 缺失时仍按 URL 正确转发。
function makeRes() {
  return {
    code: null,
    headers: {},
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    send(data) {
      this.body = data;
    },
    json(data) {
      this.body = data;
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

describe('Y4 代理 handler 的路径解析', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.Y4_API_KEY = 'y4-key';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete global.fetch;
  });

  function mockUpstream({ y4Body = '{"students":[]}' } = {}) {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      const u = String(url);
      if (u.includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'uid-1' }) };
      if (u.includes('/rest/v1/profiles')) return { ok: true, status: 200, json: async () => [{ role: 2 }] };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from(y4Body),
        headers: { get: () => 'application/json; charset=utf-8' },
      };
    });
    return calls;
  }

  test('req.query.path 缺失时按 req.url 解析并转发（线上回归）', async () => {
    const calls = mockUpstream();
    const res = makeRes();
    await handler({ method: 'GET', url: '/api/y4/students', headers: { authorization: 'Bearer t' }, query: {} }, res);
    expect(res.code).toBe(200);
    expect(calls.some((u) => u === 'https://report.p4learning-ark.app/api/v1/students')).toBe(true);
  });

  test('非 students 白名单路径被拒（400），不触达 Y4', async () => {
    const calls = mockUpstream();
    const res = makeRes();
    await handler({ method: 'GET', url: '/api/y4/courses', headers: { authorization: 'Bearer t' }, query: {} }, res);
    expect(res.code).toBe(400);
    expect(calls.every((u) => !u.includes('p4learning-ark'))).toBe(true);
  });

  test('query 为数组形态时同样可用（Next 风格路由）', async () => {
    const calls = mockUpstream();
    const res = makeRes();
    await handler(
      { method: 'GET', url: 'https://x.vercel.app/api/y4/students/25/reports', headers: { authorization: 'Bearer t' }, query: { path: ['students', '25', 'reports'] } },
      res
    );
    expect(res.code).toBe(200);
    expect(calls.some((u) => u.endsWith('/api/v1/students/25/reports'))).toBe(true);
  });

  test('query 字符串与查询串一起保留', async () => {
    const calls = mockUpstream();
    const res = makeRes();
    await handler({ method: 'GET', url: '/api/y4/reports/27/y4-md?include_raw=1', headers: { authorization: 'Bearer t' }, query: {} }, res);
    expect(res.code).toBe(200);
    expect(calls.some((u) => u.endsWith('/api/v1/reports/27/y4-md?include_raw=1'))).toBe(true);
  });
});