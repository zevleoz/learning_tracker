// AI 监督：「概况」——由代码从记录里算出来的事实，模型只能引用，不能自己下判断。
// 纯函数，不连网、不读库；每条事实是一句不带形容词的短中文，能对着记录逐条核对。
// 同时产出卡片右上角给导师看的「why」一行（可以带天数，学生看不到）。
// 规则见 docs/mentor-landing/PLAN.md §1.2。

const DAY_MS = 86400000;
const CATEGORY = { 1: '学习', 2: '复习', 3: '练习' };
export const MAX_FACTS = 6;
const NOTE_IN_FACT = 60; // 「最后一条」里备注最多带多少字

const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
const diffDays = (a, b) => Math.round((ms(a) - ms(b)) / DAY_MS);
const addDays = (iso, n) => new Date(ms(iso) + n * DAY_MS).toISOString().slice(0, 10);
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const byTime = (a, b) => (a.session_date + (a.start_time || '')).localeCompare(b.session_date + (b.start_time || ''));
const distinctDays = (list) => new Set(list.map((r) => r.session_date));

const courseKey = (r) => r.course_id || r.course || '';
// 章节没填就退到单元；都没有的记录不参与「链条 / 回访」
const topicName = (r) => r.chapter || r.unit || '';
const topicKey = (r) => `${courseKey(r)}|${r.chapter_id || r.chapter || r.unit_id || r.unit || ''}`;
const hasTopic = (r) => Boolean(courseKey(r) && topicName(r));
const isGraded = (r) => Number(r.category) === 3 && r.grade_label && r.grade_label !== 'N/A';

function groupBy(list, keyOf) {
  const m = new Map();
  for (const r of list) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/** 链条：同一科目+章节在 7 天内出现 ≥2 种类型，按时间顺序。 */
function chainFacts(all, period, max = 2) {
  const inPeriod = new Set(period);
  const out = [];
  for (const g of groupBy(all.filter(hasTopic), topicKey).values()) {
    if (!g.some((r) => inPeriod.has(r))) continue;
    const latest = g.reduce((a, r) => (r.session_date > a ? r.session_date : a), '');
    const win = g.filter((r) => diffDays(latest, r.session_date) <= 6).sort(byTime);
    if (new Set(win.map((r) => Number(r.category))).size < 2) continue;
    const steps = [];
    for (const r of win) {
      const s = `${md(r.session_date)} ${CATEGORY[r.category] || '记录'}`;
      if (!steps.includes(s)) steps.push(s);
    }
    out.push({ latest, line: `${g[0].course} · ${topicName(g[0])}：${steps.slice(0, 6).join('，')}` });
  }
  return out.sort((a, b) => b.latest.localeCompare(a.latest)).slice(0, max).map((x) => x.line);
}

/** 回访：同一章节（或单元）在 14 天内有 ≥3 个不同日期。 */
function revisitFacts(all, period, max = 1) {
  const inPeriod = new Set(period);
  const out = [];
  for (const g of groupBy(all.filter(hasTopic), topicKey).values()) {
    if (!g.some((r) => inPeriod.has(r))) continue;
    const latest = g.reduce((a, r) => (r.session_date > a ? r.session_date : a), '');
    const days = distinctDays(g.filter((r) => diffDays(latest, r.session_date) <= 13));
    if (days.size >= 3) out.push({ n: days.size, line: `${g[0].course} · ${topicName(g[0])} 这两周记了 ${days.size} 天` });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, max).map((x) => x.line);
}

/** 实测变化：同一科目 ≥2 次有等第的练习，取第一次和最后一次。 */
function gradeTrendFacts(all, period, max = 1) {
  const inPeriod = new Set(period);
  const out = [];
  for (const g of groupBy(all.filter(isGraded), courseKey).values()) {
    const sorted = g.sort(byTime);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (sorted.length < 2 || !inPeriod.has(last)) continue;
    out.push({ date: last.session_date, line: `${first.course}练习实测：${md(first.session_date)} ${first.grade_label}，${md(last.session_date)} ${last.grade_label}` });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, max).map((x) => x.line);
}

/** 最近一次考试（只照写成绩，不评价）。 */
function examFact(exams) {
  const list = (exams || []).filter((e) => e && e.date && (e.grade_label || e.score != null)).sort((a, b) => a.date.localeCompare(b.date));
  const e = list[list.length - 1];
  if (!e) return null;
  const score = e.score != null && e.score !== '' ? `，${e.score} 分` : '';
  return `考试：${md(e.date)} ${[e.course, e.name, e.grade_label].filter(Boolean).join(' ')}${score}`;
}

/** 新科目：本期出现、前 30 天没有出现过的科目。context 没传时无从判断，不说。 */
function newSubjectFact(records, context, dayN) {
  if (!Array.isArray(context)) return null;
  if (context.length === 0 && !(dayN != null && dayN <= 30)) return null;
  const seen = new Set(context.map(courseKey));
  const fresh = [];
  for (const r of records) {
    if (courseKey(r) && !seen.has(courseKey(r)) && !fresh.includes(r.course)) fresh.push(r.course);
  }
  return fresh.length ? `第一次记${fresh.slice(0, 2).join('、')}` : null;
}

function countFact(kind, records) {
  if (!records.length) return null;
  if (kind === 'weekly') return `上周有 ${distinctDays(records).size} 天有记录，共 ${records.length} 条`;
  const byCourse = [...groupBy(records, (r) => r.course || '未填科目').entries()].sort((a, b) => b[1].length - a[1].length);
  return `昨天记了 ${records.length} 条：${byCourse.map(([c, l]) => `${c} ${l.length} 条`).join('、')}`;
}

function notesFact(records) {
  const n = records.filter((r) => r.notes && String(r.notes).trim()).length;
  return n >= 1 ? `${records.length} 条里有 ${n} 条写了备注` : null;
}

/** 首月进度：只有首月（dayN 有值）才有；这是事实里唯一允许出现天数的一行。 */
function monthFact(all, dayN, hasContext) {
  if (dayN == null) return null;
  if (!all.length) return `注册第 ${dayN} 天，还没有记录`;
  if (!hasContext) return null; // 没有前 30 天的数据，算出来的天数会偏小
  return `注册第 ${dayN} 天，有记录的天数 ${distinctDays(all).size} 天`;
}

/** 平时节奏：最后一条记录之前每周平均记几天（只给提醒用）。 */
function rhythmFact(all, dayN) {
  if (!all.length) return null;
  const weeks = dayN != null ? Math.min(3, Math.floor(dayN / 7)) : 3;
  if (weeks < 2) return null;
  const last = all.reduce((a, r) => (r.session_date > a ? r.session_date : a), '');
  const days = distinctDays(all);
  let total = 0;
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 7; i++) if (days.has(addDays(last, -(7 * w + i)))) total++;
  }
  const avg = total / weeks;
  if (avg < 1) return null;
  const lo = Math.floor(avg);
  const hi = Math.ceil(avg);
  return `之前一般每周记 ${lo === hi ? lo : `${lo}–${hi}`} 天`;
}

