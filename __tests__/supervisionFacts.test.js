import { buildFacts, MAX_FACTS } from '../api-lib/supervision-facts.mjs';

// 造一条记录：只填测试关心的字段
const rec = (date, course, chapter, category, extra = {}) => ({
  session_date: date, start_time: '19:00:00', end_time: '19:40:00', course, chapter, unit: null,
  category, form: '自主学习', duration_minutes: 40, self_rating: 80, grade_label: null, notes: null, ...extra,
});

const PHYS = 'AP 物理 C 力学';

describe('buildFacts: 概况', () => {
  it('count: daily lists courses by count', () => {
    const records = [rec('2026-10-25', PHYS, '牛顿定律', 1), rec('2026-10-25', PHYS, '牛顿定律', 2, { start_time: '20:00:00' }), rec('2026-10-25', 'IGCSE 数学', '二次函数', 1)];
    const { facts, why } = buildFacts({ kind: 'daily', records, context: [] });
    expect(facts).toContain(`昨天记了 3 条：${PHYS} 2 条、IGCSE 数学 1 条`);
    expect(why).toBe(`昨天记了 3 条：${PHYS}、IGCSE 数学`);
  });

  it('count: weekly counts days and records', () => {
    const records = [rec('2026-10-19', 'A', 'x', 1), rec('2026-10-19', 'A', 'y', 1), rec('2026-10-21', 'A', 'z', 1), rec('2026-10-25', 'B', 'w', 1)];
    const { facts, why } = buildFacts({ kind: 'weekly', records, context: [] });
    expect(facts).toContain('上周有 3 天有记录，共 4 条');
    expect(why).toBe('上周记了 3 天');
  });

  it('chain: same chapter, two or more categories within 7 days, in time order', () => {
    const context = [rec('2026-10-22', PHYS, '牛顿定律', 1)];
    const records = [rec('2026-10-25', PHYS, '牛顿定律', 2), rec('2026-10-25', PHYS, '牛顿定律', 3, { start_time: '20:05:00' })];
    const { facts } = buildFacts({ kind: 'daily', records, context });
    expect(facts[0]).toBe(`${PHYS} · 牛顿定律：10/22 学习，10/25 复习，10/25 练习`);
  });

  it('chain: ignores a chapter whose records are more than 7 days apart or all one category', () => {
    const context = [rec('2026-10-10', PHYS, '牛顿定律', 1)];
    const records = [rec('2026-10-25', PHYS, '牛顿定律', 2)];
    const { facts } = buildFacts({ kind: 'daily', records, context });
    expect(facts.some((f) => f.includes('10/10'))).toBe(false);
  });

  it('revisit: same chapter on three or more different days within 14 days', () => {
    const context = [rec('2026-10-14', 'IGCSE 数学', '导数', 1), rec('2026-10-19', 'IGCSE 数学', '导数', 1), rec('2026-10-22', 'IGCSE 数学', '导数', 1)];
    const records = [rec('2026-10-25', 'IGCSE 数学', '导数', 1)];
    const { facts } = buildFacts({ kind: 'daily', records, context });
    expect(facts).toContain('IGCSE 数学 · 导数 这两周记了 4 天');
  });

  it('revisit: two days is not enough', () => {
    const { facts } = buildFacts({ kind: 'daily', records: [rec('2026-10-25', 'M', '导数', 1)], context: [rec('2026-10-22', 'M', '导数', 1)] });
    expect(facts.some((f) => f.includes('这两周'))).toBe(false);
  });

  it('grade trend: first and last graded practice of one course', () => {
    const context = [rec('2026-10-18', PHYS, '摩擦力', 3, { grade_label: 'B-' }), rec('2026-10-20', PHYS, '摩擦力', 3, { grade_label: 'B' })];
    const records = [rec('2026-10-25', PHYS, '牛顿定律', 3, { grade_label: 'B+' })];
    const { facts } = buildFacts({ kind: 'daily', records, context });
    expect(facts).toContain(`${PHYS}练习实测：10/18 B-，10/25 B+`);
  });

  it('grade trend: needs two graded practices; N/A and unfilled grades do not count', () => {
    const context = [rec('2026-10-18', PHYS, 'a', 3, { grade_label: 'N/A' }), rec('2026-10-19', PHYS, 'b', 3)];
    const records = [rec('2026-10-25', PHYS, 'c', 3, { grade_label: 'B+' })];
    const { facts } = buildFacts({ kind: 'daily', records, context });
    expect(facts.some((f) => f.includes('练习实测'))).toBe(false);
  });

  it('new subject: in this period but not in the previous 30 days', () => {
    const { facts } = buildFacts({ kind: 'daily', records: [rec('2026-10-25', 'IGCSE 化学', '原子', 1)], context: [rec('2026-10-20', 'IGCSE 数学', '导数', 1)] });
    expect(facts).toContain('第一次记IGCSE 化学');
  });

  it('new subject: stays silent when the caller gave no context (cannot tell)', () => {
    const { facts } = buildFacts({ kind: 'daily', records: [rec('2026-10-25', 'IGCSE 化学', '原子', 1)], dayN: 13 });
    expect(facts.some((f) => f.startsWith('第一次'))).toBe(false);
  });

  it('notes: how many period records have notes, only when at least one', () => {
    const records = [rec('2026-10-25', 'A', 'x', 1, { notes: '改了一遍' }), rec('2026-10-25', 'A', 'y', 1), rec('2026-10-25', 'B', 'z', 1, { notes: '  ' })];
    expect(buildFacts({ kind: 'daily', records, context: [] }).facts).toContain('3 条里有 1 条写了备注');
    expect(buildFacts({ kind: 'daily', records: [records[1]], context: [] }).facts.some((f) => f.includes('备注'))).toBe(false);
  });

  it('首月 progress: counts days with records since signup', () => {
    const context = [rec('2026-10-14', 'A', 'x', 1), rec('2026-10-15', 'A', 'x', 1), rec('2026-10-15', 'B', 'y', 1)];
    const { facts } = buildFacts({ kind: 'daily', records: [rec('2026-10-25', 'A', 'x', 1)], context, dayN: 13 });
    expect(facts).toContain('注册第 13 天，有记录的天数 3 天');
    // 过了首月 dayN 为空，不出现
    expect(buildFacts({ kind: 'daily', records: [rec('2026-10-25', 'A', 'x', 1)], context, dayN: null }).facts.some((f) => f.startsWith('注册'))).toBe(false);
  });

  it('exams: the latest one is stated as written', () => {
    const exams = [{ date: '2026-10-09', course: PHYS, name: '单元测验', grade_label: 'B-', score: 71, notes: null }, { date: '2026-10-16', course: PHYS, name: '期中', grade_label: 'B', score: 78 }];
    const { facts } = buildFacts({ kind: 'daily', records: [rec('2026-10-25', PHYS, 'a', 1)], context: [], exams });
    expect(facts).toContain(`考试：10/16 ${PHYS} 期中 B，78 分`);
  });

  it('reminder facts: last record as a full line and the usual weekly rhythm', () => {
    const context = [];
    // 前三周每周 4 天：10/6 起每周一二四五
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-22']) context.push(rec(d, '英语', '词汇', 2));
    context.push(rec('2026-10-23', '英语', '词汇', 2, { start_time: '21:00:00', notes: '把老记混的 8 个词单独抄下来了' }));
    const { facts } = buildFacts({ kind: 'nudge', records: [], context, nudge: { neverRecorded: false, phase: 'weekly' }, today: '2026-10-26' });
    expect(facts[0]).toBe('最后一条：10/23 英语 · 词汇 · 复习 · 备注「把老记混的 8 个词单独抄下来了」');
    expect(facts).toContain('之前一般每周记 4 天');
  });

  it('reminder facts: never-recorded student only gets the 首月 progress line', () => {
    const { facts, why } = buildFacts({ kind: 'nudge', records: [], context: [], dayN: 6, nudge: { neverRecorded: true, phase: 'first-month' }, today: '2026-10-26' });
    expect(facts).toEqual(['注册第 6 天，还没有记录']);
    expect(why).toBe('首月第 6 天 · 还没记过');
  });

  it('why: nudge and combined strings carry the silent day count', () => {
    const context = [rec('2026-10-23', '英语', '词汇', 2)];
    expect(buildFacts({ kind: 'nudge', records: [], context, dayN: 20, nudge: { phase: 'first-month' }, today: '2026-10-26' }).why).toBe('首月 · 3 天没记');
    expect(buildFacts({ kind: 'nudge', records: [], context, nudge: { phase: 'weekly' }, today: '2026-10-26' }).why).toBe('3 天没记');
    const week = [rec('2026-10-19', PHYS, '牛顿定律', 3), rec('2026-10-22', PHYS, '牛顿定律', 3)];
    expect(buildFacts({ kind: 'weekly', records: week, context: [], combineNudge: true, nudge: { phase: 'weekly' }, today: '2026-10-26' }).why).toBe('上周记了 2 天 · 之后 4 天没记');
    expect(buildFacts({ kind: 'weekly', records: week, context: [], issues: ['x'] }).why).toBe('上周记了 2 天 · 有一件事可以问问');
  });

  it('combined weekly: keeps room for the reminder facts and stays within the cap', () => {
    const week = [rec('2026-10-19', PHYS, '牛顿定律', 3, { grade_label: 'B' }), rec('2026-10-20', PHYS, '牛顿定律', 2), rec('2026-10-22', PHYS, '牛顿定律', 3, { grade_label: 'B+', notes: '改了' })];
    const { facts } = buildFacts({ kind: 'weekly', records: week, context: [], combineNudge: true, nudge: { phase: 'weekly' }, today: '2026-10-26' });
    expect(facts.length).toBeLessThanOrEqual(MAX_FACTS);
    expect(facts.some((f) => f.startsWith('最后一条：10/22'))).toBe(true);
  });

  it('edges: a record with no chapter falls back to its unit; with neither it is left out of chains', () => {
    const withUnit = [rec('2026-10-22', 'M', null, 1, { unit: '配方法' }), rec('2026-10-25', 'M', null, 2, { unit: '配方法' })];
    expect(buildFacts({ kind: 'daily', records: [withUnit[1]], context: [withUnit[0]] }).facts[0]).toBe('M · 配方法：10/22 学习，10/25 复习');
    const bare = [rec('2026-10-22', 'M', null, 1), rec('2026-10-25', 'M', null, 2)];
    const { facts } = buildFacts({ kind: 'daily', records: [bare[1]], context: [bare[0]] });
    expect(facts.some((f) => f.includes('·') && f.includes('10/22'))).toBe(false);
  });

  it('edges: never more than six facts, and no adjectives creep in', () => {
    const context = [];
    for (let i = 10; i <= 22; i++) context.push(rec(`2026-10-${i}`, i % 2 ? PHYS : 'IGCSE 数学', i % 2 ? '牛顿定律' : '导数', (i % 3) + 1, { grade_label: i % 3 === 2 ? 'B' : null }));
    const records = [rec('2026-10-25', PHYS, '牛顿定律', 3, { grade_label: 'A-', notes: 'x' }), rec('2026-10-25', 'IGCSE 数学', '导数', 2)];
    const { facts } = buildFacts({ kind: 'daily', records, context, dayN: 20, exams: [{ date: '2026-10-16', course: PHYS, name: '期中', grade_label: 'B' }] });
    expect(facts.length).toBeLessThanOrEqual(MAX_FACTS);
    expect(facts.join('')).not.toMatch(/很|不错|稳|认真|进步|扎实/);
  });
});
