// AI 会议佐证生成：把会议纪要总结成每个 E4 排查项的「会议核实情况」。
// 仅服务端持有 LLM_API_KEY，前端只调用同源 /api/llm/meeting-notes。
// 使用 OpenAI 兼容接口（ARK/Doubao、DeepSeek、Qwen、OpenAI 等均可，通过 env 配置）。

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

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: '仅支持 POST 请求' });
    return;
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    res.status(503).json({ ok: false, error: '服务端未配置 LLM_API_KEY，无法使用 AI 生成会议佐证' });
    return;
  }

  const baseURL = process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.LLM_MODEL || 'doubao-1-5-pro-32k-250115';

  // 可选：厂商特有参数，例如百炼 qwen3 思考模型传 {"enable_thinking":false}
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

  const minutes = String(payload?.minutes || '').trim();
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  if (!minutes) {
    res.status(400).json({ ok: false, error: '请先粘贴会议纪要' });
    return;
  }
  if (rows.length === 0) {
    res.status(400).json({ ok: false, error: '没有可生成佐证的排查项' });
    return;
  }

  // 只给模型需要的字段，避免 prompt 过长
  const items = rows.map((r) => ({
    rowId: r.rowId,
    label: r.label,
    y4Clue: String(r.y4Clue || '').slice(0, 160),
  }));

  const systemPrompt = [
    '你是学习力导师的会议纪要整理助手。',
    '导师会粘贴一次首次学习力会议的完整纪要，你需要针对给定的每个排查项，从纪要中提取与之相关的「会议佐证」。',
    '严格规则：',
    '1. 只能使用纪要中真实出现的信息，严禁编造或补全。',
    '2. 某个排查项在纪要中找不到相关内容时，返回空字符串 ""。',
    '3. 每条佐证保持简短：1-3 个短句，或 2-3 条要点；优先引用学生的具体行为、家长反映、发生的具体事件。',
    '4. 不要加入判断结论（如「存在问题」「需要关注」），只陈述事实。',
    '5. 输出必须是严格的 JSON，键为排查项的 rowId，值为佐证字符串，不含任何解释、Markdown 或多余文字。',
  ].join('\n');

  const userPrompt = [
    `【会议纪要】\n${minutes}`,
    '',
    `【排查项】（共 ${items.length} 项）`,
    JSON.stringify(items, null, 0),
    '',
    '请输出 JSON：{ "rowId": "佐证文本", ... }',
  ].join('\n');

  try {
    const resp = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 4096,
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
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = firstJson(content);

    if (!parsed || typeof parsed !== 'object') {
      res.status(502).json({ ok: false, error: 'AI 返回内容无法解析为 JSON，请重试' });
      return;
    }

    // 归一化：只保留已知 rowId，值强制转字符串并裁剪长度
    const notes = {};
    for (const r of rows) {
      const v = parsed[r.rowId];
      notes[r.rowId] = v == null ? '' : String(v).trim().slice(0, 600);
    }

    res.status(200).json({ ok: true, notes });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: `无法连接 LLM 服务：${err.message || 'network error'}`,
    });
  }
}
