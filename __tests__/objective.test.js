import { objectiveOf, hasObjectiveValue, isObjectiveNA, scoreToGrade, GRADE_SCORE } from '../src/lib/objective.js';
import { generateDiagnosis } from '../src/components/DeepDivePanels.jsx';
import { aggregateProgress } from '../src/lib/e4ProgressData.js';

describe('objectiveOf', () => {
  it('reads v2 letter grades with an empty score', () => {
    expect(objectiveOf({ category: 3, grade_label: 'B+', score: null })).toEqual({ kind: 'grade', label: 'B+', value: GRADE_SCORE['B+'] });
  });
  it('treats N/A as not applicable', () => {
    const row = { category: 3, grade_label: 'N/A', score: null };
    expect(objectiveOf(row)).toEqual({ kind: 'na' });
    expect(hasObjectiveValue(row)).toBe(false);
    expect(isObjectiveNA(row)).toBe(true);
  });
  it('keeps old numeric scores working', () => {
    expect(objectiveOf({ grade_label: null, score: 88 })).toEqual({ kind: 'score', label: 'B+', value: 88 });
  });
  it('returns null for 待补填', () => {
    expect(objectiveOf({ category: 3, grade_label: null, score: null })).toBeNull();
    expect(hasObjectiveValue({ category: 3, grade_label: '', score: '' })).toBe(false);
  });
  it('maps scores to grades on the GRADE_RANGES boundaries', () => {
    expect(scoreToGrade(97)).toBe('A+');
    expect(scoreToGrade(90)).toBe('A-');
    expect(scoreToGrade(69.9)).toBe('D+');
    expect(scoreToGrade(10)).toBe('F');
  });
});

const practice = (date, grade) => ({ date, category: 3, form: '自主练习', duration_minutes: 60, self_rating: 80, grade_label: grade, score: null, subject: '物理' });
const range = (start, end) => ({ start: new Date(`${start}T00:00:00`), end: new Date(`${end}T00:00:00`) });

describe('generateDiagnosis', () => {
  it('does not flag feedback density when practices carry letter grades', () => {
    const sessions = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((d) => practice(d, 'A-'));
    const out = generateDiagnosis(sessions, { range: range('2026-10-19', '2026-10-25'), today: '2026-10-24' });
    expect(out.map((d) => d.title)).not.toContain('练习反馈密度严重不足');
  });

  it('leaves N/A out of the denominator and still flags real 待补填', () => {
    const sessions = [
      practice('2026-10-19', 'N/A'), practice('2026-10-19', 'N/A'),
      practice('2026-10-20', null), practice('2026-10-21', null), practice('2026-10-22', null), practice('2026-10-23', null),
    ];
    const out = generateDiagnosis(sessions, { range: range('2026-10-19', '2026-10-25'), today: '2026-10-24' });
    const density = out.find((d) => d.title === '练习反馈密度严重不足');
    expect(density.detail).toMatch(/^4 次练习中仅 0 次/);
  });

  it('never says 学习行为健康 after 3 days without records', () => {
    const sessions = ['2026-10-19', '2026-10-21', '2026-10-22'].map((d) => ({ ...practice(d, 'A'), category: 2, form: '自主复习' }));
    const out = generateDiagnosis(sessions, { range: range('2026-10-19', '2026-10-25'), today: '2026-10-25' });
    const titles = out.map((d) => d.title);
    expect(titles).toContain('记录在变少');
    expect(titles).not.toContain('学习行为健康');
    expect(out.find((d) => d.title === '记录在变少').detail).toBe('本时段 3/7 天有记录，最近 3 天没有记录（最后一次 10/22）');
  });

  it('counts only elapsed days of the current week', () => {
    const sessions = ['2026-10-19', '2026-10-20'].map((d) => ({ ...practice(d, 'A'), category: 2, form: '自主复习' }));
    const out = generateDiagnosis(sessions, { range: range('2026-10-19', '2026-10-25'), today: '2026-10-21' });
    expect(out.map((d) => d.title)).not.toContain('记录在变少');
  });
});

describe('aggregateProgress 客观 / 主观', () => {
  it('counts letter grades as 客观 and every self_rating as 主观', () => {
    const rows = [
      { session_date: '2026-10-20', duration_minutes: 40, category: 3, form: '自主练习', eval_type: 2, self_rating: 80, grade_label: 'B+', score: null, course: { name: '物理' } },
      { session_date: '2026-10-21', duration_minutes: 40, category: 3, form: '自主练习', eval_type: 2, self_rating: 100, grade_label: 'N/A', score: null, course: { name: '物理' } },
      { session_date: '2026-10-22', duration_minutes: 40, category: 1, form: '自主预习', eval_type: 1, self_rating: 60, grade_label: null, score: null, course: { name: '物理' } },
    ];
    const agg = aggregateProgress(rows, '2026-10-19', '2026-10-25', []);
    const phys = agg.subjects.find((s) => s.subject === '物理');
    expect(phys.evalText).toMatch(/^客观 1 次（平均约 B\+）；主观 3 次/);
  });
});
