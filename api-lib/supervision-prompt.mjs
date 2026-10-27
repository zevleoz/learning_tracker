// AI 监督流程：给导师生成「每日一句表扬」和「每周小结」草稿。
// 纯函数 + 一个 OpenAI 兼容调用，服务端（api/supervision）与本地 dry-run 脚本共用。
// 草稿只给导师看、导师改了再发，学生端永远看不到原稿。
// 模型只看得到学生自己填的记录，所以：事实由 supervision-facts.mjs 用代码算好（概况），
// 生成后再由 checkGrounding 用代码核对，对不上的地方重写一次，仍不行就标出来给导师看。

import { buildFacts } from './supervision-facts.mjs';

// 单次模型请求的超时（一份草稿最多 3 次请求，定时任务另有 28 秒总预算）
export const LLM_TIMEOUT_MS = 10 * 1000;

const CATEGORY = { 1: '学习', 2: '复习', 3: '练习' };
const SUBJECTIVE = { 20: '没有听课', 40: '像在听天书', 60: '有不少没掌握', 80: '基本掌握', 100: '完全掌握' };
const WEEKDAY = '日一二三四五六';

function mmdd(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()} 周${WEEKDAY[d.getDay()]}`;
}

/** 一条记录 → 给模型看的一行（不含学生姓名） */
export function recordLine(r, i, tag = null) {
  const parts = [
    `#${i + 1}`,
    tag,
    mmdd(r.session_date),
    r.start_time && r.end_time ? `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}` : null,
    [r.course, r.chapter, r.unit].filter(Boolean).join(' / '),
    CATEGORY[r.category] || null,
    r.form || null,
    r.duration_minutes ? `${r.duration_minutes} 分钟` : null,
    r.self_rating != null ? `自评：${SUBJECTIVE[r.self_rating] || r.self_rating}` : null,
    Number(r.category) === 3
      ? (r.grade_label === 'N/A' ? '实测：不适用' : r.grade_label ? `实测：${r.grade_label}` : '实测：还没填')
      : null,
    r.notes ? `学生备注：「${String(r.notes).slice(0, 120)}」` : '没写备注',
  ];
  return parts.filter(Boolean).join(' · ');
}

const VOICE = [
  '你就是这位学生的导师本人，要在微信上给学生发一条消息。',
  '写法：',
  '- 像平时跟学生说话那样写，口语、简短、自然。可以用「你」，不要称呼名字，也不要用「同学」开头。',
  '- 只说记录里真的有的事。点出一件具体的东西：哪一科、哪一章、什么类型（学习/复习/练习）、备注里写了什么、实测多少。',
  '- 每个细节都必须能在记录原文里找到。学生做了什么动作（改对、标出来、记下来、整理、重做）只能照备注说，备注没写就不能说。分数、日期、顺序也不能改。用备注里的原词，不要换词（「做对了」不能写成「改对了」，「背了」不能写成「背熟了」）。',
  '- 记录很少、也没有备注时，就简单说一句他记了什么，比如「昨天数学配方法那节课记上了」，可以加半句平常的鼓励，但不要编细节。',
  '- 不要拿「自评」夸人（不要说「自评写得实在」「标了基本掌握」）。',
  '- 夸要夸在记录里看得到的具体做法上（比如学完又回头复习、做完练习、备注里写了怎么改的、实测等第），不要夸人、不要夸态度，也不要评价作业或文章本身写得怎么样。',
  '- 不要写成作文或评语。不要用成语、四字词堆砌、排比、对仗、感叹号、表情符号。',
  '- 不要分析、不要下结论（不要写「说明……」「可见……」「可能高估了」），像聊天一样把事情说出来就行。',
  '- 只挑一两件事说，不要把每一科都报一遍，不要罗列一串分数。',
  '- 禁止这些套话：加油、继续保持、再接再厉、值得表扬、值得肯定、非常棒、很棒、优秀、出色、展现、体现、态度、习惯、坚持、进步很大、亮点、相信你、希望你、目标、计划、方向、高效。',
  '- 不要提学习时长目标，不要拿别的同学比较，不要评价休息。',
].join('\n');

