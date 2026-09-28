// E4《首次学习力分析报告》固定模板定义 + 协议→报告草稿映射。
//
// 排查项目行严格对齐导师提供的 docx 样稿：
//   Emotion 8 行；Energy 4 行 + 3 行会议补充；
//   Engine 11 行；Engagement 8 行 + 5 行会议补充。共 31 行。

import { buildEvalIndex } from './e4ProtocolParser.js';

export const JUDGMENT_STATES = ['已确认问题', '可能存在', '暂未发现', '信息不足'];

// 协议 VERDICT → 报告综合判断 的默认建议（导师可改；「已确认问题」只能由导师选定）
export const VERDICT_DEFAULT_MAP = {
  健康: '暂未发现',
  中性: '暂未发现',
  关注: '可能存在',
  需支持: '可能存在',
  需介入: '可能存在',
};

export const DIMENSION_ORDER = ['E1', 'E2', 'E3', 'E4'];

export const DIMENSIONS = {
  E1: {
    code: 'E1',
    no: '03',
    short: 'Emotion',
    title: 'Emotion 学业情绪',
    en: 'CAN THE STUDENT ENTER LEARNING WITH STABILITY AND CONFIDENCE',
    coreQuestion: '核心问题  学生面对学习及相关环境时，是否拥有稳定的情绪、安全感和学习信心？',
    intro: '',
    accent: 'red',
    supplement: { heading: '会议补充确认（现实行为）', cols: ['补充项目', '访谈与现实表现', '综合判断'] },
    narratives: [
      { key: 'coreFinding', label: '当前核心发现', barColor: 'teal' },
      { key: 'followUp', label: '后续观察', barColor: 'orange' },
    ],
  },
  E2: {
    code: 'E2',
    no: '04',
    short: 'Energy',
    title: 'Energy 身心能量',
    en: 'CAN THE STUDENT SUSTAIN LEARNING WITH AVAILABLE ENERGY',
    coreQuestion: '',
    intro: '最新版Y4在本维度形成一个综合判断，主要依据睡眠、饮食、运动及身体自我感受四项信息。',
    accent: 'orange',
    supplement: { heading: '会议补充确认', cols: ['补充项目', '访谈与观察情况', '综合判断'] },
    narratives: [
      { key: 'coreFinding', label: '当前核心发现', barColor: 'teal' },
      { key: 'learningImpact', label: '实际学习影响', barColor: 'orange' },
    ],
  },
  E3: {
    code: 'E3',
    no: '05',
    short: 'Engine',
    title: 'Engine 认知引擎',
    en: 'COGNITIVE RESOURCES EXECUTIVE FUNCTIONS AND LEARNING DRIVE',
    coreQuestion: '核心问题  现有认知资源、执行功能与学习动力，能否支持当前学习任务？',
    intro: '',
    accent: 'teal',
    supplement: { heading: '会议补充确认（现实行为）', cols: ['补充项目', '访谈与现实表现', '综合判断'] },
    narratives: [
      { key: 'coreFinding', label: '当前核心发现', barColor: 'teal' },
      { key: 'strengths', label: '可利用优势', barColor: 'blue' },
    ],
  },
  E4: {
    code: 'E4',
    no: '06',
    short: 'Engagement',
    title: 'Engagement 学习投入',
    en: 'CAN ABILITY BECOME METHODS PLANS AND ACTION',
    coreQuestion: '',
    intro: 'Y4提供策略匹配与计划线索；任务启动、坚持、干扰和求助必须通过会议中的真实行为进一步确认。',
    accent: 'blue',
    supplement: { heading: '会议补充确认', cols: ['现实行为', '学生 / 家长提供的具体事件', '综合判断'] },
    narratives: [
      { key: 'coreFinding', label: '当前核心发现', barColor: 'teal' },
    ],
  },
};

