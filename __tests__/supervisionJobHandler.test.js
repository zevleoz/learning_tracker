import { createHandler } from '../api/supervision/index.js';

const SECRET = 'test-secret';
const ENV = { ...process.env };
const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const DRAFT_ID = '44444444-4444-4444-8444-444444444444';

function makeRes() {
  return {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; },
  };
}

const post = (body, headers = {}) => ({ method: 'POST', headers, body });

/** requireMentor 走 fetch：按 URL 回放 */
function mockAuth({ role = 2, id = TEACHER, authOk = true } = {}) {
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/auth/v1/user')) {
      return { ok: authOk, status: authOk ? 200 : 401, json: async () => ({ id }) };
    }
    if (url.includes('select=role')) return { ok: true, status: 200, json: async () => [{ role }] };
    return { ok: true, status: 200, json: async () => [] };
  });
}

function fakeStore({ connections = [], draft } = {}) {
  const store = {
    getDraft: jest.fn(async (id) => (draft && id === draft.id ? draft : null)),
    hasActiveConnection: jest.fn(async (t, s) => connections.some((c) => c.teacher_id === t && c.student_id === s)),
    getProfile: jest.fn(async () => ({ id: 's1', created_at: '2026-10-01T00:00:00Z' })),
    loadRecords: jest.fn(async () => [{
      id: 'r1', student_id: 's1', session_date: '2026-10-25', course: '物理', chapter: '', unit: '', category: 1, form: '自主复习',
    }]),
    updateDraft: jest.fn(async (id, patch) => ({ ...draft, ...patch })),
    listScopeStudents: jest.fn(async () => []),
    lastSent: jest.fn(async () => null),
    styleRefs: jest.fn(async () => []),
    rejected: jest.fn(async () => []),
    loadExams: jest.fn(async () => []),
    listOpenDrafts: jest.fn(async () => []),
    dropDrafts: jest.fn(async () => 0),
  };
  return store;
}

const baseDraft = {
  id: DRAFT_ID, student_id: 's1', kind: 'daily', period_start: '2026-10-25', period_end: '2026-10-25',
  body: '旧', edited_body: '改过', status: 'sent',
};

beforeEach(() => {
  process.env.NOTIFY_SECRET = SECRET;
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ENV };
  delete global.fetch;
  jest.restoreAllMocks();
});

describe('/api/supervision run', () => {
  test('没有或错误的密钥 → 401；非 POST → 405', async () => {
    const h = createHandler({ makeStore: () => fakeStore() });
    const a = makeRes();
    await h(post({ type: 'run' }), a);
    expect(a.code).toBe(401);
    const b = makeRes();
    await h(post({ type: 'run' }, { 'x-notify-secret': 'nope' }), b);
    expect(b.code).toBe(401);
    const c = makeRes();
    await h({ method: 'GET', headers: {} }, c);
    expect(c.code).toBe(405);
  });

  test('密钥正确 → 跑任务并返回摘要；导师令牌不能触发', async () => {
    const store = fakeStore();
    const h = createHandler({ makeStore: () => store });
    // 固定在非静默时段
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T02:00:00Z'));
    const res = makeRes();
    await h(post({ type: 'run' }, { 'x-notify-secret': SECRET }), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, created: 0 });
    expect(store.listScopeStudents).toHaveBeenCalled();

    store.listScopeStudents.mockClear();
    mockAuth();
    const viaJwt = makeRes();
    await h(post({ type: 'run' }, { authorization: 'Bearer mentor-jwt' }), viaJwt);
    jest.useRealTimers();
    expect(viaJwt.code).toBe(401);
    expect(store.listScopeStudents).not.toHaveBeenCalled();
  });
});

