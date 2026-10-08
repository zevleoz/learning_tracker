import { aggregateProgress, hoursMinutes } from '../src/lib/e4ProgressData.js';
import { SUBJECTIVE_STEPS, SUBJECTIVE_LABEL, SUBJECTIVE_LABEL_FORMAL, subjectiveLabel } from '../src/lib/rating.js';

// BUG-7：工作日/周末平均此前按「每段会话」平均，报告文案是「有记录工作日平均」。
describe('aggregateProgress 的工作日/周末平均（按日聚合）', () => {
  const rows = [
    // 2026-03-02 周一：两段会话，合计 90 分钟
    { session_date: '2026-03-02', duration_minutes: 60, course: { name: '数学' }, category: 1 },
    { session_date: '2026-03-02', duration_minutes: 30, course: { name: '数学' }, category: 2 },
    // 2026-03-03 周二：一段 30 分钟
    { session_date: '2026-03-03', duration_minutes: 30, course: { name: '英语' }, category: 1 },
    // 2026-03-07 周六：一段 120 分钟
    { session_date: '2026-03-07', duration_minutes: 120, course: { name: '英语' }, category: 3 },
  ];

  it('按「有记录的日子」平均，而不是按会话平均', () => {
    const agg = aggregateProgress(rows, '2026-03-01', '2026-03-08');
    // 工作日两个：90 与 30 → 平均 60（按会话平均会是 (60+30+30)/3 = 40）
    expect(agg.summary.weekdayAvgMins).toBe(60);
    // 周末一个：120
    expect(agg.summary.weekendAvgMins).toBe(120);
    expect(agg.summary.recordDays).toBe(3);
    expect(agg.summary.totalMinutes).toBe(240);
  });

  it('无记录时平均为 null，日历按日累计', () => {
    const agg = aggregateProgress([], '2026-03-01', '2026-03-08');
    expect(agg.summary.weekdayAvgMins).toBeNull();
    expect(agg.summary.weekendAvgMins).toBeNull();
    expect(agg.calendar).toEqual({});
  });

  it('同一天的分钟数在日历里累计', () => {
    const agg = aggregateProgress(rows, '2026-03-01', '2026-03-08');
    expect(agg.calendar['2026-03-02']).toBe(90);
  });
});

describe('hoursMinutes', () => {
  it('小时与分钟组合', () => {
    expect(hoursMinutes(0)).toBe('');
    expect(hoursMinutes(45)).toBe('45 分钟');
    expect(hoursMinutes(120)).toBe('2 小时');
    expect(hoursMinutes(135)).toBe('2 小时 15 分钟');
  });
});

// BUG-4：主观刻度全平台同源（学生端 20/40/60/80/100）
describe('主观自评刻度（rating.js 单一来源）', () => {
  it('值域固定为 20/40/60/80/100', () => {
    expect(SUBJECTIVE_STEPS.map((s) => s.value)).toEqual([20, 40, 60, 80, 100]);
  });

  it('学生端口径文案与 Learning 录入一致', () => {
    expect(SUBJECTIVE_LABEL[20]).toBe('没有听课');
    expect(SUBJECTIVE_LABEL[100]).toBe('完全掌握');
  });

  it('报告口径与学生端口径值域一致，仅文案不同', () => {
    expect(Object.keys(SUBJECTIVE_LABEL_FORMAL).map(Number).sort((a, b) => a - b))
      .toEqual(SUBJECTIVE_STEPS.map((s) => s.value));
  });

  it('subjectiveLabel 可选口径，未知值返回空串', () => {
    expect(subjectiveLabel(40)).toBe('像在听天书');
    expect(subjectiveLabel(40, { formal: true })).toBe('掌握不足');
    expect(subjectiveLabel(50)).toBe('');
  });
});