// AI 监督流程 dry-run：用 .env.local 里的模型配置，给样例学生生成反馈草稿并打印。
// 不连数据库、不写任何东西。用来在本地调提示词。
//
//   node scripts/supervision-dry-run.mjs                 # 样例全部跑一遍
//   node scripts/supervision-dry-run.mjs --times 3       # 每个样例跑 3 次，看稳定性
//   node scripts/supervision-dry-run.mjs --only 周报     # 只跑 label 含「周报」的样例

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDraft, lintDraft } from '../api-lib/supervision-prompt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const times = Number(arg('--times', 1));
const only = arg('--only', '');

const env = { ...loadEnv(path.join(root, '.env.local')), ...process.env };
const samples = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/supervision-sample.json'), 'utf8'))
  .filter((s) => !only || s.label.includes(only));

let flagged = 0;
for (const s of samples) {
  console.log(`\n── ${s.label}`);
  for (let i = 0; i < times; i++) {
    try {
      const d = await generateDraft(s, env);
      const issues = lintDraft(d.text, s.kind);
      if (issues.length) flagged++;
      console.log(`${d.text.replace(/\n+/g, '\n   ')}`);
      console.log(`   依据 #${d.evidence.join(', #') || '—'}${d.retried ? ' · 已重写一次' : ''}${issues.length ? ` · 仍有问题：${issues.join('、')}` : ''}`);
    } catch (err) {
      flagged++;
      console.log(`   失败：${err.message}`);
    }
  }
}
console.log(`\n${samples.length * times} 条，其中 ${flagged} 条有问题`);