const EVIDENCE = [
  'EVIDENCE（所有任务共用）',
  '你能看到的只有学生自己填的记录：日期、时间、科目/章节/单元、类型（学习/复习/练习）、时长、主观自评、练习的实测等第、备注。你看不到他的作业、题目、笔记和试卷本身。',
  '- 能说的：记录里写着的科目、章节、类型、日期、时长、实测等第，备注里的原话（用「」引），以及「概况」里的事实。',
  '- 不能说的：作业或文章写得怎么样、思路对不对、懂没懂、掌握没掌握；认不认真、用不用心；备注里没写的动作和数量（做了几道题、改了几遍、背熟了）；两件事之间的因果；对以后的预测。',
  '- 自评只是学生自己的感觉，不能当成掌握了来夸。实测 B- 或更低时不要当成好消息说。',
  '- 不要比记录更乐观：不说「进步很大」「很稳」「扎实」「肯定没问题」。',
  '- 要具体到能对上一条记录，但不要编出比记录更细的细节。记录少、没有备注时就少说，一句话说清他记了什么。',
  '看全局：',
  '- 先读「概况」，挑一件最能说明这段时间的事来说，通常是一个规律（同一章学了又复习、隔几天又回来做、同一科实测有变化、第一次记某一科），而不是随便挑一条记录。概况里没有明显规律时，才说某一条记录。',
  '- 只说一两件事，不要罗列。',
  '提问：',
  '- 最多问一个问题，针对一件具体的事，学生一句话就能回答。不要问「有什么困难吗」「感觉怎么样」「有什么想法」这种空问题。',
].join('\n');

const DAILY_TASK = [
  '任务：根据学生「昨天」的学习记录，写一句表扬。',
  '- 一到两句话，一般 20 到 45 个字，最多 60 个字。',
  '- 只表扬：不提建议、不提问、不说「不要紧」「慢慢来」之类的安慰。',
  '- 如果有备注，优先从备注里找可以说的事。',
].join('\n');

const WEEKLY_FIRST = [
  '任务：根据学生「上周」的学习记录，写一段周小结。',
  '- 第一部分：说一两件这周做得好的具体的事。',
];
const WEEKLY_TASK = [
  ...WEEKLY_FIRST,
  '- 第二部分：只在「要提的问题」里给了内容时才写。挑最要紧的一件，用商量的口气问一句（比如「……是不是还没弄明白？」「下周……要不要先……？」）。和第一部分之间空一行。',
  '- 「要提的问题」写着「无」时，只写第一部分，不要自己找问题，也不要提醒、提建议。',
  '- 第一部分 20 到 60 个字，第二部分 15 到 50 个字。',
].join('\n');

const NUDGE_TASK = [
  'NUDGE_TASK',
  '任务：学生最近几天没有记录，写一条轻轻的提醒。',
  '- 开头不要说他几天没记、没填。先接上他最后一次记录里的一件具体的事；从没记过的学生，按「可能还不会用」来写，不按「偷懒」来写。',
  '- 不说天数，不说「记得填写」「请」「及时」「务必」「打卡」，不用感叹号，不要让人觉得被催。',
  '- 可以轻轻猜一句他可能在忙（「这两天是不是作业多？」），只猜一次，不追问原因。',
  '- 结尾给一个很小的下一步：「记一条就行」「先记今天上的一节课」。',
  '- 两到三句话，30 到 70 个字。',
  '- 不要和「上次发给他的消息」用同一个开头或同一个话头。',
].join('\n');

const COMBINED = [
  'COMBINED（周小结 + 提醒）',
  '在周小结的第二部分写提醒（规则同 NUDGE_TASK），代替「要提的问题」；有问题时只挑最要紧的一件，和提醒合成一句。第一部分 20 到 60 个字，第二部分 15 到 50 个字，两部分之间空一行。',
].join('\n');

// 语气示例：按任务挑，避免把提醒的口气带进表扬里
const EXAMPLE_PRAISE = [
  '- 「斜面那题受力图错了两次，你备注里写了是对着例题改的。牛顿第二定律那节当天也复习了。」',
  '- 「历史那张时间线你备注写了自己重画了一遍。」',
];
const EXAMPLE_WEEKLY = [
  '- 「议论文那次你备注写了按每段一个论点改了。化学平衡常数那组练习实测 A-。」',
  '- 「链式法则那组练习实测 A，你备注写了三层复合都对了。\\n\\n物理摩擦力周四最后两题没思路，是卡在受力分析，还是公式不会用？」',
];
const EXAMPLE_NUDGE = [
  '- 「这两天学校是不是事情多？不急，有空把最近上的课记一两条，我想看看英语单词那块后来怎么样了。」',
  '- 「刚开始用可能不知道从哪记起。先记今天上的一节课就行，写上课名和大概学了什么。哪里不会填直接问我。」',
];
const EXAMPLE_COMBINED = [
  '- 「上周前几天物理牛顿定律的练习你连着记了三次。\\n\\n之后没看到新的记录，这两天是不是作业比较多？方便的时候记一条最近学的就行。」',
];
const EXAMPLE_BAD = [
  '不要写成这样：',
  '- 「你在物理学习中展现了认真的态度，值得表扬，继续加油！」',
  '- 「本周你保持了良好的学习习惯，各科均衡发展，说明学习方法正确。」',
  '- 「议论文结构清楚多了，看得出你很用心。」（评价了作业本身和态度，记录里看不到）',
];

