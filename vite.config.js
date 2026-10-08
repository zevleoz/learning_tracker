import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Y4_API_BASE, forwardViaFetch } from './api-lib/y4-forward.mjs';
import { requireMentor } from './api-lib/require-mentor.js';
import { validateY4Subpath } from './api-lib/y4-path.js';
import { reachableFiles, SURFACE_SEEDS, SURFACES } from './scripts/surfaceHashes.js';

// ----------------------------------------------------------------
// 版本分区摘要：
// 从各使用面入口沿静态 import 图推导真实文件归属（scripts/surfaceHashes.js），
// 分别计算 sha256。只改导师端/E4 时，学生摘要不变、不会收到提示。
// ----------------------------------------------------------------

const RESOLVE_EXTENSIONS = [
  '.jsx', '.js', '.mjs', '.json', '.css',
  '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp',
];

function listFilesRel(absDir, relBase) {
  const out = [];
  for (const name of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    const rel = `${relBase}/${name}`;
    if (fs.statSync(abs).isDirectory()) out.push(...listFilesRel(abs, rel));
    else out.push(rel);
  }
  return out;
}

function makeGraphDeps(root) {
  // specifier -> 项目内相对路径；bare / 外部包返回 null
  const resolve = (specifier, importerRel) => {
    let base;
    if (specifier.startsWith('@/')) {
      base = path.join(root, 'src', specifier.slice(2));
    } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      base = path.join(path.dirname(path.join(root, importerRel)), specifier);
    } else {
      return null;
    }
    const candidates = [
      base,
      ...RESOLVE_EXTENSIONS.map((e) => base + e),
      ...RESOLVE_EXTENSIONS.map((e) => path.join(base, `index${e}`)),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) return path.relative(root, candidate);
      } catch {
        // 尝试下一个候选
      }
    }
    return null;
  };

  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  return { resolve, read };
}

async function computeSurfaceBuilds(root) {
  const { resolve, read } = makeGraphDeps(root);

  const seeds = {
    ...SURFACE_SEEDS,
    e4: fs
      .readdirSync(path.join(root, 'src/pages/e4'))
      .filter((n) => n.endsWith('.jsx'))
      .map((n) => `src/pages/e4/${n}`),
  };

  // 外壳文件计入全部面：改动后所有用户都提示
  const globalFiles = [
    'index.html',
    'package.json',
    'public/manifest.json',
    'src/main.jsx',
    'src/App.jsx',
    'src/index.css',
    ...listFilesRel(path.join(root, 'public/icons'), 'public/icons'),
  ];

  const builds = {};
  for (const surface of SURFACES) {
    const files = await reachableFiles(seeds[surface], { read, resolve });
    for (const g of globalFiles) files.add(g);

    const hash = crypto.createHash('sha256');
    for (const rel of [...files].sort()) {
      hash.update(rel);
      hash.update(fs.readFileSync(path.join(root, rel))); // 图片等二进制按 Buffer 哈希
    }
    builds[surface] = hash.digest('hex').slice(0, 10);
  }
  return builds;
}

// 构建结束后把分区摘要写入 dist/version.json，供客户端轮询比对
function versionJsonPlugin(surfaceBuilds) {
  return {
    name: 'version-json',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve('dist');
      const payload = {
        surfaces: surfaceBuilds,
        builtAt: new Date().toISOString(),
        commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : 'local',
      };
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(payload, null, 2));
    },
  };
}

// ----------------------------------------------------------------
// 本地开发代理的公共部分：与线上 serverless 行为保持一致
// 1) 把 serverless 需要的变量从 .env 系列文件注入 process.env（Vercel 由平台注入）；
// 2) 校验导师登录态（api-lib/require-mentor.js 与线上同一实现）。
// ----------------------------------------------------------------