// 每行：id / dim / label（排查项目）/ aliases（匹配协议 #### 标题的关键词）/ evalKeys（E2 单块匹配指标）/ supplement（会议补充行）
export const CHECKLIST_ROWS = [
  // ---- Emotion ----
  { id: 'emo-confidence', dim: 'E1', label: '学习自信程度', aliases: ['学习的自信', '取得好的成绩'] },
  { id: 'emo-school', dim: 'E1', label: '学校环境的负面影响', aliases: ['学校环境'] },
  { id: 'emo-parent', dim: 'E1', label: '亲子关系对学业情绪的影响', aliases: ['亲子关系'] },
  { id: 'emo-self-esteem', dim: 'E1', label: '整体自卑状态', aliases: ['自卑'] },
  { id: 'emo-anxiety', dim: 'E1', label: '焦虑状态', aliases: ['焦虑状态'] },
  { id: 'emo-sensitive', dim: 'E1', label: '高敏感与内耗', aliases: ['高敏感'] },
  { id: 'emo-depressed', dim: 'E1', label: '不开心或情绪低落', aliases: ['不开心'] },
  { id: 'emo-security', dim: 'E1', label: '安全感状态', aliases: ['安全感'] },
  // ---- Energy 主表（来自 E2 单块 [EVAL]）----
  { id: 'ene-sleep', dim: 'E2', label: '睡眠习惯', evalKeys: ['睡眠习惯'] },
  { id: 'ene-diet', dim: 'E2', label: '饮食习惯', evalKeys: ['饮食习惯'] },
  { id: 'ene-exercise', dim: 'E2', label: '运动习惯', evalKeys: ['运动习惯'] },
  { id: 'ene-body', dim: 'E2', label: '身体状态与自我感受', evalKeys: ['躯体外貌', 'BMI'] },
  // ---- Energy 会议补充 ----
  { id: 'ene-daytime', dim: 'E2', label: '日间精力', supplement: true, supplementTable: true },
  { id: 'ene-study-window', dim: 'E2', label: '学习时段', supplement: true, supplementTable: true },
  { id: 'ene-other', dim: 'E2', label: '其他身体因素', supplement: true, supplementTable: true },
  // ---- Engine ----
  { id: 'eng-input', dim: 'E3', label: '信息输入基本功能', aliases: ['信息输入'] },
  { id: 'eng-storage', dim: 'E3', label: '信息存储基本功能', aliases: ['信息存储'] },
  { id: 'eng-analysis', dim: 'E3', label: '信息分析基本功能', aliases: ['信息分析'] },
  { id: 'eng-speed', dim: 'E3', label: '信息加工速度', aliases: ['加工速度'] },
  { id: 'eng-focus', dim: 'E3', label: '专注与抑制控制', aliases: ['执行能力-专注力'] },
  { id: 'eng-working-memory', dim: 'E3', label: '工作记忆', aliases: ['运用记忆'] },
  { id: 'eng-flexibility', dim: 'E3', label: '认知灵活性', aliases: ['认知灵活性'] },
  { id: 'eng-motivation', dim: 'E3', label: '整体学习动机', aliases: ['学习动机是否强大'] },
  { id: 'eng-success', dim: 'E3', label: '成功动机', aliases: ['渴望成功'] },
  { id: 'eng-deep', dim: 'E3', label: '深层学习动机', aliases: ['有深层学习动机'] },
  { id: 'eng-drive', dim: 'E3', label: '内驱力状态', aliases: ['内驱力'] },
  // ---- Engagement 主表 ----
  { id: 'egt-logic', dim: 'E4', label: '数理逻辑策略是否匹配', aliases: ['第一组'] },
  { id: 'egt-spatial', dim: 'E4', label: '空间能力策略是否匹配', aliases: ['第二组'] },
  { id: 'egt-understand', dim: 'E4', label: '理解型策略是否匹配', aliases: ['第三组'] },
  { id: 'egt-memorize', dim: 'E4', label: '记忆型策略是否匹配', aliases: ['第四组'] },
  { id: 'egt-methods', dim: 'E4', label: '学习方法使用程度', aliases: ['方法的程度'] },
  { id: 'egt-planning', dim: 'E4', label: '计划性', aliases: ['计划性'] },
  { id: 'egt-certainty', dim: 'E4', label: '确定性需求', aliases: ['确定性需求'] },
  { id: 'egt-metacognition', dim: 'E4', label: '元认知潜力', aliases: ['元认知'] },
  // ---- Engagement 会议补充（现实行为）----
  { id: 'egt-start', dim: 'E4', label: '任务启动', supplement: true, supplementTable: true },
  { id: 'egt-distraction', dim: 'E4', label: '干扰管理', supplement: true, supplementTable: true },
  { id: 'egt-avoidance', dim: 'E4', label: '困难任务回避', supplement: true, supplementTable: true },
  { id: 'egt-help', dim: 'E4', label: '主动求助', supplement: true, supplementTable: true },
  { id: 'egt-time', dim: 'E4', label: '时间分配', supplement: true, supplementTable: true },
];

