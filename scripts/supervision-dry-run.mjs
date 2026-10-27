// AI 监督流程 dry-run：用 .env.local 里的模型配置，给样例学生生成反馈草稿并打印。
// 不连数据库、不写任何东西。用来在本地调提示词。
//
//   node scripts/supervision-dry-run.mjs                 # 样例全部跑一遍
//   node scripts/supervision-dry-run.mjs --times 3       # 每个样例跑 3 次，看稳定性
//   node scripts/supervision-dry-run.mjs --only 周报     # 只跑 label 含「周报」的样例
//   node scripts/supervision-dry-run.mjs --kind nudge    # 只跑某一类：daily | weekly | nudge（提醒样例在本文件里）
//   node scripts/supervision-dry-run.mjs --today 2026-10-26   # 样例里「今天」是哪天（算几天没记用）
//
// 每条输出：概况（代码算的事实）、正文、备选、没解决的问题，方便对着真实数据肉眼检查。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDraft } from '../api-lib/supervision-prompt.mjs';

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
const kindFilter = arg('--kind', '');
const today = arg('--today', '2026-10-26');

const env = { ...loadEnv(path.join(root, '.env.local')), ...process.env };
// 提醒样例：records 为空，context 是之前的记录（样例文件里没有这一类，所以放在这里）
const R = (date, chapter, category, extra = {}) => ({ session_date: date, start_time: '19:00:00', end_time: '19:40:00', course: 'IGCSE 英语', chapter, unit: null, category, form: '自主学习', duration_minutes: 40, self_rating: 80, grade_label: null, notes: null, ...extra });
const NUDGE_SAMPLES = [
  {
    label: '陈思远 · 首月第 20 天 · 3 天没记', kind: 'nudge', dayN: 20, records: [], today,
    nudge: { neverRecorded: false, phase: 'first-month' },
    context: [R('2026-10-12', '词汇', 1), R('2026-10-14', '词汇', 2), R('2026-10-16', '阅读', 1), R('2026-10-19', '词汇', 2), R('2026-10-21', '阅读', 3, { grade_label: 'B' }),
      R('2026-10-23', '词汇', 2, { notes: '把老记混的 8 个词单独抄下来了' })],
  },
  { label: '刘佳琪 · 首月第 6 天 · 还没记过', kind: 'nudge', dayN: 6, records: [], context: [], today, nudge: { neverRecorded: true, phase: 'first-month' } },
];

const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/supervision-sample.json'), 'utf8'));
const samples = [...fixtures, ...NUDGE_SAMPLES]
  .filter((s) => !kindFilter || s.kind === kindFilter)
  .filter((s) => !only || s.label.includes(only));

const indent = (t) => String(t).replace(/\n+/g, '\n      ');

let flagged = 0;
for (const s of samples) {
  console.log(`\n── ${s.label}`);
  for (let i = 0; i < times; i++) {
    try {
      const d = await generateDraft({ today, ...s }, env);
      if (d.lint.length) flagged++;
      console.log(`   概况（${d.why}）`);
      for (const f of d.facts) console.log(`      · ${f}`);
      console.log(`   正文  ${indent(d.text)}`);
      d.alts.forEach((a, k) => console.log(`   备选${k + 1} ${indent(a)}`));
      console.log(`   依据 #${d.evidence.join(', #') || '—'}${d.retried ? ' · 已重写一次' : ''}${d.lint.length ? ` · 仍有问题：${d.lint.join('、')}` : ''}`);
    } catch (err) {
      flagged++;
      console.log(`   失败：${err.message}`);
    }
  }
}
console.log(`\n${samples.length * times} 条，其中 ${flagged} 条有问题`);
