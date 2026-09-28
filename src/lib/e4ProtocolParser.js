// E4 评估框架传递协议（v1.2）Markdown 解析器。
//
// 协议结构（实测 2026-09）：
//   ## META / ## E4_EVALUATIONS（### E1..E4，E2 为无 #### 的单块）
//   ## OTHER_VARIABLES（[EVAL]/[ORDER]/[NORM] + ### 核心问题 / 可能失真 / 跟进线索）
//   ## OVERVIEW（### 真实优势 / 名单归属）
//   ## Y4_INTERPRETATION / ## EXPERT_JUDGMENTS / ## 名单归属
//
// 设计原则：对缺失段落、空值、未知标签全部容错；畸形输入返回安全空结构，不抛异常。

const DIMENSION_RE = /^###\s*(E\d)\s*[·•・・]\s*([A-Za-z0-9]+)\s*[（(]([^）)]*)[）)]?/;

const DIMENSION_CODES = ['E1', 'E2', 'E3', 'E4'];

const emptyProtocol = (raw = '') => ({
  version: '',
  meta: {
    student: '', gender: '', grade: '', school: '',
    date: '', generated: '', status: '', rosterTag: '',
  },
  dimensions: Object.fromEntries(DIMENSION_CODES.map((code) => [code, makeDimension(code, '', '')])),
  dimensionOrder: DIMENSION_CODES,
  otherVariables: { evals: [], orders: [], norms: [] },
  coreProblems: [],
  watchItems: '',
  followUpLeads: [],
  overview: { strengths: '', roster: '' },
  y4Interpretation: '',
  expertJudgments: '',
  rosterTail: '',
  raw,
});

function makeDimension(code, name, cn) {
  return { code, name: name || '', cn: cn || '', questions: [], block: null };
}

function parsePipeFields(line) {
  return line
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseEvalLine(rest) {
  const parts = parsePipeFields(rest);
  const metric = parts[0] || '';
  const value = parts[1] && !/^note:/.test(parts[1]) ? parts[1] : '';
  const notePart = parts.find((p) => /^note:/.test(p));
  const note = notePart ? notePart.replace(/^note:\s*/, '').trim() : '';
  return { metric, value, note };
}

function parseRefLine(rest) {
  const metric = rest.replace(/→.*$/, '').trim();
  return { metric };
}

function parseBullet(line) {
  const m = line.match(/^\s*(?:[-*]|\d+[.)、])\s*(.+)$/);
  if (!m) return null;
  const body = m[1].trim();
  const bold = body.match(/^\*\*(.+?)\*\*[：:．.]?\s*(.*)$/);
  if (bold) return { title: bold[1].trim(), text: bold[2].trim() };
  return { title: '', text: body };
}

/**
 * 解析 E4 协议 markdown。
 * @param {string} md
 * @returns {object}
 */