export function examplesFor(kind, combineNudge = false) {
  const good = kind === 'nudge' ? EXAMPLE_NUDGE
    : kind === 'weekly' ? (combineNudge ? EXAMPLE_COMBINED : EXAMPLE_WEEKLY)
      : EXAMPLE_PRAISE;
  return ['语气参考（只学语气；示例里的科目和说法都不要照搬，每条消息用自己的话）：', ...good, ...EXAMPLE_BAD].join('\n');
}

const MAX_LEN = { daily: 60, weekly: 120, nudge: 70 };
const outputFor = (kind) => `只输出严格的 JSON：{"text":"消息正文","alts":["另一种写法","再一种写法"],"evidence":[用到的记录编号，比如 1, 3]}。
- alts 是最多两条备选，要换角度说（比如换一件事说、换一种开头），不是换几个词；每条都要遵守上面所有规则。
- 每条（text 和 alts）最多 ${MAX_LEN[kind] || 120} 个字，不要任何解释。`;

// 记录太多时只把最近的这些「之前」记录放进提示词（编号仍按完整列表算，evidence 才对得上）
const MAX_CONTEXT_LINES = 40;

const section = (title, lines) => (lines.length ? `${title}\n${lines.join('\n')}` : '');

/**
 * @param {object} input C2 的 input（见 docs/mentor-landing/PLAN.md），旧调用方只传 kind / dayN / records / issues 也行
 *   facts：可以不传，缺省时用 buildFacts 现算
 *   extras：额外事实（如「物理有 2 条练习实测还没填」），可为空
 */
