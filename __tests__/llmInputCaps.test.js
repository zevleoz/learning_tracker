import meetingNotes from '../api/llm/meeting-notes.js';
import cellNote from '../api/llm/cell-note.js';
import prepPrefill from '../api/llm/prep-prefill.js';

// SEC-5：LLM 端点输入上限。鉴权通过（mock 掉 require-mentor 依赖的两个上游请求）。
function makeRes() {
  return {
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
}

function makeReq(payload) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer mentor-token' },
    body: payload,
  };
}

function mockUpstream({ llmContent = '{"note":"","evidence":[]}' } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(String(url));
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, status: 200, json: async () => ({ id: 'uid-1' }) };
    }
    if (String(url).includes('/rest/v1/profiles')) {
      return { ok: true, status: 200, json: async () => [{ role: 2 }] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: llmContent } }] }),
      text: async () => '',
    };
  });
  return calls;
}

describe('LLM 端点输入上限（SEC-5）', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.LLM_API_KEY = 'llm-key';
    mockUpstream();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete global.fetch;
  });

  test('meeting-notes：超长纪要返回 400', async () => {
    const res = makeRes();
    await meetingNotes(makeReq({ minutes: 'a'.repeat(40001), rows: [{ rowId: 'r1', label: 'x' }] }), res);
    expect(res.code).toBe(400);
    expect(res.body.error).toContain('过长');
  });

  test('meeting-notes：排查项超过 50 条返回 400', async () => {
    const res = makeRes();
    const rows = Array.from({ length: 51 }, (_, i) => ({ rowId: `r${i}`, label: `第 ${i} 项` }));
    await meetingNotes(makeReq({ minutes: '纪要', rows }), res);
    expect(res.code).toBe(400);
    expect(res.body.error).toContain('超出上限');
  });

  test('cell-note：超长纪要返回 400', async () => {
    const res = makeRes();
    await cellNote(makeReq({ minutes: 'a'.repeat(40001), label: '排查项' }), res);
    expect(res.code).toBe(400);
    expect(res.body.error).toContain('过长');
  });

  test('prep-prefill：超长协议返回 400', async () => {
    const res = makeRes();
    await prepPrefill(makeReq({ protocolMd: 'a'.repeat(60001) }), res);
    expect(res.code).toBe(400);
    expect(res.body.error).toContain('过长');
  });

  test('未登录（无 token）→ 401，不触达 LLM', async () => {
    const calls = mockUpstream();
    const res = makeRes();
    const req = { method: 'POST', headers: {}, body: { minutes: '纪要', rows: [{ rowId: 'r1', label: 'x' }] } };
    await meetingNotes(req, res);
    expect(res.code).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('正常输入仍可走通（鉴权 + LLM 调用）', async () => {
    const calls = mockUpstream({ llmContent: '{"note":"学生提到每天练习 30 分钟","evidence":["每天练 30 分钟"]}' });
    const res = makeRes();
    await cellNote(makeReq({ minutes: '会议纪要内容', label: '练习习惯' }), res);
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.note).toContain('30 分钟');
    expect(calls.some((u) => u.includes('/chat/completions'))).toBe(true);
  });
});