describe('/api/supervision regenerate', () => {
  const bearer = { authorization: 'Bearer mentor-jwt' };
  const gen = jest.fn(async () => ({ text: '新稿', evidence: [1] }));

  test('已连接的导师：重新生成，覆盖 body、清空 edited_body、状态回到 draft', async () => {
    mockAuth();
    const store = fakeStore({ draft: baseDraft, connections: [{ teacher_id: TEACHER, student_id: 's1' }] });
    const res = makeRes();
    await createHandler({ makeStore: () => store, generate: gen })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res);
    expect(res.code).toBe(200);
    expect(store.updateDraft).toHaveBeenCalledWith(DRAFT_ID, expect.objectContaining({ body: '新稿', edited_body: null, status: 'draft' }));
    expect(res.body.draft).toMatchObject({ body: '新稿', edited_body: null, status: 'draft' });
  });

  test('新的种类也能重新生成：提醒（nudge）、周小结 + 提醒；刷新 meta.alts', async () => {
    mockAuth();
    const connections = [{ teacher_id: TEACHER, student_id: 's1' }];
    const rich = jest.fn(async () => ({ text: '新稿', evidence: [], alts: ['备选'], facts: ['f'], why: '理由', lint: [] }));

    const nudge = { ...baseDraft, kind: 'nudge', period_start: '2026-10-26', period_end: '2026-10-26', meta: { alts: ['旧'] } };
    const store = fakeStore({ draft: nudge, connections });
    const res = makeRes();
    await createHandler({ makeStore: () => store, generate: rich })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res);
    expect(res.code).toBe(200);
    expect(rich.mock.calls[0][0]).toMatchObject({ kind: 'nudge', records: [] });
    expect(store.updateDraft).toHaveBeenCalledWith(DRAFT_ID, expect.objectContaining({
      body: '新稿', status: 'draft', snooze_until: null, meta: expect.objectContaining({ alts: ['备选'] }),
    }));

    const weekly = { ...baseDraft, kind: 'weekly', period_start: '2026-10-19', period_end: '2026-10-25', meta: { nudge: true } };
    const store2 = fakeStore({ draft: weekly, connections });
    const res2 = makeRes();
    await createHandler({ makeStore: () => store2, generate: rich })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res2);
    expect(res2.code).toBe(200);
    expect(rich.mock.calls[1][0]).toMatchObject({ kind: 'weekly', combineNudge: true });
  });

  test('提醒草稿同样受导师连接检查保护：没连接的导师 → 403，不调用模型', async () => {
    mockAuth({ id: OTHER });
    const g = jest.fn();
    const nudge = { ...baseDraft, kind: 'nudge', period_start: '2026-10-26', period_end: '2026-10-26' };
    const store = fakeStore({ draft: nudge, connections: [{ teacher_id: TEACHER, student_id: 's1' }] });
    const res = makeRes();
    await createHandler({ makeStore: () => store, generate: g })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res);
    expect(res.code).toBe(403);
    expect(g).not.toHaveBeenCalled();
  });

  test('已撤下（dropped）的草稿 → 409，不调用模型', async () => {
    mockAuth();
    const g = jest.fn();
    const dropped = { ...baseDraft, status: 'dropped' };
    const store = fakeStore({ draft: dropped, connections: [{ teacher_id: TEACHER, student_id: 's1' }] });
    const res = makeRes();
    await createHandler({ makeStore: () => store, generate: g })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res);
    expect(res.code).toBe(409);
    expect(g).not.toHaveBeenCalled();
  });

  test('没有连接这位学生的导师 → 403，且不调用模型、不写库', async () => {
    mockAuth({ id: OTHER });
    const g = jest.fn();
    const store = fakeStore({ draft: baseDraft, connections: [{ teacher_id: TEACHER, student_id: 's1' }] });
    const res = makeRes();
    await createHandler({ makeStore: () => store, generate: g })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res);
    expect(res.code).toBe(403);
    expect(g).not.toHaveBeenCalled();
    expect(store.updateDraft).not.toHaveBeenCalled();
  });

  test('管理员（role ≥ 3）可处理任意学生', async () => {
    mockAuth({ id: OTHER, role: 3 });
    const store = fakeStore({ draft: baseDraft, connections: [] });
    const res = makeRes();
    await createHandler({ makeStore: () => store, generate: gen })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res);
    expect(res.code).toBe(200);
    expect(store.hasActiveConnection).not.toHaveBeenCalled();
  });

  test('学生令牌 → 403；无令牌 → 401；坏 draft_id → 400；找不到 → 404', async () => {
    const h = createHandler({ makeStore: () => fakeStore({ draft: baseDraft }), generate: gen });
    mockAuth({ role: 1 });
    const student = makeRes();
    await h(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), student);
    expect(student.code).toBe(403);

    mockAuth();
    const none = makeRes();
    await h(post({ type: 'regenerate', draft_id: DRAFT_ID }, {}), none);
    expect(none.code).toBe(401);

    const bad = makeRes();
    await h(post({ type: 'regenerate', draft_id: 'x' }, bearer), bad);
    expect(bad.code).toBe(400);

    const missing = makeRes();
    await h(post({ type: 'regenerate', draft_id: '55555555-5555-4555-8555-555555555555' }, bearer), missing);
    expect(missing.code).toBe(404);
  });

  test('模型失败 → 502 并带原因，草稿不变', async () => {
    mockAuth();
    const store = fakeStore({ draft: baseDraft, connections: [{ teacher_id: TEACHER, student_id: 's1' }] });
    const res = makeRes();
    const failing = jest.fn(async () => { throw new Error('模型请求失败（HTTP 500）'); });
    await createHandler({ makeStore: () => store, generate: failing })(post({ type: 'regenerate', draft_id: DRAFT_ID }, bearer), res);
    expect(res.code).toBe(502);
    expect(res.body.error).toContain('模型请求失败');
    expect(store.updateDraft).not.toHaveBeenCalled();
  });
});

describe('/api/supervision preview', () => {
  const input = { type: 'preview', kind: 'daily', dayN: 5, records: [{ session_date: '2026-10-25', course: '物理', category: 1 }] };
  const dev = { 'x-supervision-dev': '1' };

  test('生产环境一律 404（即使带开发头），不调用模型', async () => {
    process.env.NODE_ENV = 'production';
    const g = jest.fn();
    const res = makeRes();
    await createHandler({ generate: g })(post(input, dev), res);
    expect(res.code).toBe(404);
    expect(g).not.toHaveBeenCalled();
  });

  test('非生产但没有开发头 → 404', async () => {
    process.env.NODE_ENV = 'development';
    const res = makeRes();
    await createHandler({ generate: jest.fn() })(post(input, {}), res);
    expect(res.code).toBe(404);
  });

  test('非生产且带开发头：直接返回模型输出，不碰数据库', async () => {
    process.env.NODE_ENV = 'development';
    global.fetch = jest.fn();
    const g = jest.fn(async () => ({ text: '稿', evidence: [1] }));
    const makeStore = jest.fn();
    const res = makeRes();
    await createHandler({ makeStore, generate: g })(post({ ...input, issues: ['a'] }, dev), res);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ ok: true, text: '稿', evidence: [1] });
    expect(g.mock.calls[0][0]).toMatchObject({ kind: 'daily', dayN: 5, issues: ['a'] });
    expect(makeStore).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('未知 type → 400', async () => {
    const res = makeRes();
    await createHandler()(post({ type: 'bogus' }), res);
    expect(res.code).toBe(400);
  });
});