export function buildMessages(input) {
  const { kind, dayN, records = [], context = [], extras = [], issues = [], combineNudge = false, nudge = null,
    lastSent = null, styleRefs = [], rejected = [], avoidOpenings = [] } = input;
  const facts = input.facts || buildFacts(input).facts;
  const combined = kind === 'weekly' && Boolean(combineNudge);

  const task = kind === 'nudge' ? NUDGE_TASK
    : kind === 'weekly' ? (combined ? [...WEEKLY_FIRST, COMBINED].join('\n') : WEEKLY_TASK)
      : DAILY_TASK;
  const system = [VOICE, '', EVIDENCE, '', task, '', examplesFor(kind, combined), '', outputFor(kind)].join('\n');

  const head = kind === 'weekly' ? '上周的学习记录：'
    : kind === 'nudge'
      ? (nudge && nudge.neverRecorded
        ? `这位学生注册后还没有记过任何学习记录${dayN != null ? `（首月第 ${dayN} 天）` : ''}。`
        : `这位学生最近没有新的记录${nudge && nudge.phase === 'first-month' ? '（首月）' : ''}。他之前的记录：`)
      : `${dayN != null ? `这是学生注册后的第 ${dayN} 天。` : ''}昨天的学习记录：`;

  const shownFrom = Math.max(0, context.length - MAX_CONTEXT_LINES);
  const recLines = records.map((r, i) => recordLine(r, i));
  const ctxLines = context.slice(shownFrom).map((r, i) => recordLine(r, records.length + shownFrom + i, '之前'));
  const body = kind === 'nudge' && !records.length ? ctxLines : [...recLines, ...ctxLines];

  const user = [
    section('概况（代码算出来的事实，可以直接用）：', facts.map((f) => `- ${f}`)),
    [head, ...body].join('\n'),
    extras.length ? `\n其他情况：\n${extras.map((e) => `- ${e}`).join('\n')}` : '',
    kind === 'weekly' ? `\n要提的问题：${issues.length ? `\n${issues.map((e) => `- ${e}`).join('\n')}` : '无'}` : '',
    lastSent && lastSent.text ? `\n上次发给他的消息（${lastSent.date || ''}）：\n「${lastSent.text}」\n这次不要用同样的开头或话头。` : '',
    styleRefs.length
      ? `\n导师之前改过的样子（只学语气和长短，不要照搬内容）：\n${styleRefs.map((s) => `- 改之前：「${s.before}」→ 改之后：「${s.after}」`).join('\n')}`
      : '',
    rejected.length ? `\n不合适的写法（导师说这样写不合适，不要这样写）：\n${rejected.map((t) => `- 「${t}」`).join('\n')}` : '',
    avoidOpenings.length ? `\n今天已经用过的开头（不要重复）：\n${avoidOpenings.map((t) => `- ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// 套话 / 书面腔 / 评价类词检测：用于测试、dry-run 打分，以及服务端命中时重试一次
const STOCK = [
  '加油', '继续保持', '再接再厉', '值得表扬', '值得肯定', '非常棒', '很棒', '优秀', '出色', '展现', '体现', '态度', '习惯', '坚持', '进步很大', '亮点', '相信你', '希望你', '目标', '计划', '方向', '高效', '说明', '可见', '同学', '！', '!',
  // 模型看不到作业本身，下面这些评价 / 保证都无从谈起（PLAN §1.3）
  '认真', '用心', '努力', '扎实', '很稳', '清楚多了', '掌握了', '弄懂了', '理解了', '学会了', '进步', '肯定', '一定能', '下次就不会',
];
// 要按整词匹配的：稳 不能命中「稳定」，懂了 不能命中「懂得」「弄懂了」之外的写法
const STOCK_PATTERNS = [
  { word: '稳', re: /(?<!很)稳(?!定)/ },
  { word: '懂了', re: /(?<!弄)懂了/ },
];
function stockHits(t) {
  return [...STOCK.filter((w) => t.includes(w)), ...STOCK_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.word)]
    .map((w) => `套话「${w}」`);
}

export function lintDraft(text, kind = 'daily') {
  const t = String(text || '');
  const issues = stockHits(t);
  const len = t.replace(/\s/g, '').length;
  const max = MAX_LEN[kind];
  if (max && len > max) issues.push(`太长（${len} 字）`);
  if (/[\u{1F300}-\u{1FAFF}]/u.test(t)) issues.push('有表情符号');
  return issues;
}

const GRADE_RE = /(?<![A-Za-z])([A-DF][+-]?)(?![A-Za-z])/g;
const gradeTokens = (s) => new Set([...String(s).matchAll(GRADE_RE)].map((m) => m[1]));
// 「请」只拦命令式的用法：请假、邀请、请教不算
const NUDGE_BANNED = [['记得填', /记得填/], ['请', /(?<!邀)请(?![假教])/], ['及时', /及时/], ['务必', /务必/], ['打卡', /打卡/]];

/**
 * 生成后的核对（代码做，不靠模型自觉）。返回问题列表，空数组代表没问题。
 * @param {string} text
 * @param {object} input 同 generateDraft 的 input，另可带 facts（模型看到的概况）
 */
export function checkGrounding(text, input = {}) {
  const t = String(text || '');
  const records = [...(input.records || []), ...(input.context || [])];
  const exams = input.exams || [];
  const examLines = exams.map((e) => [e.date, e.course, e.name, e.grade_label, e.score, e.notes].filter((v) => v != null && v !== '').join(' '));
  const notes = [...records.map((r) => r.notes), ...exams.map((e) => e.notes)].filter(Boolean).map(String);
  const corpus = [
    ...records.map((r, i) => recordLine(r, i)), ...records.map((r) => r.session_date), ...notes,
    ...(input.facts || []), ...examLines, ...(input.issues || []), ...(input.extras || []),
  ].join('\n');
  const problems = [];

  // 等第：每个等第都得在记录或概况里出现过
  const known = gradeTokens(corpus);
  for (const g of gradeTokens(t)) if (!known.has(g)) problems.push(`等第「${g}」在记录里找不到`);

  // 数字：整数/小数都得在输入里出现过（日期里的数字也算）
  // 几点几分不参与：否则记录里的 20:30 会让「30 道题」混过去
  const noClock = (x) => x.replace(/\d{1,2}:\d{2}/g, ' ');
  const numCorpus = noClock(corpus);
  const seen = new Set();
  for (const n of noClock(t).match(/\d+(?:\.\d+)?/g) || []) {
    if (seen.has(n)) continue;
    seen.add(n);
    if (!new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?!\\d)`).test(numCorpus)) problems.push(`数字「${n}」在记录里找不到`);
  }

  // 引用：「」里的话必须是某条备注里的原文
  for (const m of t.matchAll(/「([^」]+)」/g)) {
    const q = m[1].trim();
    if (q && !notes.some((n) => n.includes(q))) problems.push(`引用「${q}」不是备注原文`);
  }

  // 评价 / 保证类的词
  for (const p of stockHits(t)) if (!problems.includes(p)) problems.push(p);

  // 提醒类（含周小结里合并的提醒）的额外禁忌
  if (input.kind === 'nudge' || input.combineNudge || input.nudge) {
    if (/\d+\s*天(没|没有)(记|填)/.test(t)) problems.push('提醒里不能说几天没记');
    for (const [w, re] of NUDGE_BANNED) if (re.test(t)) problems.push(`提醒里不要用「${w}」`);
  }
  // 任何消息最多一个问题
  if ((t.match(/[？?]/g) || []).length >= 2) problems.push('问了不止一个问题');
  return problems;
}

export function parseDraft(raw) {
  const s = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    const j = JSON.parse(s.slice(a, b + 1));
    const text = String(j.text || '').trim();
    if (!text) return null;
    const evidence = Array.isArray(j.evidence) ? j.evidence.map(Number).filter(Number.isFinite) : [];
    const alts = Array.isArray(j.alts) ? j.alts.map((x) => String(x || '').trim()).filter(Boolean) : [];
    return { text, alts, evidence };
  } catch {
    return null;
  }
}

/** 当前使用的模型名（写入 supervision_drafts.model） */
export function modelNameOf(env = process.env) {
  return env.LLM_MODEL || 'doubao-1-5-pro-32k-250115';
}

const shanghaiToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * OpenAI 兼容调用（DashScope / 火山 ARK 均可）。
 * 返回 { text, alts, evidence, facts, why, lint }，抛错表示模型不可用。
 * lint 是重试之后仍然没解决的问题（语言 + 对不上记录），非空时前端提示导师发之前看一眼。
 */
export async function generateDraft(input, env = process.env, { temperature = 0.5 } = {}) {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error('未配置 LLM_API_KEY');
  const baseURL = (env.LLM_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  const model = modelNameOf(env);
  let extraBody = {};
  if (env.LLM_EXTRA_BODY) extraBody = JSON.parse(env.LLM_EXTRA_BODY);

  const call = async (messages) => {
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature, max_tokens: 900, response_format: { type: 'json_object' }, messages, ...extraBody }),
      // 模型偶尔卡住：不设超时会拖到函数 60 秒被强杀，来不及返回错误
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`模型请求失败（HTTP ${resp.status}）`);
    const data = await resp.json();
    return parseDraft(data?.choices?.[0]?.message?.content);
  };

  const { why, facts } = buildFacts({ ...input, today: input.today || shanghaiToday() });
  const full = { ...input, facts };
  const messages = buildMessages(full);
  const lintKind = input.kind;
  // 没有要提的问题时只要第一段，防止模型自己补一段提醒；合并提醒时第二段就是提醒，不能砍
  const trim = (s) => (input.kind === 'weekly' && !(input.issues || []).length && !input.combineNudge
    ? s.split(/\n\s*\n/)[0].trim() : s);
  const check = (s) => [...new Set([...lintDraft(s, lintKind), ...checkGrounding(s, full)])];

  let draft = await call(messages);
  if (!draft) draft = await call(messages); // 偶发空返回 / 非 JSON：再要一次
  if (!draft) throw new Error('模型没有返回可用的草稿');
  draft = { ...draft, text: trim(draft.text), alts: draft.alts.map(trim) };

  // 命中套话 / 超长 / 对不上记录时，带着全部问题重写一次
  let problems = check(draft.text);
  let retried = false;
  const first = draft;
  if (problems.length) {
    const retry = await call([
      ...messages,
      { role: 'assistant', content: JSON.stringify({ text: draft.text, alts: draft.alts, evidence: draft.evidence }) },
      { role: 'user', content: `这条有问题：${problems.join('、')}。按上面的要求重写，更像平时说话，每个细节都要能在记录里找到。仍然只输出 JSON。` },
    ]);
    if (retry) {
      const next = { ...retry, text: trim(retry.text), alts: retry.alts.map(trim) };
      const nextProblems = check(next.text);
      // 重写后更差就不要了：保留第一版，问题照实留给导师
      if (nextProblems.length <= problems.length) { draft = next; problems = nextProblems; }
      retried = true;
    }
  }

  // 备选逐条核对，不合格的丢掉；最多留两条，和正文不同
  const alts = [];
  for (const a of [...draft.alts, ...first.alts]) {
    if (alts.length >= 2) break;
    if (a !== draft.text && !alts.includes(a) && check(a).length === 0) alts.push(a);
  }
  const total = (input.records || []).length + (input.context || []).length;
  const evidence = [...new Set(draft.evidence.filter((n) => Number.isInteger(n) && n >= 1 && n <= (total || Infinity)))];
  return { text: draft.text, alts, evidence, facts, why, lint: problems, retried };
}
