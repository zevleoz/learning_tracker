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

// 直连 origin 可能遇到跨境抖动：主端点全部尝试失败后自动回退到 Cloudflare 域名
describe('forwardViaFetch 的多端点故障转移', () => {
  afterEach(() => {
    delete global.fetch;
  });

  const ok = () => ({
    status: 200,
    arrayBuffer: async () => Buffer.from('{"ok":true}'),
    headers: { get: () => 'application/json' },
  });

  test('主端点两次都失败 → 自动切备用端点并成功', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('origin.p4learning-ark.app')) throw new Error('origin unreachable');
      return ok();
    });

    const result = await forwardViaFetch({
      base: 'https://origin.p4learning-ark.app/api/v1',
      fallbackBase: 'https://report.p4learning-ark.app/api/v1',
      apiKey: 'k',
      subpath: 'students/48/reports',
      attempts: 2,
    });

    expect(result.status).toBe(200);
    expect(calls.filter((u) => u.includes('origin.p4learning-ark.app'))).toHaveLength(2); // 主端点用满两次
    expect(calls[calls.length - 1]).toBe('https://report.p4learning-ark.app/api/v1/students/48/reports');
  });

  test('主端点成功时不碰备用端点', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      return ok();
    });

    await forwardViaFetch({
      base: 'https://origin.p4learning-ark.app/api/v1',
      fallbackBase: 'https://report.p4learning-ark.app/api/v1',
      apiKey: 'k',
      subpath: 'students',
      attempts: 2,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('origin.p4learning-ark.app');
  });

  test('两端都失败 → 抛出最后一次错误', async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('origin')) throw new Error('origin unreachable');
      throw new Error('cf unreachable');
    });

    await expect(forwardViaFetch({
      base: 'https://origin.p4learning-ark.app/api/v1',
      fallbackBase: 'https://report.p4learning-ark.app/api/v1',
      apiKey: 'k',
      subpath: 'students',
      attempts: 2,
    })).rejects.toThrow('cf unreachable');
    expect(global.fetch).toHaveBeenCalledTimes(4); // 2 主 + 2 备
  });

  test('主备端点相同（尚未切换直连）时不重复请求', async () => {
    global.fetch = jest.fn(async () => { throw new Error('boom'); });
    await expect(forwardViaFetch({
      base: 'https://report.p4learning-ark.app/api/v1',
      fallbackBase: 'https://report.p4learning-ark.app/api/v1',
      apiKey: 'k',
      subpath: 'students',
      attempts: 2,
    })).rejects.toThrow('boom');
    expect(global.fetch).toHaveBeenCalledTimes(2); // 只有主端点两次
  });
});

// CF 默认不缓存带 Authorization 的请求：上游支持后可切到 X-Api-Key
describe('forwardViaFetch 的鉴权头形态', () => {
  afterEach(() => {
    delete global.fetch;
  });

  function captureFetch() {
    const calls = [];
    global.fetch = jest.fn(async (url, options) => {
      calls.push({ url: String(url), headers: options?.headers });
      return {
        status: 200,
        arrayBuffer: async () => Buffer.from('{"ok":true}'),
        headers: { get: () => 'application/json' },
      };
    });
    return calls;
  }

  test('默认使用 Authorization: Bearer', async () => {
    const calls = captureFetch();
    await forwardViaFetch({ apiKey: 'secret-key', subpath: 'students' });
    expect(calls[0].headers).toEqual({ Authorization: 'Bearer secret-key' });
  });

  test('authHeader=x-api-key 时改用 X-Api-Key，且不带 Authorization（可被 CF 缓存）', async () => {
    const calls = captureFetch();
    await forwardViaFetch({ apiKey: 'secret-key', subpath: 'students', authHeader: 'x-api-key' });
    expect(calls[0].headers).toEqual({ 'X-Api-Key': 'secret-key' });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });
});