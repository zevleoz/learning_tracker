// 会前准备 AI 预填：从 Y4 协议提取学科线索与重点排序。
// 只输出协议中真实出现的学科信息；找不到时返回空数组，不编造。
// OpenAI 兼容接口，LLM_API_KEY 仅服务端持有。

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

function stripCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function firstJson(text) {
  const s = stripCodeFence(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

const VALID_TYPES = new Set(['特别愿意', '特别需要', '特别逃避']);

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: '仅支持 POST 请求' });
    return;
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    res.status(503).json({ ok: false, error: '服务端未配置 LLM_API_KEY' });
    return;
  }

  const baseURL = process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.LLM_MODEL || 'doubao-1-5-pro-32k-250115';

  let extraBody = {};
  if (process.env.LLM_EXTRA_BODY) {
    try {
      extraBody = JSON.parse(process.env.LLM_EXTRA_BODY);
    } catch {
      res.status(503).json({ ok: false, error: '服务端 LLM_EXTRA_BODY 不是合法 JSON' });
      return;
    }
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ ok: false, error: '请求体不是合法 JSON' });
    return;
  }

  const protocolMd = String(payload?.protocolMd || '').trim();
  const studentName = String(payload?.studentName || '').slice(0, 50);
  if (!protocolMd) {
    res.status(400).json({ ok: false, error: '缺少 Y4 协议内容' });
    return;
  }

  const systemPrompt = [
    '你是学习力导师的会前准备助手，正在填写「学科线索与重点排序」表。',
    '严格规则：',
    '1. 只能使用 Y4 协议中真实出现的学科与线索，严禁编造；协议未提及任何学科时 subjects 返回空数组。',
    '2. 按预计会议讨论顺序排列：先学生最愿意谈、最容易提供具体事件的学科，再最需要改善或明显逃避的学科。',
    '3. 每行：subject 学科名；clues 一句话整合协议中的相关线索（不超过 60 字）；types 从「特别愿意/特别需要/特别逃避」中选 1-2 个；followUp 一句会议中值得追问的具体方向（不超过 40 字）。',
    '4. 最多 6 行。输出必须是严格 JSON：{"subjects":[{"subject":"...","clues":"...","types":["..."],"followUp":"..."}]}，不含任何解释或 Markdown。',
  ].join('\n');

  const userPrompt = [
    `【Y4 协议】\n${protocolMd.slice(0, 24000)}`,
    '',
    studentName ? `【学生】${studentName}` : '',
  ].filter(Boolean).join('\n');

  try {
    const resp = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 1600,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...extraBody,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      res.status(resp.status).json({
        ok: false,
        error: `LLM 接口返回错误（HTTP ${resp.status}）：${detail.slice(0, 300)}`,
      });
      return;
    }

    const data = await resp.json();
    const parsed = firstJson(data?.choices?.[0]?.message?.content || '');
    if (!parsed || typeof parsed !== 'object') {
      res.status(502).json({ ok: false, error: 'AI 返回内容无法解析为 JSON，请重试' });
      return;
    }

    const subjects = (Array.isArray(parsed.subjects) ? parsed.subjects : [])
      .map((s) => ({
        subject: String(s?.subject || '').trim().slice(0, 20),
        clues: String(s?.clues || '').trim().slice(0, 120),
        types: (Array.isArray(s?.types) ? s.types : []).map(String).filter((t) => VALID_TYPES.has(t)).slice(0, 2),
        followUp: String(s?.followUp || '').trim().slice(0, 80),
      }))
      .filter((s) => s.subject)
      .slice(0, 6);

    res.status(200).json({ ok: true, subjects });
  } catch (err) {
    res.status(502).json({ ok: false, error: `无法连接 LLM 服务：${err.message || 'network error'}` });
  }
}
