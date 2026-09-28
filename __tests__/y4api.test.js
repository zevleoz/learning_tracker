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