function lastRecordFact(all) {
  if (!all.length) return null;
  const r = [...all].sort(byTime)[all.length - 1];
  const parts = [r.course, topicName(r), CATEGORY[r.category]].filter(Boolean);
  const note = r.notes && String(r.notes).trim() ? `备注「${String(r.notes).trim().slice(0, NOTE_IN_FACT)}」` : null;
  return `最后一条：${md(r.session_date)} ${[...parts, note].filter(Boolean).join(' · ')}`;
}

/** 距今几天没记：今天减最后一条记录的日期；缺 today 或没有记录时返回 null。 */
function silentDays(all, today) {
  if (!today || !all.length) return null;
  const last = all.reduce((a, r) => (r.session_date > a ? r.session_date : a), '');
  return Math.max(0, diffDays(today, last));
}

function buildWhy({ kind, records, nudge, dayN, issues, combined, all, today }) {
  if (kind === 'daily') {
    const courses = [...new Set(records.map((r) => r.course).filter(Boolean))];
    return `昨天记了 ${records.length} 条${courses.length ? `：${courses.join('、')}` : ''}`;
  }
  const n = silentDays(all, today);
  const silent = n == null ? '最近没记' : `${n} 天没记`;
  if (kind === 'weekly') {
    const head = `上周记了 ${distinctDays(records).size} 天`;
    if (combined) return `${head} · 之后${n == null ? '没记' : ` ${n} 天没记`}`;
    return issues && issues.length ? `${head} · 有一件事可以问问` : head;
  }
  // nudge
  if (nudge && nudge.neverRecorded) return dayN != null ? `首月第 ${dayN} 天 · 还没记过` : '还没记过';
  return nudge && nudge.phase === 'first-month' ? `首月 · ${silent}` : silent;
}

/**
 * @param {object} p
 * @param {'daily'|'weekly'|'nudge'} p.kind
 * @param {Array} p.records 本期记录（nudge 为空）
 * @param {Array} [p.context] 本期之前 30 天的记录（旧调用方不传）
 * @param {number|null} [p.dayN] 注册第几天（首月才有）
 * @param {{neverRecorded?: boolean, phase?: string}|null} [p.nudge]
 * @param {boolean} [p.combineNudge] 周小结 + 提醒合成一条
 * @param {Array} [p.exams] 前 30 天内的考试成绩
 * @param {string[]} [p.issues] 周小结要提的问题（只影响 why）
 * @param {string} [p.today] YYYY-MM-DD，算「几天没记」用
 * @returns {{ why: string, facts: string[] }}
 */
export function buildFacts({ kind, records = [], context, dayN = null, nudge = null, combineNudge = false, exams = [], issues = [], today } = {}) {
  const hasContext = Array.isArray(context);
  const ctx = hasContext ? context : [];
  const all = [...ctx, ...records];
  const combined = kind === 'weekly' && Boolean(combineNudge || nudge);
  const reminder = kind === 'nudge' || combined;
  const why = buildWhy({ kind, records, nudge, dayN, issues, combined, all, today });

  const out = [];
  const push = (...lines) => { for (const l of lines) if (l) out.push(l); };

  if (kind !== 'nudge') {
    // 规律排在前面，单点统计在后面；合并提醒时给提醒的事实留出位置
    const patterns = [];
    patterns.push(...chainFacts(all, records), ...revisitFacts(all, records), ...gradeTrendFacts(all, records));
    patterns.push(examFact(exams), newSubjectFact(records, context, dayN));
    patterns.push(countFact(kind, records), monthFact(all, dayN, hasContext), notesFact(records));
    push(...patterns.filter(Boolean).slice(0, combined ? 3 : MAX_FACTS));
  }
  if (reminder) {
    push(lastRecordFact(all), rhythmFact(all, dayN));
    if (kind === 'nudge') push(monthFact(all, dayN, hasContext));
  }
  return { why, facts: out.slice(0, MAX_FACTS) };
}
