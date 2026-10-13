// 顾问解析与分组
// 备注名（mentor_alias）里用括号写顾问归属，例如：
//   "Cathryn(Angela)" / "Samson（Jason）" / "Chloe (Jason)" / "Jeff"
// 顾问名仅用于前端展示分组，不写库。

/** 任意一对括号（半角 () / 全角 （）），容忍括号内空格 */
const BRACKET_PAIR = String.raw`[（(]\s*([^（()）]*?)\s*[)）]`;

function allBrackets(alias) {
  const re = new RegExp(`[（(][^（()）]*?[)）]`, 'g');
  return alias.replace(re, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 解析备注名：取最后一对括号内的名字作为顾问。
 * @returns {{ consultant: string|null, cleanName: string }}
 *   "Cathryn(Angela)" → { consultant: 'Angela', cleanName: 'Cathryn' }
 *   "Samson（Jason）" → { consultant: 'Jason',  cleanName: 'Samson' }
 *   "Jeff" / null     → { consultant: null,     cleanName: 'Jeff' }
 */
export function parseConsultant(alias) {
  const raw = (alias == null ? '' : String(alias)).trim();
  if (!raw) return { consultant: null, cleanName: '' };

  const re = new RegExp(BRACKET_PAIR, 'g');
  let last = null;
  let m;
  while ((m = re.exec(raw)) !== null) last = m;
  const consultantRaw = last ? (last[1] || '').trim() : '';

  return {
    consultant: consultantRaw || null,
    cleanName: allBrackets(raw),
  };
}

/** 分组键：顾问名统一小写；无顾问归入 __unassigned__ */
export function consultantKey(consultant) {
  return consultant ? String(consultant).trim().toLowerCase() : '__unassigned__';
}

/**
 * 按顾问分组。
 * @param {Array} students 学生（profiles role=1）
 * @param {Object} connections 以 student_id 为键的连接表（含 mentor_alias）
 * @returns {Array<{ consultant: string|null, students: Array }>}
 *   顾问名大小写归一合并，显示首个出现的写法；
 *   组按人数降序，未分配组排最后；组内按 created_at 倒序。
 */
export function groupByConsultant(students, connections) {
  const conn = connections || {};
  const byKey = new Map();
  const order = [];

  for (const s of students || []) {
    const alias = conn[s.id]?.mentor_alias || '';
    const { consultant } = parseConsultant(alias);
    const key = consultantKey(consultant);
    let group = byKey.get(key);
    if (!group) {
      group = { consultant: consultant || null, students: [] };
      byKey.set(key, group);
      order.push(group);
    }
    group.students.push(s);
  }

  for (const g of order) {
    g.students = [...g.students].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
  }

  const assigned = order.filter((g) => g.consultant);
  const unassigned = order.filter((g) => !g.consultant);
  // Array.sort 稳定：人数相同时保持首次出现顺序
  assigned.sort((a, b) => b.students.length - a.students.length);

  return [...assigned, ...unassigned];
}

// 低饱和预设色（避开品牌红 #B91C1C），同顾问恒定同色
const PALETTE = [
  '#0F766E', // teal
  '#1D4ED8', // blue
  '#7C3AED', // violet
  '#B45309', // amber
  '#047857', // emerald
  '#4F46E5', // indigo
  '#0E7490', // cyan
  '#9333EA', // purple
];
const NEUTRAL = '#64748B'; // 未分配

/** 按顾问名哈希取色，用于头像 / 区头 monogram */
export function consultantColor(consultant) {
  if (!consultant) return NEUTRAL;
  const str = String(consultant).trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
