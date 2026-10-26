import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { runTick, addDays } from '../api-lib/notify.mjs';
import { generateDraft, LLM_TIMEOUT_MS } from '../api-lib/supervision-prompt.mjs';

const TODAY = '2026-10-21';
const at = (ymd, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + ((h - 8) * 60 + m) * 60000);
};
const sub = (uid) => ({ user_id: uid, endpoint: `https://push.example/${uid}`, p256dh: 'p', auth: 'a' });
const prof = (id) => ({
  id,
  created_at: '2025-01-01T00:00:00Z',
  notification_prefs: { inactive_reminder: false, daily_reminder: true, daily_reminder_time: '21:00' },
});

function makeStore(users, { failClaimFor } = {}) {
  const claimed = [];
  return {
    claimed,
    listSubscriptions: async () => users.map(sub),
    loadProfiles: async (ids) => users.filter((u) => ids.includes(u)).map(prof),
    loadSessions: async () => new Map(),
    loadPendingCounts: async () => new Map(),
    loadCourseNames: async () => ({}),
    loadDeliveries: async () => [],
    claimDaily: async (uid) => {
      if (uid === failClaimFor) throw new Error('Supabase 500: push_deliveries insert');
      claimed.push(uid);
      return true;
    },
    releaseDaily: async () => {},
    deleteSubscription: async () => {},
    touchSubscriptions: async () => {},
  };
}

describe('runTick 容错', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('一位学生占位时报错，不影响后面的学生收到推送', async () => {
    const store = makeStore(['a', 'b', 'c'], { failClaimFor: 'a' });
    const sendPush = jest.fn().mockResolvedValue({});
    const res = await runTick({ store, sendPush, now: at(TODAY, '21:15') });
    expect(store.claimed).toEqual(['b', 'c']);
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ due: 3, sent: 2, failed: 1 });
  });

  test('超过时间预算就停下：剩下的学生没有占位，留给下一轮', async () => {
    const store = makeStore(['a', 'b', 'c']);
    const sendPush = jest.fn().mockResolvedValue({});
    let t = 0;
    const clock = () => { t += 20000; return t; }; // 每次读时钟前进 20 秒
    const res = await runTick({ store, sendPush, now: at(TODAY, '21:15'), clock, budgetMs: 30000 });
    expect(store.claimed.length).toBeLessThan(3);
    expect(res.deferred).toBe(3 - store.claimed.length);
    expect(addDays(TODAY, 0)).toBe(TODAY);
  });
});

describe('模型请求超时', () => {
  const ORIG = global.fetch;
  afterEach(() => { global.fetch = ORIG; });

  test('每次模型请求都带 AbortSignal 超时，卡住的请求不会拖死函数', async () => {
    const signals = [];
    global.fetch = jest.fn(async (url, init) => {
      signals.push(init.signal);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"text":"昨天数学配方法那节课记上了","evidence":[1]}' } }] }),
      };
    });
    await generateDraft(
      { kind: 'daily', dayN: 3, records: [{ session_date: TODAY, course: '数学', category: 1 }] },
      { LLM_API_KEY: 'k' },
    );
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
    expect(LLM_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });
});

describe('sw.js notificationclick 只打开同源地址', () => {
  function loadSw() {
    const listeners = {};
    const opened = [];
    const self = {
      registration: { scope: 'https://app.example.com/', showNotification: jest.fn() },
      clients: {
        matchAll: async () => [],
        openWindow: async (u) => { opened.push(u); },
        claim: async () => {},
      },
      addEventListener: (t, fn) => { listeners[t] = fn; },
      navigator: {},
    };
    const src = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
    vm.runInNewContext(src, { self, URL, caches: {}, fetch: () => {}, Promise, console });
    return { listeners, opened };
  }
  async function click(url) {
    const { listeners, opened } = loadSw();
    let pending;
    listeners.notificationclick({
      notification: { close() {}, data: { url } },
      waitUntil: (p) => { pending = p; },
    });
    await pending;
    return opened;
  }

  test('同源相对路径照常打开', async () => {
    expect(await click('/records?log=1')).toEqual(['https://app.example.com/records?log=1']);
  });
  test('外站绝对地址回到首页', async () => {
    expect(await click('https://evil.example.net/phish')).toEqual(['https://app.example.com/']);
    expect(await click('//evil.example.net/x')).toEqual(['https://app.example.com/']);
  });
  test('javascript: / 畸形地址回到首页', async () => {
    expect(await click('javascript:alert(1)')).toEqual(['https://app.example.com/']);
    expect(await click('http://[bad')).toEqual(['https://app.example.com/']);
  });
});

describe('SMTP 超时', () => {
  test('createMailer 给 transport 设了连接 / 问候 / socket 超时', async () => {
    const { createMailer } = await import('../api-lib/notify-email.mjs');
    const createTransport = jest.fn(() => ({ sendMail: jest.fn() }));
    createMailer(
      { SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'a@b.c', APP_URL: 'https://x.y', NOTIFY_SECRET: 's' },
      { createTransport },
    );
    const opts = createTransport.mock.calls[0][0];
    for (const k of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
      expect(opts[k]).toBeGreaterThan(0);
      expect(opts[k]).toBeLessThanOrEqual(15000);
    }
  });
});

describe('SQL 补丁约定', () => {
  const dir = path.join(__dirname, '../supabase');
  const files = fs.readdirSync(dir).filter((f) => /^schema\.patch-.*\.sql$/.test(f));

  test.each(files)('%s：security definer 函数都设了 search_path，且不向 anon 开放', (f) => {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*--.*$/gm, '');
    const fns = sql.split(/create or replace function/i).slice(1);
    for (const body of fns) {
      const head = body.split(/\$\$|\$do\$/i)[0];
      if (/security definer/i.test(head)) expect(head).toMatch(/set search_path\s*=\s*public/i);
    }
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b|\btruncate\s+table\b|\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/grant\s+[^;]*\bto\s+(public|anon)\b/i);
  });

  test('push_deliveries / supervision_drafts 对学生零访问', () => {
    const push = fs.readFileSync(path.join(dir, 'schema.patch-push-notifications.sql'), 'utf8');
    expect(push).toMatch(/revoke all on public\.push_deliveries from anon, authenticated/);
    expect(push).not.toMatch(/create policy \w+ on public\.push_deliveries/);
    const sup = fs.readFileSync(path.join(dir, 'schema.patch-supervision.sql'), 'utf8');
    expect(sup).not.toMatch(/auth\.uid\(\)\s*=\s*student_id|student_id\s*=\s*auth\.uid\(\)/);
  });
});
