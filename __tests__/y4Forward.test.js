import { forwardViaFetch } from '../api-lib/y4-forward.mjs';

// 上游（Cloudflare 隧道）实测存在偶发连接抖动：fetch 直接抛错。
// 只读列表类请求允许重试一次；e4-protocol（触发上游 AI，10-30 秒）不重试。
describe('forwardViaFetch 的重试策略', () => {
  afterEach(() => {
    delete global.fetch;
  });

  function okResponse(body = '{"ok":true}') {
    return {
      status: 200,
      arrayBuffer: async () => Buffer.from(body),
      headers: { get: () => 'application/json; charset=utf-8' },
    };
  }

  test('attempts=2 时首次网络失败会重试并成功', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('fetch failed');
      return okResponse('{"ok":true,"students":[]}');
    });

    const result = await forwardViaFetch({ apiKey: 'k', subpath: 'students', attempts: 2 });
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
    expect(String(result.body)).toContain('students');
  });

  test('默认 attempts=1 不重试，直接抛出（保护 e4-protocol 这类慢端点）', async () => {
    global.fetch = jest.fn(async () => { throw new Error('fetch failed'); });
    await expect(forwardViaFetch({ apiKey: 'k', subpath: 'reports/46/e4-protocol' })).rejects.toThrow('fetch failed');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('两次都失败时抛出最后一次错误', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      throw new Error(`fetch failed #${calls}`);
    });
    await expect(forwardViaFetch({ apiKey: 'k', subpath: 'students/48/reports', attempts: 2 }))
      .rejects.toThrow('fetch failed #2');
    expect(calls).toBe(2);
  });

  test('上游返回非 2xx 不算网络失败（不重试，原样透传状态码）', async () => {
    global.fetch = jest.fn(async () => ({
      status: 429,
      arrayBuffer: async () => Buffer.from('{"error":"rate limited"}'),
      headers: { get: () => 'application/json' },
    }));
    const result = await forwardViaFetch({ apiKey: 'k', subpath: 'students', attempts: 2 });
    expect(result.status).toBe(429);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});