// 第 02 页固定文案
export const REPORT_STATIC = {
  brandKicker: 'E4 · LEARN WITH EASE',
  title: '首次学习力分析报告',
  subtitle: 'E4 STUDENT LEARNING PROFILE · INITIAL REPORT',
  intro: '通过Y4测评与首次学习力会议，识别当前影响学习的关键环节，并形成可验证的首阶段成长方案。',
  confidentiality: '本报告仅用于学习支持与家庭沟通，不构成医学、心理或教育诊断。若持续出现明显睡眠、情绪或健康困扰，应由家庭寻求相应专业支持。',
  howToReadTitle: '如何阅读E4首次学习力分析报告',
  howToReadEn: 'HOW TO READ THIS REPORT',
  howToReadLead: '本报告从Y4测评提供的线索出发，结合学生和家长在首次学习力会议中提供的具体事件，由导师判断当前哪些环节得到支持、哪些问题需要继续确认或优先改变。',
  fourE: [
    { key: 'Emotion', cn: '学业情绪', desc: '面对学习时能否保持信心，并从压力或受挫中恢复。', tint: 'red' },
    { key: 'Energy', cn: '身心能量', desc: '当前睡眠、饮食、运动与身体状态能否支持持续学习。', tint: 'orange' },
    { key: 'Engine', cn: '认知引擎', desc: '认知资源、执行功能与学习动力是否能够匹配任务。', tint: 'teal' },
    { key: 'Engagement', cn: '学习投入', desc: '能否把能力转化为方法、计划和真实学习行动。', tint: 'blue' },
  ],
  processTitle: '报告如何形成判断',
  processSteps: [
    { no: '01', label: 'Y4线索', desc: '发现值得追问的方向' },
    { no: '02', label: '会议核实', desc: '回到具体事件与行为' },
    { no: '03', label: '综合判断', desc: '区分问题与待观察项' },
    { no: '04', label: '后续验证', desc: '用真实行动持续更新' },
  ],
  statesTitle: '四种判断状态',
  states: [
    { label: '已确认问题', desc: 'Y4线索与近期具体事件相互印证', tint: 'red' },
    { label: '可能存在', desc: '已有线索，但仍需后续行为继续确认', tint: 'orange' },
    { label: '暂未发现', desc: '当前没有足够证据显示存在问题', tint: 'teal' },
    { label: '信息不足', desc: '现有信息还不能支持判断', tint: 'gray' },
  ],
  principles: [
    '本报告不以单一分数定义学生。首次报告描述当前起点和待验证的问题假设，后续将根据每月行为记录与访谈持续更新。',
    '重点不是一次解决所有问题，而是找到当前最值得优先改变的一环，并验证策略是否真正有效。',
  ],
  defaultEvidenceSource: 'Y4测评＋学生／家长访谈',
};

// ----------------------------------------------------------------

const ATTACHMENT_ASPECTS = new Set(['信任', '沟通', '亲近']);
const ATTACHMENT_TARGETS = new Set(['母亲', '父亲', '同伴']);

