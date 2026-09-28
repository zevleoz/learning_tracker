// 前端调用 AI 生成会议佐证。
// 仅调用同源 /api/llm/*，LLM_API_KEY 只存在于服务端。

export async function summarizeMeetingNotes(minutes, rows) {
  const resp = await fetch('/api/llm/meeting-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      minutes: String(minutes || ''),
      rows: (rows || []).map((r) => ({
        rowId: r.rowId,
        label: r.label,
        y4Clue: r.y4Clue || '',
      })),
    }),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `请求失败（HTTP ${resp.status}）`);
  }
  return data.notes || {};
}

/**
 * 区域级 AI：针对单个区域（排查项/结论/原话/方案）生成文本。
 * @returns {Promise<{note:string, evidence:string[]}>}
 */
export async function generateCellNote({ minutes, label, field = 'meetingNote', y4Clue = '', current = '', instruction = '' }) {
  const resp = await fetch('/api/llm/cell-note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes, label, field, y4Clue, current, instruction }),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `请求失败（HTTP ${resp.status}）`);
  }
  return { note: data.note || '', evidence: data.evidence || [] };
}

/**
 * 会前准备 AI 预填：从 Y4 协议提取学科线索与重点排序。
 * @returns {Promise<Array<{subject:string, clues:string, types:string[], followUp:string}>>}
 */
export async function prefillPrepSubjects({ protocolMd, studentName = '' }) {
  const resp = await fetch('/api/llm/prep-prefill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolMd: String(protocolMd || ''), studentName }),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `请求失败（HTTP ${resp.status}）`);
  }
  return data.subjects || [];
}
