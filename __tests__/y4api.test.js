import { listStudents, listReports, fetchProtocol, Y4ApiError } from '../src/lib/y4api.js';
import studentsFixture from './fixtures/y4_students.json';
import reportsFixture from './fixtures/y4_reports.json';

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

// 契约测试：fixtures 取自线上真实响应（已脱敏）。
// 上游字段漂移时（改名/包裹层变化/null 语义变化）这些用例会先红，而不是线上用户先撞到。
describe('Y4 响应形状契约（fixtures）', () => {
  afterEach(() => {
    delete global.fetch;
  });

  function fixtureFetch(body) {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => body,
      text: async () => JSON.stringify(body),
    }));
  }

  test('students：字段与 null 语义保持稳定', async () => {
    fixtureFetch(studentsFixture);
    const all = await listStudents();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: 101, name: 'Sample Student A', report_count: 2, grade: '初一' });
    // 空字段必须原样保留 null（建档向导依赖 latest_report_date 为空时不渲染日期）
    expect(all[1]).toMatchObject({ id: 102, latest_report_date: null, school: null });
  });

  test('reports：倒序列表字段解析（最新在前）', async () => {
    fixtureFetch(reportsFixture);
    const rs = await listReports(101);
    expect(rs.map((r) => r.id)).toEqual([201, 200]);
    expect(rs[1].has_interpretation).toBe(true);
  });

  test('上游 404：把上游原文拼进报错信息（供线上报障截图定位）', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: false, code: 'NOT_FOUND', error: '报告不存在' }),
    }));

    await expect(listReports(101)).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('报告不存在'),
    });
    expect(warn).toHaveBeenCalledWith('[y4api] Y4 请求失败', expect.objectContaining({ status: 404, detail: '报告不存在' }));
    warn.mockRestore();
  });
});
