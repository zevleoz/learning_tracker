// 一次性只读诊断：把「本机 → CF 隧道 → origin」逐层切开，定位 Y4 上游 404。
// 运行：node --env-file=.env.local scripts/diag-y4-upstream.mjs
// 可选参数：--id=48（跳过自动取 id） --origin=http://8.153.154.174 --base=https://...
// 安全：脚本永不打印 API Key，响应体中的 key 出现处会打码。
import process from 'node:process';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] || true] : [a, true];
  }),
);

const KEY = process.env.Y4_API_KEY || '';
const BASE = String(args.base || process.env.Y4_API_BASE || 'https://report.p4learning-ark.app/api/v1').replace(/\/$/, '');
const ORIGIN = String(args.origin || 'http://8.153.154.174').replace(/\/$/, '');
const AUTH_HEADER = process.env.Y4_AUTH_HEADER || 'authorization';
const CF_HOST = 'report.p4learning-ark.app';
const TIMEOUT_MS = 15000;

if (!KEY) {
  console.error('缺少 Y4_API_KEY（用 node --env-file=.env.local 运行）');
  process.exit(1);
}

function authHeaders() {
  return AUTH_HEADER === 'x-api-key' ? { 'X-Api-Key': KEY } : { Authorization: `Bearer ${KEY}` };
}

function sanitize(text) {
  if (!text) return text;
  return KEY ? text.split(KEY).join('***') : text;
}

