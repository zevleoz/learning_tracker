import { buildMessages, recordLine, lintDraft, parseDraft, checkGrounding, generateDraft } from '../api-lib/supervision-prompt.mjs';

const rec = { session_date: '2026-10-25', start_time: '19:10:00', end_time: '19:55:00', course: 'AP 物理', chapter: '牛顿定律', unit: '受力分析', category: 3, form: '自主练习', duration_minutes: 45, self_rating: 80, grade_label: null, notes: null };

describe('supervision prompt', () => {
  it('describes a record without the student name and marks missing notes and grades', () => {
    const line = recordLine(rec, 0);
    expect(line).toContain('#1');
    expect(line).toContain('AP 物理 / 牛顿定律 / 受力分析');
    expect(line).toContain('自评：基本掌握');
    expect(line).toContain('实测：还没填');
    expect(line).toContain('没写备注');
  });

  it('tells the weekly prompt when there is nothing to raise', () => {
    const [, user] = buildMessages({ kind: 'weekly', records: [rec], issues: [] });
    expect(user.content).toMatch(/要提的问题：无$/);
  });

  it('passes code-detected issues to the weekly prompt', () => {
    const [, user] = buildMessages({ kind: 'weekly', records: [rec], issues: ['物理有 2 次练习的实测还没填'] });
    expect(user.content).toContain('- 物理有 2 次练习的实测还没填');
  });

  it('flags stock phrases and length', () => {
    expect(lintDraft('你展现了认真的态度，继续加油！')).toEqual(expect.arrayContaining(['套话「加油」', '套话「展现」', '套话「态度」']));
    expect(lintDraft('斜面那题受力图画错两次，你后来对着例题改对了。')).toEqual([]);
    expect(lintDraft('字'.repeat(61))[0]).toMatch(/太长/);
  });

  it('parses fenced JSON and drops empty drafts', () => {
    expect(parseDraft('```json\n{"text":"好","evidence":[1,"2"]}\n```')).toEqual({ text: '好', alts: [], evidence: [1, 2] });
    expect(parseDraft('{"text":"好","alts":["甲","","乙"]}').alts).toEqual(['甲', '乙']);
    expect(parseDraft('{"text":""}')).toBeNull();
    expect(parseDraft('not json')).toBeNull();
  });

  it('lint: judgement words are stock phrases, but 稳定 and 懂得 are not', () => {
    expect(lintDraft('这周很用心，掌握了不少。')).toEqual(expect.arrayContaining(['套话「用心」', '套话「掌握了」']));
    expect(lintDraft('现在很稳。')).toEqual(expect.arrayContaining(['套话「很稳」']));
    expect(lintDraft('稳了。')).toEqual(['套话「稳」']);
    expect(lintDraft('这个月记录比较稳定。')).toEqual([]);
    expect(lintDraft('他懂得怎么记。')).toEqual([]);
    expect(lintDraft('我懂了。')).toEqual(['套话「懂了」']);
    expect(lintDraft('字'.repeat(71), 'nudge')[0]).toMatch(/太长/);
  });
});

// 一组贴近真实的输入：周日物理练习 + 复习，周四学过同一章
const R = (date, start, chapter, category, extra = {}) => ({ session_date: date, start_time: `${start}:00`, end_time: '20:30:00', course: 'AP 物理 C 力学', chapter, unit: null, category, form: '自主学习', duration_minutes: 40, self_rating: 80, grade_label: null, notes: null, ...extra });
const ctxRecs = [R('2026-10-22', '19:00', '牛顿定律', 1, { grade_label: null }), R('2026-10-18', '19:00', '摩擦力', 3, { grade_label: 'B-', notes: '最后两题没思路' })];
const dayRecs = [
  R('2026-10-25', '19:10', '牛顿定律', 3, { grade_label: 'B+', notes: '斜面那题受力图错两次，对着例题改了' }),
  R('2026-10-25', '20:05', '牛顿定律', 2),
];
const dailyInput = { kind: 'daily', dayN: 13, records: dayRecs, context: ctxRecs, today: '2026-10-26' };

