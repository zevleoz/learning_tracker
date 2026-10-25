import { buildMessages, recordLine, lintDraft, parseDraft } from '../api-lib/supervision-prompt.mjs';

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
    expect(parseDraft('```json\n{"text":"好","evidence":[1,"2"]}\n```')).toEqual({ text: '好', evidence: [1, 2] });
    expect(parseDraft('{"text":""}')).toBeNull();
    expect(parseDraft('not json')).toBeNull();
  });
});