function injectServerEnv(env) {
  const map = {
    Y4_API_KEY: env.Y4_API_KEY,
    Y4_API_BASE: env.Y4_API_BASE,
    LLM_API_KEY: env.LLM_API_KEY,
    LLM_BASE_URL: env.LLM_BASE_URL,
    LLM_MODEL: env.LLM_MODEL,
    LLM_EXTRA_BODY: env.LLM_EXTRA_BODY,
    SUPABASE_URL: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
  };
  for (const [key, value] of Object.entries(map)) {
    if (value) process.env[key] = value;
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function requireMentorForDev(req, res) {
  const result = await requireMentor(req);
  if (!result.ok) {
    sendJson(res, result.status, { ok: false, error: result.error });
    return false;
  }
  return true;
}

// ----------------------------------------------------------------
// 本地开发用 Y4 代理（生产环境由 Vercel Function api/y4/[...path].js 承担）
//
// 上游自 2026-09-26 起迁移到 Cloudflare Tunnel 域名
// （report.p4learning-ark.app），必须通过域名 + 正常 SNI 访问；
// 旧的「直连 IP + 不发 SNI」方案对 Cloudflare 已不可用。
// 与线上共用 api-lib/y4-forward.mjs 的转发实现。
// ----------------------------------------------------------------

function y4DevProxy(env) {
  return {
    name: 'y4-dev-proxy',
    configureServer(server) {
      injectServerEnv(env);
      server.middlewares.use('/api/y4', async (req, res) => {
        if (!(await requireMentorForDev(req, res))) return;

        const apiKey = env.Y4_API_KEY;
        if (!apiKey) {
          sendJson(res, 503, { ok: false, error: '本地缺少 Y4_API_KEY（请在 .env.local 配置）' });
          return;
        }

        const qIndex = req.url.indexOf('?');
        const rawPath = qIndex >= 0 ? req.url.slice(1, qIndex) : req.url.slice(1);
        let decoded;
        try {
          decoded = decodeURIComponent(rawPath);
        } catch {
          sendJson(res, 400, { ok: false, error: 'Y4 接口路径编码无效' });
          return;
        }
        const check = validateY4Subpath(decoded);
        if (!check.ok) {
          sendJson(res, 400, { ok: false, error: check.reason });
          return;
        }
        const subpath = check.subpath;
        const search = qIndex >= 0 ? req.url.slice(qIndex) : '';
        const isProtocol = subpath.endsWith('/e4-protocol');

        forwardViaFetch({
          base: env.Y4_API_BASE || Y4_API_BASE,
          apiKey,
          subpath,
          search,
          // 与线上一致：只读列表用阶梯超时 [6s, 12s] 并重试；协议生成放宽到 50s 且不重试
          attempts: isProtocol ? 1 : 2,
          timeoutMs: isProtocol ? 50000 : [6000, 12000],
        })
          .then(({ status, contentType, cacheControl, body }) => {
            res.statusCode = status;
            res.setHeader('Content-Type', contentType);
            if (cacheControl) res.setHeader('Cache-Control', cacheControl);
            res.end(body);
          })
          .catch((err) => {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: `本地代理连接 Y4 失败：${err.message}` }));
          });
      });
    },
  };
}

function llmDevProxy(env) {
  return {
    name: 'llm-dev-proxy',
    configureServer(server) {
      // 把 .env.local 里的 LLM_* 与 Supabase 变量注入 process.env，
      // 让 serverless 函数在本地 vite 下也能读到（与线上 Vercel 行为一致）。
      injectServerEnv(env);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/llm/')) return next();

        // 读取并解析 JSON body（Vercel 线上会自动做，本地 vite 需手动）
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          req.body = raw ? JSON.parse(raw) : {};
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: '请求体不是合法 JSON' }));
          return;
        }

        try {
          const route = req.url.startsWith('/api/llm/cell-note')
            ? './api/llm/cell-note.js'
            : req.url.startsWith('/api/llm/prep-prefill')
              ? './api/llm/prep-prefill.js'
              : './api/llm/meeting-notes.js';
          const mod = await import(fileURLToPath(new URL(route, import.meta.url)));
          // 兼容 Vercel 风格的 res.status().json() 链式调用
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (data) => {
            if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(data));
          };
          await mod.default(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: `本地执行 LLM 函数失败：${err.message}` }));
        }
      });
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const root = process.cwd();
  const surfaceBuilds = await computeSurfaceBuilds(root);
  return {
    plugins: [react(), y4DevProxy(env), llmDevProxy(env), versionJsonPlugin(surfaceBuilds)],
    define: {
      __SURFACE_BUILDS__: JSON.stringify(surfaceBuilds),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: false,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            recharts: ['recharts'],
            framer: ['framer-motion'],
            lucide: ['lucide-react']
          }
        }
      },
      chunkSizeWarningLimit: 1000
    }
  };
});