describe('checkGrounding', () => {
  const input = { ...dailyInput, facts: ['AP 物理 C 力学练习实测：10/18 B-，10/25 B+'] };

  it('passes a clean message that only restates records', () => {
    expect(checkGrounding('斜面那题受力图错两次，你备注写了「对着例题改了」。牛顿定律周四学、周日又复习了。', input)).toEqual([]);
  });

  it('catches an invented grade, but accepts one that is in the records or facts', () => {
    expect(checkGrounding('斜面那组练习实测 A-。', input)).toEqual(['等第「A-」在记录里找不到']);
    expect(checkGrounding('实测 B+，比 B- 好一点。', input)).toEqual([]);
    // 科目名里的 AP 不当作等第
    expect(checkGrounding('AP 物理那节课记上了。', input)).toEqual([]);
  });

  it('catches an invented number and accepts dates, durations and fact numbers', () => {
    expect(checkGrounding('昨天做了 20 道题。', input)).toEqual(['数字「20」在记录里找不到']);
    expect(checkGrounding('10/25 那次练习了 40 分钟，周四 10/22 学的。', input)).toEqual([]);
    // 整数要整体匹配：8 不能借 18、2026 里的数字
    expect(checkGrounding('记了 8 次。', input)).toEqual(['数字「8」在记录里找不到']);
  });

  it('catches a quote that is not a note substring', () => {
    expect(checkGrounding('你备注写了「受力图画错了三次」。', input)).toEqual(['引用「受力图画错了三次」不是备注原文']);
  });

  it('catches judgement words', () => {
    expect(checkGrounding('这周很用心，牛顿定律掌握了。', input)).toEqual(expect.arrayContaining(['套话「用心」', '套话「掌握了」']));
    expect(checkGrounding('比较稳定。', input)).toEqual([]);
  });

  it('catches more than one question', () => {
    expect(checkGrounding('斜面那题后来怎么样？受力图还会错吗？', input)).toContain('问了不止一个问题');
    expect(checkGrounding('斜面那题后来怎么样？', input)).toEqual([]);
  });

  it('reminders: no day count of silence, no urging words', () => {
    const nudge = { kind: 'nudge', records: [], context: ctxRecs, facts: [], nudge: { phase: 'weekly' } };
    expect(checkGrounding('已经 3 天没记了。', nudge)).toEqual(expect.arrayContaining(['提醒里不能说几天没记']));
    expect(checkGrounding('请及时记一条，务必打卡。', nudge)).toEqual(expect.arrayContaining(['提醒里不要用「请」', '提醒里不要用「及时」', '提醒里不要用「务必」', '提醒里不要用「打卡」']));
    expect(checkGrounding('摩擦力那组练习后来怎么样了？有空记一条就行。', nudge)).toEqual([]);
    // 同样的话放在表扬里不按提醒查
    expect(checkGrounding('请看 10/25 那条。', { ...input })).toEqual([]);
  });
});