function shortMetricName(metric) {
  const segs = String(metric || '').split(/[-·]/).filter(Boolean).map((s) => s.trim());
  let tail = segs.pop() || String(metric || '');
  tail = tail.replace(/得分$/, '').replace(/百分位$/, '百分位');
  if (/总$/.test(tail)) tail = `${tail}分`;
  const prev = segs[segs.length - 1];
  if (ATTACHMENT_ASPECTS.has(prev) && ATTACHMENT_TARGETS.has(tail)) {
    return `${tail}-${prev}`;
  }
  return tail.trim();
}

function valueBasedDefault(value) {
  if (/偏低|中等|较差|差$|需关注|不足/.test(value || '')) return '可能存在';
  return '暂未发现';
}

// 协议里 question.judgment 的格式是："需支持。学习自我调节偏低..." 或 "健康。指标正常..."
// 去掉开头的 verdict 标签，返回第一句自然语言描述
function stripVerdictPrefix(text) {
  if (!text) return '';
  // verdict 标签后可能跟句号、冒号、逗号、空格
  const m = text.match(/^(需支持|需介入|关注|需关注|健康|中性)[。:：，,\s]*(.+)$/);
  if (m) return m[2].trim();
  return text.trim();
}

function firstSentence(text) {
  if (!text) return '';
  const m = text.match(/^([^。；\n]+)/);
  return (m ? m[1] : text).trim();
}

// 组合：先剥 verdict 前缀，再取第一句
function judgmentFirstSentence(text) {
  return firstSentence(stripVerdictPrefix(text));
}

const GENERIC_TOPICS = /^(存在弱项|中性|弱干预|强干预|弱潜能|强潜能|精力管理|内驱力状态|计划性)$/;

