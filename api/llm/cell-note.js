// 区域级 AI 助手：针对报告中的某一个区域（排查项 / 结论盒子 / 原话 / 方案），
// 基于会议纪要生成该区域文本，并摘出纪要中的原文证据片段（供前端高亮）。
// 与 meeting-notes.js 同样使用 OpenAI 兼容接口，LLM_API_KEY 仅服务端持有。

import { requireMentor, sendDenied } from '../../api-lib/require-mentor.js';

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

// 输入上限：与 meeting-notes 保持一致
const MAX_MINUTES = 40000;

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

// 不同区域的任务说明
const FIELD_BRIEFS = {
  meetingNote: {
    target: '该排查项的「会议核实情况」',
    rule: '只陈述纪要中的具体事件、家长反映、学生自述与行为表现，1-3 个短句，不下判断结论。',
  },
  narrative: {
    target: '该维度的结论文本',
    rule: '基于纪要事实做简短、克制的导师式归纳，1-2 句，不夸大、不写纪要中没有的信息。',
  },
  quote: {
    target: '该方的原话摘录',
    rule: '尽量使用纪要中的原句（家长或学生），保持引号内的口语感；找不到可佐证的原话时返回空字符串。',
  },
  solution: {
    target: '该解决方案栏目的内容',
    rule: '给出与该栏目标题相符、可执行的一两句安排；只能基于纪要中暴露的问题，纪要未涉及的方向返回空字符串。',
  },
};

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: '仅支持 POST 请求' });
    return;
  }

  // 鉴权：仅导师及以上账号
  const auth = await requireMentor(req);
  if (!auth.ok) {
    sendDenied(res, auth);
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

  const minutes = String(payload?.minutes || '').trim();
  const label = String(payload?.label || '').trim();
  const field = FIELD_BRIEFS[payload?.field] ? payload.field : 'meetingNote';
  const y4Clue = String(payload?.y4Clue || '').slice(0, 400);
  const current = String(payload?.current || '').slice(0, 600);
  const instruction = String(payload?.instruction || '').slice(0, 300);

  if (!minutes) {
    res.status(400).json({ ok: false, error: '请先粘贴会议纪要' });
    return;
  }
  if (minutes.length > MAX_MINUTES) {
    res.status(400).json({ ok: false, error: `会议纪要过长（上限 ${MAX_MINUTES} 字），请精简后重试` });
    return;
  }
  if (!label) {
    res.status(400).json({ ok: false, error: '缺少区域标题' });
    return;
  }

  const brief = FIELD_BRIEFS[field];
  const systemPrompt = [
    '你是学习力导师的会议纪要整理助手，当前只处理报告中的一个区域。',
    '严格规则：',
    '1. 只能使用会议纪要中真实出现的信息，严禁编造；找不到相关内容时 note 返回空字符串。',
    `2. 输出目标：${brief.target}。${brief.rule}`,
    '3. evidence 填写你依据的 1-3 条纪要原文片段（照抄原句，可截取，不要改写）；没有则返回空数组。',
    '4. 输出必须是严格 JSON：{"note":"...","evidence":["..."]}，不含任何解释或 Markdown。',
  ].join('\n');

  const userPrompt = [
    `【会议纪要】\n${minutes}`,
    '',
    `【区域】${label}`,
    y4Clue ? `【Y4 协议线索（参考，不可直接当作会议事实）】${y4Clue}` : '',
    current ? `【当前文本（重写时参考）】${current}` : '',
    instruction ? `【导师的额外要求】${instruction}` : '',
  ].filter(Boolean).join('\n');

  try {
    const resp = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 1200,
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

    res.status(200).json({
      ok: true,
      note: String(parsed.note || '').trim().slice(0, 800),
      evidence: Array.isArray(parsed.evidence)
        ? parsed.evidence.map((x) => String(x).trim()).filter(Boolean).slice(0, 3)
        : [],
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: `无法连接 LLM 服务：${err.message || 'network error'}` });
  }
}
