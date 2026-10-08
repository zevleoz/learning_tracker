// scripts/env.js —— 运维脚本共用的环境变量装载器。
// 只读取 .env.scripts（已被 .gitignore 忽略，模板见 .env.scripts.example），
// 已存在的 process.env 优先；不会读取仓库里其他 env 文件，避免脚本意外连上非预期环境。
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), '.env.scripts');

if (fs.existsSync(FILE)) {
  for (const line of fs.readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (value && process.env[m[1]] == null) process.env[m[1]] = value;
  }
}

export function requireEnv(name, hint = '') {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少环境变量 ${name}${hint ? `（${hint}）` : ''}：请在 .env.scripts 中配置，模板见 .env.scripts.example。`);
    process.exit(1);
  }
  return value;
}

export function requireSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  if (!url) {
    console.error('缺少环境变量 SUPABASE_URL：请在 .env.scripts 中配置，模板见 .env.scripts.example。');
    process.exit(1);
  }
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!key) {
    console.error('缺少环境变量 SUPABASE_ANON_KEY：请在 .env.scripts 中配置，模板见 .env.scripts.example。');
    process.exit(1);
  }
  return { url, key };
}