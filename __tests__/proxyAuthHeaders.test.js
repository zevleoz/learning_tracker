import { listStudents } from '../src/lib/y4api.js';
import { summarizeMeetingNotes, generateCellNote, prefillPrepSubjects } from '../src/lib/llm.js';
import { supabase } from '../src/__mocks__/supabase.js';

// 前端代理调用必须携带 Supabase access_token（SEC-1 的客户端一半）
function mockFetch(body = { ok: true }) {
  const fn = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }));
  global.fetch = fn;
  return fn;
}

describe('代理请求的登录态注入', () => {
  beforeEach(() => {
    supabase.__setAuthState({
      user: { id: 'u-1' },
      session: { access_token: 'tok-123', user: { id: 'u-1' } },
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('y4api 携带 Authorization 头', async () => {
    const fn = mockFetch({ ok: true, students: [] });
    await listStudents();
    expect(fn.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok-123' });
  });

  test('llm 的三个端点都携带 Authorization 头', async () => {
    const fn = mockFetch({ ok: true, notes: {} });
    await summarizeMeetingNotes('纪要', [{ rowId: 'r1', label: 'x' }]);
    await generateCellNote({ minutes: '纪要', label: 'x' });
    await prefillPrepSubjects({ protocolMd: '协议' });
    expect(fn).toHaveBeenCalledTimes(3);
    for (const call of fn.mock.calls) {
      expect(call[1].headers.Authorization).toBe('Bearer tok-123');
      expect(call[1].headers['Content-Type']).toBe('application/json');
    }
  });

  test('未登录时不附 Authorization 头（由服务端返回 401）', async () => {
    supabase.__setAuthState({ user: null, session: null });
    const fn = mockFetch({ ok: true, students: [] });
    await listStudents();
    expect(fn.mock.calls[0][1].headers).toBeUndefined();

    const fn2 = mockFetch({ ok: true, notes: {} });
    await summarizeMeetingNotes('纪要', [{ rowId: 'r1', label: 'x' }]);
    expect(fn2.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fn2.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });
});