export function parseE4Protocol(md) {
  if (!md || typeof md !== 'string') return emptyProtocol(md || '');

  const result = emptyProtocol(md);
  try {
    const lines = md.split(/\r?\n/);
    let section = '';
    let subSection = '';
    let dim = null;
    let question = null;
    let judgmentTarget = null; // {judgment:string} 当前收集「判断：」段落的宿主

    const ensureDim = (code, name, cn) => {
      if (!result.dimensions[code]) result.dimensions[code] = makeDimension(code, name, cn);
      return result.dimensions[code];
    };

    const attachTagLine = (line, target) => {
      if (!target) return;
      if (line.startsWith('[EVAL]')) {
        target.evals = target.evals || [];
        target.evals.push(parseEvalLine(line.slice(6).trim()));
      } else if (line.startsWith('[REF]')) {
        target.refs = target.refs || [];
        target.refs.push(parseRefLine(line.slice(5).trim()));
      }
    };

    const KNOWN_SECTIONS = new Set([
      'META', 'E4_EVALUATIONS', 'OTHER_VARIABLES', 'OVERVIEW',
      'Y4_INTERPRETATION', 'EXPERT_JUDGMENTS', '名单归属',
    ]);

    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      // 标题中的版本号（H1）
      const h1 = line.match(/^#\s+.*协议\s*(v[\d.]+)/);
      if (h1 && !line.startsWith('##')) {
        result.version = h1[1];
        continue;
      }

      // 顶级章节：仅在命中已知章节名时切换；Y4_INTERPRETATION 内部的
      // `## 总体印象` 等二级标题属于正文内容，不能切换章节。
      const h2 = line.match(/^##\s+(.+?)\s*$/);
      if (h2 && !line.startsWith('###') && KNOWN_SECTIONS.has(h2[1].trim())) {
        section = h2[1].trim();
        subSection = '';
        dim = null;
        question = null;
        judgmentTarget = null;
        continue;
      }

      // ---- META ----
      if (section === 'META') {
        const roster = line.match(/名单归属\s*[：:]\s*(.+)/);
        if (roster) result.meta.rosterTag = roster[1].replace(/\*/g, '').trim();
        if (line.includes(':')) {
          for (const field of parsePipeFields(line)) {
            const [k, ...v] = field.split(':');
            const key = (k || '').trim();
            const val = v.join(':').replace(/\*/g, '').trim();
            if (key === 'student') result.meta.student = val;
            else if (key === 'gender') result.meta.gender = val;
            else if (key === 'grade') result.meta.grade = val;
            else if (key === 'school') result.meta.school = val;
            else if (key === 'date') result.meta.date = val;
            else if (key === 'generated') result.meta.generated = val;
            else if (key === 'status') result.meta.status = val;
          }
        }
        continue;
      }

      // ---- E4_EVALUATIONS ----
      if (section === 'E4_EVALUATIONS') {
        const dm = line.match(DIMENSION_RE);
        if (dm) {
          dim = ensureDim(dm[1], dm[2], dm[3]);
          question = null;
          judgmentTarget = null;
          continue;
        }
        const h4 = line.match(/^####\s+(.+?)\s*$/);
        if (h4 && dim) {
          question = {
            dimension: dim.code,
            title: h4[1].trim(),
            verdict: '', list: '', topic: '',
            evals: [], refs: [], judgment: '',
          };
          dim.questions.push(question);
          judgmentTarget = null;
          continue;
        }
        if (line.startsWith('[VERDICT]')) {
          const rest = line.slice('[VERDICT]'.length).trim();
          const fields = parsePipeFields(rest).map((f) => f.replace(/^\[LIST\]\s*/, '').trim());
          const payload = {
            verdict: fields[0] || '',
            list: fields[1] || '',
            topic: fields[2] || '',
            evals: [], refs: [], judgment: '',
          };
          if (question) {
            Object.assign(question, payload);
            judgmentTarget = question;
          } else if (dim) {
            dim.block = { dimension: dim.code, title: '', ...payload };
            judgmentTarget = dim.block;
          }
          continue;
        }
        if (/^\[EVAL\]|^\[REF\]/.test(line)) {
          attachTagLine(line, question || (dim ? dim.block : null));
          continue;
        }
        if (/^判断\s*[：:]/.test(line) && judgmentTarget) {
          judgmentTarget.judgment = line.replace(/^判断\s*[：:]\s*/, '').trim();
          // 判断可能跨多行，直到空行或新标签/标题
          while (i + 1 < lines.length) {
            const nxt = lines[i + 1].trim();
            if (!nxt || /^#|\[VERDICT\]|\[EVAL\]|\[REF\]|^判断\s*[：:]/.test(nxt)) break;
            judgmentTarget.judgment += `\n${nxt}`;
            i += 1;
          }
          judgmentTarget.judgment = judgmentTarget.judgment.trim();
          continue;
        }
        continue;
      }

      // ---- OTHER_VARIABLES ----
      if (section === 'OTHER_VARIABLES') {
        const h3 = line.match(/^###\s+(.+?)\s*$/);
        if (h3) { subSection = h3[1].trim(); continue; }
        if (line.startsWith('[EVAL]')) { result.otherVariables.evals.push(parseEvalLine(line.slice(6).trim())); continue; }
        if (line.startsWith('[ORDER]')) {
          const p = parseEvalLine(line.slice(7).trim());
          result.otherVariables.orders.push(p);
          continue;
        }
        if (line.startsWith('[NORM]')) {
          const p = parseEvalLine(line.slice(6).trim());
          result.otherVariables.norms.push(p);
          continue;
        }
        const bullet = parseBullet(line);
        if (bullet) {
          if (subSection.includes('核心问题')) result.coreProblems.push(bullet);
          else if (subSection.includes('跟进')) result.followUpLeads.push(bullet);
          else if (subSection.includes('失真') || subSection.includes('观察')) {
            result.watchItems = result.watchItems ? `${result.watchItems}\n${bullet.text}` : bullet.text;
          }
        } else if (line && (subSection.includes('失真') || subSection.includes('观察')) && !line.startsWith('#')) {
          result.watchItems = result.watchItems ? `${result.watchItems}\n${line}` : line;
        }
        continue;
      }

      // ---- OVERVIEW ----
      if (section === 'OVERVIEW') {
        const h3 = line.match(/^###\s+(.+?)\s*$/);
        if (h3) { subSection = h3[1].trim(); continue; }
        if (!line || line.startsWith('#')) continue;
        if (subSection.includes('真实优势')) {
          result.overview.strengths = result.overview.strengths ? `${result.overview.strengths}\n${line}` : line;
        } else if (subSection.includes('名单归属')) {
          const clean = line.replace(/\*/g, '');
          if (clean === '弱干预' || clean === '强干预' || clean.includes('干预')) {
            if (!result.meta.rosterTag) result.meta.rosterTag = clean.split(/\s|\n/)[0];
          }
          result.overview.roster = result.overview.roster ? `${result.overview.roster}\n${clean}` : clean;
        }
        continue;
      }

      // ---- Y4_INTERPRETATION ----
      if (section === 'Y4_INTERPRETATION') {
        result.y4Interpretation = result.y4Interpretation ? `${result.y4Interpretation}\n${line}` : line;
        continue;
      }

      // ---- EXPERT_JUDGMENTS ----
      if (section === 'EXPERT_JUDGMENTS') {
        if (line === '---') { section = '__TAIL__'; subSection = ''; continue; }
        result.expertJudgments = result.expertJudgments ? `${result.expertJudgments}\n${line}` : line;
        continue;
      }

      if (section === '__TAIL__' || section.includes('名单归属')) {
        if (line && !line.startsWith('凭远教育')) {
          result.rosterTail = result.rosterTail ? `${result.rosterTail}\n${line}` : line;
        }
      }
    }

    // 补齐缺失维度
    for (const code of result.dimensionOrder) {
      if (!result.dimensions[code]) result.dimensions[code] = makeDimension(code, '', '');
    }
    result.y4Interpretation = result.y4Interpretation.trim();
    result.expertJudgments = result.expertJudgments.trim();
    return result;
  } catch {
    return emptyProtocol(md);
  }
}

/**
 * 构建跨问题的 EVAL 指标索引（同名指标以首次出现为准，用于解析 [REF]）。
 */
export function buildEvalIndex(protocol) {
  const index = new Map();
  const put = (metric, value, note) => {
    if (metric && !index.has(metric)) index.set(metric, { value: value || '', note: note || '' });
  };
  Object.values(protocol.dimensions || {}).forEach((d) => {
    [...d.questions, ...(d.block ? [d.block] : [])].forEach((q) => {
      (q.evals || []).forEach((e) => put(e.metric, e.value, e.note));
    });
  });
  (protocol.otherVariables?.evals || []).forEach((e) => put(e.metric, e.value, e.note));
  return index;
}
