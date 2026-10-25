// AI 监督流程：给导师生成「每日一句表扬」和「每周小结」草稿。
// 纯函数 + 一个 OpenAI 兼容调用，服务端（api/supervision）与本地 dry-run 脚本共用。
// 草稿只给导师看、导师改了再发，学生端永远看不到原稿。

const CATEGORY = { 1: '学习', 2: '复习', 3: '练习' };
const SUBJECTIVE = { 20: '没有听课', 40: '像在听天书', 60: '有不少没掌握', 80: '基本掌握', 100: '完全掌握' };
const WEEKDAY = '日一二三四五六';

function mmdd(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()} 周${WEEKDAY[d.getDay()]}`;
}

/** 一条记录 → 给模型看的一行（不含学生姓名） */
export function recordLine(r, i) {
  const parts = [
    `#${i + 1}`,
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
  '- 夸要夸在具体的做法上（比如做完练习回头复习、把错题改对、备注写得清楚、实测比自评好），不要夸人、不要夸态度。',
  '- 不要写成作文或评语。不要用成语、四字词堆砌、排比、对仗、感叹号、表情符号。',
  '- 不要分析、不要下结论（不要写「说明……」「可见……」「可能高估了」），像聊天一样把事情说出来就行。',
  '- 只挑一两件事说，不要把每一科都报一遍，不要罗列一串分数。',
  '- 禁止这些套话：加油、继续保持、再接再厉、值得表扬、值得肯定、非常棒、很棒、优秀、出色、展现、体现、态度、习惯、坚持、进步很大、亮点、相信你、希望你、目标、计划、方向、高效。',
  '- 不要提学习时长目标，不要拿别的同学比较，不要评价休息。',
].join('\n');

const DAILY_TASK = [
  '任务：根据学生「昨天」的学习记录，写一句表扬。',
  '- 一到两句话，一般 20 到 45 个字，最多 60 个字。',
  '- 只表扬：不提建议、不提问、不说「不要紧」「慢慢来」之类的安慰。',
  '- 如果有备注，优先从备注里找可以说的事。',
].join('\n');

const WEEKLY_TASK = [
  '任务：根据学生「上周」的学习记录，写一段周小结。',
  '- 第一部分：说一两件这周做得好的具体的事。',
  '- 第二部分：只在「要提的问题」里给了内容时才写。挑最要紧的一件，用商量的口气问一句（比如「……是不是还没弄明白？」「下周……要不要先……？」）。和第一部分之间空一行。',
  '- 「要提的问题」写着「无」时，只写第一部分，不要自己找问题，也不要提醒、提建议。',
  '- 第一部分 20 到 60 个字，第二部分 15 到 50 个字。',
].join('\n');

const EXAMPLES = [
  '语气参考（只学语气；示例里的科目和说法都不要照搬，每条消息用自己的话）：',
  '- 「历史那张时间线你自己重画了一遍，比抄笔记管用。」',
  '- 「生物细胞分裂那几张图，你把两次画错的地方都标出来了，复习的时候一眼就能看到。」',
  '- 「这周西班牙语每天都碰了一点，动词变位那组练习拿了 A。\\n\\n地理两次练习的实测还没填，周末有空补一下？」',
  '不要写成这样：',
  '- 「你在物理学习中展现了认真的态度，值得表扬，继续加油！」',
  '- 「本周你保持了良好的学习习惯，各科均衡发展，说明学习方法正确。」',
].join('\n');

const OUTPUT = '只输出严格的 JSON：{"text":"消息正文","evidence":[用到的记录编号，比如 1, 3]}，不要任何解释。';

/**
 * @param {{ kind: 'daily'|'weekly', dayN?: number, records: Array, extras?: string[] }} input
 *   records：该时段内的 learning_sessions（已联表成 course/chapter/unit 名称）
 *   extras：额外事实（如「物理有 2 条练习实测还没填」），可为空
 */
export function buildMessages({ kind, dayN, records, extras = [], issues = [] }) {
  const system = [VOICE, '', kind === 'weekly' ? WEEKLY_TASK : DAILY_TASK, '', EXAMPLES, '', OUTPUT].join('\n');
  const head = kind === 'weekly'
    ? '上周的学习记录：'
    : `这是学生注册后的第 ${dayN} 天。昨天的学习记录：`;
  const user = [
    head,
    ...records.map(recordLine),
    extras.length ? `\n其他情况：\n${extras.map((e) => `- ${e}`).join('\n')}` : '',
    kind === 'weekly' ? `\n要提的问题：${issues.length ? `\n${issues.map((e) => `- ${e}`).join('\n')}` : '无'}` : '',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// 套话 / 书面腔检测：用于测试、dry-run 打分，以及服务端命中时重试一次
const STOCK = ['加油', '继续保持', '再接再厉', '值得表扬', '值得肯定', '非常棒', '很棒', '优秀', '出色', '展现', '体现', '态度', '习惯', '坚持', '进步很大', '亮点', '相信你', '希望你', '目标', '计划', '方向', '高效', '说明', '可见', '同学', '！', '!'];
export function lintDraft(text, kind = 'daily') {
  const t = String(text || '');
  const issues = STOCK.filter((w) => t.includes(w)).map((w) => `套话「${w}」`);
  const len = t.replace(/\s/g, '').length;
  if (kind === 'daily' && len > 60) issues.push(`太长（${len} 字）`);
  if (kind === 'weekly' && len > 120) issues.push(`太长（${len} 字）`);
  if (/[\u{1F300}-\u{1FAFF}]/u.test(t)) issues.push('有表情符号');
  return issues;
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
    return { text, evidence };
  } catch {
    return null;
  }
}

/** 当前使用的模型名（写入 supervision_drafts.model） */
export function modelNameOf(env = process.env) {
  return env.LLM_MODEL || 'doubao-1-5-pro-32k-250115';
}

/** OpenAI 兼容调用（DashScope / 火山 ARK 均可），返回 { text, evidence } 或抛错 */
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
      body: JSON.stringify({ model, temperature, max_tokens: 600, response_format: { type: 'json_object' }, messages, ...extraBody }),
    });
    if (!resp.ok) throw new Error(`模型请求失败（HTTP ${resp.status}）`);
    const data = await resp.json();
    return parseDraft(data?.choices?.[0]?.message?.content);
  };

  const messages = buildMessages(input);
  let draft = await call(messages);
  if (!draft) draft = await call(messages); // 偶发空返回 / 非 JSON：再要一次
  if (!draft) throw new Error('模型没有返回可用的草稿');
  // 没有要提的问题时只要第一段，防止模型自己补一段提醒
  if (input.kind === 'weekly' && !(input.issues || []).length) draft.text = draft.text.split(/\n\s*\n/)[0].trim();
  // 命中套话 / 超长时带着问题重写一次
  const issues = lintDraft(draft.text, input.kind);
  if (issues.length) {
    const retry = await call([
      ...messages,
      { role: 'assistant', content: JSON.stringify(draft) },
      { role: 'user', content: `这条有问题：${issues.join('、')}。按上面的要求重写，更像平时说话。仍然只输出 JSON。` },
    ]);
    if (retry) draft = { ...retry, retried: true };
  }
  return draft;
}