async function probe(label, url, { headers = {}, note = '' } = {}) {
  const started = Date.now();
  const out = { label, url, note, status: null, contentType: '', cfRay: '', server: '', ms: 0, body: '', error: '' };
  try {
    const res = await fetch(url, { headers: { ...authHeaders(), ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    out.status = res.status;
    out.contentType = res.headers.get('content-type') || '';
    out.cfRay = res.headers.get('cf-ray') || '';
    out.server = (res.headers.get('server') || '').slice(0, 30);
    out.body = sanitize((await res.text()).slice(0, 300));
  } catch (err) {
    out.error = err.name === 'TimeoutError' ? `TIMEOUT >${TIMEOUT_MS}ms` : err.message;
  }
  out.ms = Date.now() - started;
  return out;
}

function report(r) {
  const tag = r.error ? `ERR ${r.error}` : `HTTP ${r.status}`;
  const meta = [r.contentType.split(';')[0], r.cfRay, r.server].filter(Boolean).join(' | ');
  console.log(`\n[${r.label}] ${tag}  (${r.ms}ms)${r.note ? `  {${r.note}}` : ''}`);
  console.log(`  ${r.url}`);
  if (meta) console.log(`  ${meta}`);
  if (r.body) console.log(`  body> ${r.body.replace(/\s+/g, ' ')}`);
}

// 从 /students 响应里尽力取一个真实学生 id（兼容数组与常见包裹形态）
function extractStudentId(json) {
  let list = json;
  for (const k of ['data', 'students', 'items', 'results']) {
    if (Array.isArray(list)) break;
    if (list && Array.isArray(list[k])) {
      list = list[k];
      break;
    }
    if (list && list[k] && Array.isArray(list[k].items)) {
      list = list[k].items;
      break;
    }
  }
  if (!Array.isArray(list) || !list.length) return null;
  const first = list[0];
  return first?.id ?? first?.student_id ?? null;
}

console.log(`诊断目标 base=${BASE}  origin=${ORIGIN}  authHeader=${AUTH_HEADER}  key=***${KEY.slice(-3) ? '' : ''}`);
console.log('='.repeat(70));

// ---- --all：遍历全量学生逐个探 reports，找「谁的报告列表会 404」 ----
async function sweepAll() {
  const res = await fetch(`${BASE}/students`, { headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json();
  const students = Array.isArray(data.students) ? data.students : [];
  console.log(`全量学生 ${students.length} 位，逐个探 reports：\n`);
  console.log('id   | name                 | report_count | reports 状态 | 摘要');
  let bad = 0;
  for (const s of students) {
    const r = await probe('sweep', `${BASE}/students/${s.id}/reports`);
    const brief = r.error ? r.error : r.body.replace(/\s+/g, ' ').slice(0, 60);
    if (r.status !== 200) bad += 1;
    console.log(
      `${String(s.id).padEnd(4)} | ${String(s.name || '').padEnd(20)} | ${String(s.report_count).padEnd(12)} | ${String(r.error || r.status).padEnd(12)} | ${brief}`,
    );
  }
  console.log(`\n非 200 共 ${bad} 位${bad ? ' <<< 这些学生就是 404 复现对象' : '（全部 200，404 非当前可复现的稳定态）'}`);
}

if (args.all) {
  await sweepAll();
  process.exit(0);
}

const results = [];
const add = async (...a) => {
  const r = await probe(...a);
  report(r);
  results.push(r);
  return r;
};

// ---- 第 1 组：CF 域名（线上同链路） ----
const students = await add('1. students 对照组', `${BASE}/students`);
let studentId = args.id || null;
if (!studentId) {
  try {
    studentId = extractStudentId(JSON.parse(students.body.length >= 300 ? students.body.slice(0, 300) + '…' : students.body)) ?? null;
  } catch {
    // body 被截断解析失败是常态，忽略
  }
}
if (!studentId) {
  const full = await probe('1b. students 完整响应（取 id）', `${BASE}/students`);
  try {
    studentId = extractStudentId(JSON.parse(sanitize(full.body))) ?? null;
  } catch {
    studentId = null;
  }
  if (!studentId) {
    // 再取一次完整 body 解析（probe 只留 300 字符，这里直接重发并全文解析）
    try {
      const res = await fetch(`${BASE}/students`, { headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
      studentId = extractStudentId(await res.json());
    } catch {
      studentId = null;
    }
  }
}
console.log(`\n>>> 探测用学生 id = ${studentId ?? '（未取到，跳过依赖它的探针）'}`);

if (studentId) {
  await add('2. students/{id}/reports（复现 404）', `${BASE}/students/${studentId}/reports`);
  await add('3. 尾斜杠', `${BASE}/students/${studentId}/reports/`);
  await add('2b. students/{id} 详情（同深度对照）', `${BASE}/students/${studentId}`);
  await add('4a. reports/{studentId}（命名空间探针）', `${BASE}/reports/${studentId}`);
  await add('4b. reports/{studentId}/y4-md', `${BASE}/reports/${studentId}/y4-md`);
}

// ---- 第 2 组：路由表线索 ----
for (const [label, url] of [
  ['5a. 域名根 openapi.json', `https://${CF_HOST}/openapi.json`],
  ['5b. /api/v1/openapi.json', `${BASE}/openapi.json`],
  ['5c. 域名根 docs', `https://${CF_HOST}/docs`],
  ['5d. 域名根 /', `https://${CF_HOST}/`],
]) {
  const r = await add(label, url);
  if (r.body && r.body.trim().startsWith('{')) {
    try {
      const doc = JSON.parse(r.body);
      if (doc.paths) {
        const paths = Object.keys(doc.paths);
        console.log(`  >>> openapi 路由共 ${paths.length} 条，含 students/reports 的：`);
        for (const p of paths.filter((p) => /student|report|e4/i.test(p)).slice(0, 40)) console.log(`      ${p}`);
      }
      if (doc.info) console.log(`  >>> openapi info: ${JSON.stringify(doc.info).slice(0, 200)}`);
    } catch {
      // 截断或非 JSON
    }
  }
}

// ---- 第 3 组：直连 origin（HTTP + Host 头，绕过 CF 隧道） ----
const originHeaders = { Host: CF_HOST };
if (studentId) {
  await add('6a. origin 直连 students/{id}/reports', `${ORIGIN}/api/v1/students/${studentId}/reports`, { headers: originHeaders, note: 'Host=' + CF_HOST });
}
await add('6b. origin 直连 students 对照', `${ORIGIN}/api/v1/students`, { headers: originHeaders, note: 'Host=' + CF_HOST });
await add('6c. origin 根路径（看是什么在响应）', `${ORIGIN}/`, { note: '不带 Host' });

// ---- 汇总 ----
console.log('\n' + '='.repeat(70));
console.log('汇总（label | http | ms | cf-ray | body 摘要）');
for (const r of results) {
  const brief = r.error ? r.error : `${r.status} ${r.body.replace(/\s+/g, ' ').slice(0, 80)}`;
  console.log(`${r.label.padEnd(38)} | ${String(r.error || r.status).padEnd(6)} | ${String(r.ms).padStart(5)}ms | ${r.cfRay} | ${brief}`);
}
console.log('\n判读：origin 直连 200 而 CF 域名 404 → 隧道/入口路由；两者都 404 → 上游应用本身。');