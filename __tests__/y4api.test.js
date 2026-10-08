import { listStudents, listReports, fetchProtocol, Y4ApiError } from '../src/lib/y4api.js';

describe('Y4 API client', () => {
  afterEach(() => {
    delete global.fetch;
  });

  function mockFetch({ ok = true, status = 200, body, contentType = 'application/json' } = {}) {
    const fn = jest.fn(async () => ({
      ok,
      status,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }));
    global.fetch = fn;
    return fn;
  }

  test('calls same-origin proxy only', async () => {
    const fn = mockFetch({ body: { ok: true, students: [{ id: 1, name: 'Leo' }] } });
    await listStudents();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe('/api/y4/students');
  });

  test('client-side name filter', async () => {
    mockFetch({
      body: { ok: true, students: [{ id: 1, name: 'Leo' }, { id: 2, name: 'Catherine' }] },
    });
    const result = await listStudents('leo');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Leo');
  });

  test('protocol fetch returns markdown text from correct endpoint', async () => {
    const fn = mockFetch({ ok: true, body: '# E4 协议', contentType: 'text/markdown' });
    const md = await fetchProtocol(25);
    expect(md).toBe('# E4 协议');
    expect(fn.mock.calls[0][0]).toBe('/api/y4/reports/25/e4-protocol');
  });

  test('reports list endpoint', async () => {
    mockFetch({ body: { ok: true, reports: [{ id: 25 }] } });
    const reports = await listReports(25);
    expect(reports[0].id).toBe(25);
  });

  test('surfaces Chinese messages for known status codes', async () => {
    mockFetch({ ok: false, status: 429, body: { ok: false, error: 'rate limited' } });
    await expect(fetchProtocol(25)).rejects.toMatchObject({
      name: 'Y4ApiError',
      status: 429,
      message: expect.stringContaining('频繁'),
    });
  });

  test('abort signal is forwarded', async () => {
    const fn = jest.fn((url, opts) => {
      expect(opts.signal).toBeDefined();
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    global.fetch = fn;
    const controller = new AbortController();
    const promise = fetchProtocol(25, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
  });

  test('Y4ApiError type on missing ids', async () => {
    await expect(listReports('')).rejects.toBeInstanceOf(Y4ApiError);
    await expect(fetchProtocol('')).rejects.toBeInstanceOf(Y4ApiError);
  });
});

// 上游偶发 502/连接中断：列表与文档请求在客户端自动重试一次（4xx 不重试）
describe('Y4 API client 的自动重试', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('5xx 会重试一次并成功', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 502,
          headers: { get: () => 'application/json' },
          json: async () => ({ ok: false, error: '无法连接 Y4 服务' }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true, students: [{ id: 48, name: 'Sean' }] }),
      };
    });

    const rows = await listStudents();
    expect(calls).toBe(2);
    expect(rows[0].name).toBe('Sean');
  });

  test('网络错误会重试一次并成功（Sean 报告列表的线上形态）', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true, reports: [{ id: 46 }] }),
      };
    });

    const reports = await listReports(48);
    expect(calls).toBe(2);
    expect(reports[0].id).toBe(46);
  });

  test('4xx 不重试，直接失败', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return {
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: false, error: '仅导师及以上账号可使用 Y4 相关功能' }),
      };
    });

    await expect(listStudents()).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(1);
  });

  test('两次都失败时报出最终错误', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    });

    await expect(listReports(48)).rejects.toThrow('无法连接 Y4 代理');
    expect(calls).toBe(2);
  });

  test('e4-protocol 不重试（避免重复触发上游 AI 生成）', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return {
        ok: false,
        status: 502,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: false, error: '上游 AI 超时' }),
      };
    });

    await expect(fetchProtocol(46)).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(1);
  });
});
