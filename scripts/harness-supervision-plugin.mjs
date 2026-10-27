// 本地调提示词用的 Vite 插件：在 harness 的 dev server 上提供 POST /api/supervision。
// 固定走 preview 类型（只调模型、不碰数据库），模型配置读 .env.local，与 scripts/supervision-dry-run.mjs 一致。
//
// 在 vite.harness.config.js 里加两行：
//   import { supervisionHarness } from './scripts/harness-supervision-plugin.mjs';
//   plugins: [..., supervisionHarness()]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 「换个说法」用完之后的重新生成：本地只返回带 C2 字段的示例，不调模型。
const MOCK_REGEN = [
  '昨天那份记录里，物理和数学各一条。牛顿定律那节先复习，再做斜面练习。',
  '斜面那题受力图改过之后，第二天又记了一次牛顿定律的复习，节奏接得比较紧。',
];
let regenCount = 0;

export function loadEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export function supervisionHarness({ envFile = path.join(root, '.env.local') } = {}) {
  return {
    name: 'supervision-harness',
    configureServer(server) {
      const env = loadEnvFile(envFile);
      for (const key of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_EXTRA_BODY']) {
        if (env[key] && !process.env[key]) process.env[key] = env[key];
      }
      server.middlewares.use('/api/supervision', async (req, res) => {
        const send = (code, payload) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(payload));
        };
        if (req.method !== 'POST') return send(405, { ok: false, error: '仅支持 POST 请求' });
        const chunks = [];
        for await (const c of req) chunks.push(c);
        let body;
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { ok: false, error: '请求体不是合法 JSON' });
        }
        if (body.type === 'regenerate') {
          const bodyText = MOCK_REGEN[regenCount++ % MOCK_REGEN.length];
          return send(200, {
            ok: true,
            draft: {
              id: body.draft_id,
              body: bodyText,
              edited_body: null,
              meta: {
                why: '本地示例 · 按最新记录重写',
                facts: ['本地 harness 示例，不是真实模型输出'],
                alts: [MOCK_REGEN[regenCount % MOCK_REGEN.length]],
                lint: [],
              },
            },
          });
        }
        try {
          const { createHandler } = await import(path.join(root, 'api/supervision/index.js'));
          // 固定 preview：harness 里不应触达数据库
          req.body = { ...body, type: 'preview' };
          req.headers['x-supervision-dev'] = '1';
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (data) => {
            if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(data));
          };
          await createHandler()(req, res);
        } catch (err) {
          send(500, { ok: false, error: `本地执行失败：${err.message}` });
        }
      });
    },
  };
}