describe('buildMessages v2', () => {
  const full = {
    ...dailyInput,
    lastSent: { text: '牛顿定律那节你周四学了。', date: '2026-10-23' },
    styleRefs: [{ before: '物理那题你改得不错。', after: '物理斜面那题你改了。' }],
    rejected: ['你这周很用心。'],
    avoidOpenings: ['斜面那题'],
  };
  const [system, user] = buildMessages(full);

  it('puts the user sections in the documented order', () => {
    const marks = ['概况', '#1 ', '#3 · 之前', '上次发给他的消息', '导师之前改过的样子', '不合适的写法', '今天已经用过的开头'].map((m) => user.content.indexOf(m));
    expect(marks.every((i) => i >= 0)).toBe(true);
    expect([...marks].sort((a, b) => a - b)).toEqual(marks);
  });

  it('numbers the period records first and the context after, marked 之前', () => {
    expect(user.content).toMatch(/#1 · 10\/25/);
    expect(user.content).toMatch(/#3 · 之前 · 10\/22/);
    expect(user.content).toMatch(/#4 · 之前 · 10\/18/);
  });

  it('includes the evidence block and the tone examples, and never says 新生', () => {
    expect(system.content).toContain('EVIDENCE');
    expect(system.content).toContain('议论文结构清楚多了');
    for (const kind of ['daily', 'weekly', 'nudge']) {
      for (const combineNudge of [false, true]) {
        const [s, u] = buildMessages({ ...full, kind, combineNudge, issues: ['x'], nudge: { neverRecorded: false, phase: 'first-month' } });
        expect(s.content + u.content).not.toContain('新生');
      }
    }
  });

  it('nudge: uses NUDGE_TASK, lists the earlier records, and has no 要提的问题', () => {
    const [s, u] = buildMessages({ kind: 'nudge', records: [], context: ctxRecs, dayN: 20, nudge: { phase: 'first-month' } });
    expect(s.content).toContain('NUDGE_TASK');
    expect(s.content).not.toContain('COMBINED');
    expect(u.content).toContain('首月');
    expect(u.content).not.toContain('要提的问题');
    expect(u.content).toMatch(/#1 · 之前/);
  });

  it('combined weekly: COMBINED replaces the 要提的问题 rule', () => {
    const [s] = buildMessages({ kind: 'weekly', records: dayRecs, context: [], issues: [], combineNudge: true, nudge: { phase: 'weekly' } });
    expect(s.content).toContain('COMBINED');
    expect(s.content).not.toContain('只写第一部分，不要自己找问题');
  });

  it('old callers that pass only kind, dayN and records still work', () => {
    const [, u] = buildMessages({ kind: 'daily', dayN: 3, records: dayRecs });
    expect(u.content).toContain('这是学生注册后的第 3 天');
    expect(u.content).toContain('#2 ');
  });
});

describe('generateDraft (mocked fetch)', () => {
  const env = { LLM_API_KEY: 'k', LLM_BASE_URL: 'http://llm.test' };
  const reply = (obj) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });
  let calls;
  const mockFetch = (...replies) => {
    calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push(JSON.parse(init.body));
      return replies[Math.min(calls.length - 1, replies.length - 1)];
    });
  };
  afterEach(() => { delete global.fetch; });

  const good = '斜面那题受力图错两次，你备注写了「对着例题改了」。';

  it('returns the C2 shape and drops alts that fail the grounding check', async () => {
    mockFetch(reply({ text: good, alts: ['牛顿定律周四学、周日复习，实测 B+。', '斜面那组练习拿了 A+。', '昨天做了 30 道题。', '牛顿定律这周碰了两次。'], evidence: [1, 3, 99] }));
    const d = await generateDraft(dailyInput, env);
    expect(calls).toHaveLength(1);
    expect(d.text).toBe(good);
    expect(d.alts).toEqual(['牛顿定律周四学、周日复习，实测 B+。', '牛顿定律这周碰了两次。']);
    expect(d.evidence).toEqual([1, 3]);
    expect(d.lint).toEqual([]);
    expect(d.why).toBe('昨天记了 2 条：AP 物理 C 力学');
    expect(d.facts[0]).toContain('AP 物理 C 力学 · 牛顿定律：10/22 学习，10/25 练习，10/25 复习');
  });

  it('retries once with lint and grounding problems listed together', async () => {
    mockFetch(reply({ text: '你很用心，斜面那组练习拿了 A+。', alts: [], evidence: [1] }), reply({ text: good, alts: [], evidence: [1] }));
    const d = await generateDraft(dailyInput, env);
    expect(calls).toHaveLength(2);
    const retryPrompt = calls[1].messages.at(-1).content;
    expect(retryPrompt).toContain('套话「用心」');
    expect(retryPrompt).toContain('等第「A+」在记录里找不到');
    expect(d.text).toBe(good);
    expect(d.lint).toEqual([]);
  });

  it('keeps the draft and reports leftover problems in lint when the retry does not fix it', async () => {
    const bad = '斜面那组练习拿了 A+。';
    mockFetch(reply({ text: bad, alts: [], evidence: [1] }));
    const d = await generateDraft(dailyInput, env);
    expect(calls).toHaveLength(2);
    expect(d.text).toBe(bad);
    expect(d.lint).toEqual(['等第「A+」在记录里找不到']);
  });

  it('weekly without issues keeps only the first paragraph', async () => {
    const input = { kind: 'weekly', records: dayRecs, context: ctxRecs, issues: [] };
    mockFetch(reply({ text: '牛顿定律那组练习实测 B+。\n\n有空记一条吧。', alts: [], evidence: [1] }));
    const d = await generateDraft(input, env);
    expect(d.text).toBe('牛顿定律那组练习实测 B+。');
  });

  it('combineNudge keeps the second paragraph, which is the reminder', async () => {
    const input = { kind: 'weekly', records: dayRecs, context: ctxRecs, issues: [], combineNudge: true, nudge: { neverRecorded: false, phase: 'weekly' }, today: '2026-10-29' };
    const text = '牛顿定律那组练习实测 B+。\n\n之后没看到新的记录，这两天是不是作业多？记一条就行。';
    mockFetch(reply({ text, alts: [], evidence: [1] }));
    const d = await generateDraft(input, env);
    expect(d.text).toBe(text);
    expect(d.lint).toEqual([]);
    expect(d.why).toBe('上周记了 1 天 · 之后 4 天没记');
  });

  it('nudge: facts and the nudge prompt reach the model, and the reminder rules are enforced', async () => {
    const input = { kind: 'nudge', records: [], context: ctxRecs, nudge: { neverRecorded: false, phase: 'weekly' }, today: '2026-10-26', lastSent: null };
    mockFetch(reply({ text: '已经 4 天没记了，请及时记一条。', alts: [], evidence: [] }), reply({ text: '周四牛顿定律那节后来复习了吗？有空记一条就行。', alts: [], evidence: [1] }));
    const d = await generateDraft(input, env);
    expect(calls[0].messages[0].content).toContain('NUDGE_TASK');
    expect(calls[0].messages[1].content).toContain('最后一条：10/22');
    expect(d.text).toBe('周四牛顿定律那节后来复习了吗？有空记一条就行。');
    expect(d.lint).toEqual([]);
    expect(d.why).toBe('4 天没记');
  });

  it('still works for the old call shape (no context, no new fields)', async () => {
    mockFetch(reply({ text: good, evidence: [1] }));
    const d = await generateDraft({ kind: 'daily', dayN: 13, records: dayRecs }, env);
    expect(d.text).toBe(good);
    expect(d.alts).toEqual([]);
    expect(d.evidence).toEqual([1]);
  });

  it('fails clearly without a key or when the model never returns JSON', async () => {
    await expect(generateDraft(dailyInput, {})).rejects.toThrow('LLM_API_KEY');
    mockFetch({ ok: true, json: async () => ({ choices: [{ message: { content: 'nope' } }] }) });
    await expect(generateDraft(dailyInput, env)).rejects.toThrow('没有返回可用的草稿');
  });
});
