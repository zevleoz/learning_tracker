import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { Y4_API_BASE, forwardViaFetch } from './api-lib/y4-forward.mjs';

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
      server.middlewares.use('/api/y4', (req, res) => {
        const apiKey = env.Y4_API_KEY;
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: '本地缺少 Y4_API_KEY（请在 .env.local 配置）' }));
          return;
        }

        const qIndex = req.url.indexOf('?');
        const subpath = decodeURIComponent(qIndex >= 0 ? req.url.slice(1, qIndex) : req.url.slice(1));
        const search = qIndex >= 0 ? req.url.slice(qIndex) : '';

        forwardViaFetch({
          base: env.Y4_API_BASE || Y4_API_BASE,
          apiKey,
          subpath,
          search,
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
      // 把 .env.local 里的 LLM_* 变量注入 process.env，
      // 让 serverless 函数在本地 vite 下也能读到（与线上 Vercel 行为一致）。
      for (const k of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_EXTRA_BODY']) {
        if (env[k]) process.env[k] = env[k];
      }

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), y4DevProxy(env), llmDevProxy(env)],
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