function topicOrTitle(q) {
  if (q.topic && !GENERIC_TOPICS.test(q.topic)) return q.topic;
  return q.title
    .replace(/^执行能力-/, '')
    .replace(/[（(].*$/, '')
    .replace(/[？?].*$/, '')
    .trim();
}

// --- y4Clue: 直接使用协议每题末尾「判断：」全文 ---
// 协议 judgment 形如 "需支持。学习自我调节偏低…"，已是加工好的可读结论，
// 报告里不再拼接原始指标值；judgment 缺失时 fallback 到指标摘要。
function questionClue(q, evalIndex) {
  const judgment = (q?.judgment || '').trim();
  if (judgment) return judgment;
  return evalSummary(q?.evals, evalIndex, q?.refs);
}

// E2 block 专用：从 block eval + evalIndex 组合生成参考 PDF 风格
// E2 evals 格式: metric="体质健康-睡眠习惯得分" value="评级:良好"
// 原始分数在 evalIndex 里（key 含 metric 名片段）
function naturalClueE2(rowEvals, evalIndex) {
  if (!rowEvals?.length) return '';
  const e = rowEvals[0];
  // 从 evalIndex 里找匹配的完整条目（比如 "体质健康-睡眠习惯得分 8.6 评级良好"）
  const metricName = e.metric || '';
  let fullValue = e.value || '';
  for (const [key, val] of evalIndex.entries()) {
    if (key.includes(metricName) || metricName.includes(key.replace('得分', ''))) {
      fullValue = (key + ' ' + (val?.value || val)).trim();
      break;
    }
  }
  // 尝试 "得分 X，评级Y" 格式
  const m = fullValue.match(/([0-9.]+)\s*(?:评级)?\s*(良好|优|中等|较差|差)/);
  if (m) return `得分 ${m[1]}，评级${m[2]}。`;
  // fallback: 从 value 里提评级
  const grade = e.value?.match(/评级[:\s]*(\S+)/);
  if (grade) return `评级${grade[1]}。`;
  return `${shortMetricName(metricName)} ${fullValue}`.trim();
}

function evalSummary(evals, evalIndex, refs) {
  const parts = [];
  const seen = new Set();
  const push = (metric, value) => {
    const name = shortMetricName(metric);
    if (!name || seen.has(name)) return;
    seen.add(name);
    parts.push(value ? `${name} ${value}` : name);
  };
  (evals || []).forEach((e) => push(e.metric, e.value));
  (refs || []).forEach((r) => {
    const hit = evalIndex.get(r.metric);
    if (hit) push(r.metric, hit.value);
  });
  return parts.join('；');
}

function matchQuestion(row, questions) {
  return questions.find((q) => row.aliases.some((alias) => q.title.includes(alias))) || null;
}

function findBlockEvals(block, keys) {
  const hits = [];
  (block?.evals || []).forEach((e) => {
    if (keys.some((k) => e.metric.includes(k))) hits.push(e);
  });
  return hits;
}

// --- draftCoreFinding: 参考 PDF 风格的核心发现段落 ---
// 优先用 block.judgment（E2 等有 block 的维度），
// 否则拼接 flagged questions 的 judgment 关键句。
function draftCoreFinding(dimData) {
  // 1. 优先 block.judgment
  if (dimData.block?.judgment) {
    const sentence = judgmentFirstSentence(dimData.block.judgment);
    if (sentence) return sentence;
  }

  // 2. 拼接 flagged/watch questions 的 judgment
  const pool = [...dimData.questions];
  const flagged = pool.filter((q) => ['需支持', '需介入'].includes(q.verdict));
  const watch = pool.filter((q) => q.verdict === '关注');
  const pick = flagged.length ? flagged : watch;
  if (!pick.length) return '';

  const sentences = [];
  const seen = new Set();
  pick.forEach((q) => {
    const s = judgmentFirstSentence(q.judgment);
    if (s && !seen.has(s)) {
      seen.add(s);
      sentences.push(s);
    }
  });
  return sentences.join('；') + (sentences.length ? '。' : '');
}

// --- draftFollowUp: 从协议跟进线索/核心问题里提取 ---
const DIM_KEYWORDS = {
  E1: ['情绪', '焦虑', '自卑', '亲子', '依恋', '安全感', '环境', '自信', '情绪低落', '抑郁'],
  E2: ['睡眠', '饮食', '运动', '精力', '疲劳', '身体', 'BMI', '躯体'],
  E3: ['认知', '记忆', '工作记忆', '执行', '灵活', '动机', '驱动力', '注意力', '加工速度', '推理'],
  E4: ['策略', '学习方法', '计划', '元认知', '启动', '坚持', '干扰', '求助', '深层', '表面'],
};

function draftFollowUp(dimCode, protocol) {
  const kw = DIM_KEYWORDS[dimCode] || [];
  if (!kw.length) return '';

  // 从 followUpLeads 里按关键词匹配取前 1-2 条
  const leads = (protocol.followUpLeads || []).filter((l) => {
    const text = l.text || l.title || String(l);
    return kw.some((k) => text.includes(k));
  }).slice(0, 2).map((l) => (l.text || l.title || String(l)).trim());

  // 从 coreProblems 里取当前维度相关的观察线索（"可能失真·先观察"内容）
  const watches = [];
  if (protocol.watchItems) {
    protocol.watchItems.split(/[；;。\n]/).forEach((s) => {
      const t = s.trim();
      if (t && kw.some((k) => t.includes(k))) watches.push(t);
    });
  }

  const combined = [...leads, ...watches].filter(Boolean);
  return combined.length ? combined.join('；') : '';
}

function strengthsFromOverview(overviewText, dimCode) {
  if (!overviewText) return '';
  return overviewText
    .split('\n')
    .filter((l) => l.includes(dimCode))
    .map((l) => l.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim())
    .join('\n');
}

/**
 * 由已确认行按四个维度汇总第 07 页「已确认的关键问题」。
 * @returns {Array<{dimension:string, text:string}>}
 */
export function deriveConfirmedIssues(sections) {
  const out = [];
  for (const code of DIMENSION_ORDER) {
    const sec = sections[code];
    if (!sec) continue;
    const confirmed = sec.rows.filter((r) => r.judgment === '已确认问题');
    if (!confirmed.length) continue;
    const seed = confirmed
      .map((r) => {
        const detail = (r.meetingNote || r.y4Clue || '').split('\n')[0];
        return detail ? `${r.label}：${detail}` : r.label;
      })
      .join('；');
    out.push({ dimension: code, text: seed });
  }
  return out;
}

/**
 * 解析后的协议 → 报告表单草稿。
 */
export function buildReportDraft(protocol) {
  const evalIndex = buildEvalIndex(protocol);
  const additionalClues = {};
  const matchedQuestionIds = new Set();

  const sections = {};
  for (const code of DIMENSION_ORDER) {
    sections[code] = { rows: [], narratives: {} };
  }

  for (const row of CHECKLIST_ROWS) {
    const dimData = protocol.dimensions[row.dim];
    const baseRow = {
      rowId: row.id,
      label: row.label,
      supplement: !!row.supplement,
      supplementTable: !!row.supplementTable,
      y4Clue: '',
      meetingNote: '',
      judgment: '暂未发现',
      protocolHint: '',
      verdict: '',
    };

    if (row.supplement) {
      // 仅来自会议核实：无 Y4 线索可填
      baseRow.judgment = '暂未发现';
    } else if (row.dim === 'E2') {
      const block = dimData?.block;
      const evals = findBlockEvals(block, row.evalKeys || []);
      baseRow.y4Clue = naturalClueE2(evals, evalIndex);
      baseRow.protocolHint = block?.judgment || '';
      baseRow.verdict = block?.verdict || '';
      baseRow.judgment = evals.length
        ? valueBasedDefault(evals.map((e) => e.value).join(' '))
        : (VERDICT_DEFAULT_MAP[block?.verdict] || '暂未发现');
    } else {
      const q = matchQuestion(row, dimData?.questions || []);
      if (q) {
        matchedQuestionIds.add(`${row.dim}::${q.title}`);
        baseRow.y4Clue = questionClue(q, evalIndex);
        baseRow.protocolHint = q.judgment || '';
        baseRow.verdict = q.verdict || '';
        baseRow.judgment = VERDICT_DEFAULT_MAP[q.verdict] || '暂未发现';
      }
    }

    sections[row.dim].rows.push(baseRow);
  }

  // 未映射到固定行的协议问题（如「确定性需求」）进入附加线索，不丢弃
  for (const code of DIMENSION_ORDER) {
    const qs = protocol.dimensions[code]?.questions || [];
    qs.forEach((q) => {
      if (matchedQuestionIds.has(`${code}::${q.title}`)) return;
      if (!additionalClues[code]) additionalClues[code] = [];
      additionalClues[code].push({
        title: q.title,
        verdict: q.verdict || '',
        clue: evalSummary(q.evals, evalIndex, q.refs),
        judgment: q.judgment || '',
      });
    });
  }

  // 各维度叙述框
  for (const code of DIMENSION_ORDER) {
    const dimData = protocol.dimensions[code];
    const narratives = {};
    DIMENSIONS[code].narratives.forEach(({ key }) => {
      if (key === 'coreFinding') narratives[key] = draftCoreFinding(dimData);
      else if (key === 'strengths') narratives[key] = strengthsFromOverview(protocol.overview?.strengths, code);
      else if (key === 'followUp' || key === 'learningImpact') narratives[key] = draftFollowUp(code, protocol);
      else narratives[key] = '';
    });
    sections[code].narratives = narratives;
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  return {
    modelVersion: 1,
    cover: {
      studentName: protocol.meta?.student || '',
      gender: protocol.meta?.gender || '',
      grade: protocol.meta?.grade || '',
      school: protocol.meta?.school || '',
      y4Date: protocol.meta?.date || '',
      rosterTag: protocol.meta?.rosterTag || '',
      meetingDate: '',
      reportDate: todayStr,
      reportNature: '首次学习力分析报告',
      evidenceSource: REPORT_STATIC.defaultEvidenceSource,
    },
    sections,
    section07: {
      familyQuote: '',
      studentQuote: '',
      confirmedIssues: [],
      solutions: [
        { direction: '', arrangement: '' },
        { direction: '', arrangement: '' },
        { direction: '', arrangement: '' },
      ],
      nextReviewDate: '',
      nextReviewFocus: '',
    },
    additionalClues,
  };
}
