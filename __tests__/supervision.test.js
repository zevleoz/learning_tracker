import {
  shanghaiToday, addDays, dayNumber, isNewStudent, phaseOf, lastNDays, lastWeekRange, fillSummary, attentionOf,
} from '../src/lib/supervision.js';

describe('supervision rules', () => {
  it('uses the Shanghai date around midnight', () => {
    expect(shanghaiToday(new Date('2026-10-25T15:59:00Z'))).toBe('2026-10-25');
    expect(shanghaiToday(new Date('2026-10-25T16:00:00Z'))).toBe('2026-10-26');
  });

  it('counts signup day as day 1 and switches to weekly after day 30', () => {
    expect(dayNumber('2026-10-01T09:00:00Z', '2026-10-01')).toBe(1);
    expect(dayNumber('2026-10-01', '2026-10-30')).toBe(30);
    expect(isNewStudent('2026-10-01', '2026-10-30')).toBe(true);
    expect(phaseOf('2026-10-01', '2026-10-31')).toBe('weekly');
    expect(phaseOf(null, '2026-10-31')).toBe('weekly');
  });

  it('builds the last 7 days and the previous Monday–Sunday', () => {
    expect(lastNDays('2026-10-26', 7)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
    expect(lastWeekRange('2026-10-26')).toEqual({ start: '2026-10-19', end: '2026-10-25' }); // Monday
    expect(lastWeekRange('2026-10-25')).toEqual({ start: '2026-10-12', end: '2026-10-18' }); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('summarises filled days, yesterday and the gap', () => {
    const s = fillSummary(['2026-10-22', '2026-10-22', '2026-10-25', '2026-09-01', '2026-10-27'], '2026-10-26');
    expect(s.count).toBe(2);
    expect(s.yesterdayFilled).toBe(true);
    expect(s.todayFilled).toBe(false);
    expect(s.lastDate).toBe('2026-10-25');
    expect(s.gap).toBe(1);
    expect(fillSummary([], '2026-10-26')).toMatchObject({ count: 0, lastDate: null, gap: null });
  });

  it('sorts students into the two 今日反馈 lists', () => {
    const today = '2026-10-26';
    const none = fillSummary([], today);
    expect(attentionOf({ signupIso: '2026-10-26', summary: none, todayIso: today })).toBeNull(); // signed up today
    expect(attentionOf({ signupIso: '2026-10-20', summary: none, todayIso: today })).toBe('new-missed-yesterday');
    expect(attentionOf({ signupIso: '2026-10-20', summary: fillSummary(['2026-10-25'], today), todayIso: today })).toBeNull();
    expect(attentionOf({ signupIso: '2026-08-01', summary: fillSummary(['2026-10-23'], today), todayIso: today })).toBe('gap');
    expect(attentionOf({ signupIso: '2026-08-01', summary: fillSummary(['2026-10-24'], today), todayIso: today })).toBeNull();
    expect(attentionOf({ signupIso: '2026-08-01', summary: none, todayIso: today })).toBe('gap');
  });
});
