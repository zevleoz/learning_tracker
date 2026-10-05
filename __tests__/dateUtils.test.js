import { toLocalDateStr, todayISO, getWeekStart, getWeekEnd, lastNWeeks } from '../src/lib/date.js';

// 回归：session_date 由学生端按本地日期写入（Learning.jsx toDateStr），
// 读取侧若用 toISOString()（UTC）会在 UTC+8 下差一天，
// 导致周复盘 dashboard 在周日看不到学生当天填的记录。
describe('date utils — 本地时区日期', () => {
  describe('toLocalDateStr', () => {
    it('按本地日期格式化，不受 UTC 偏移影响', () => {
      expect(toLocalDateStr(new Date(2026, 9, 5))).toBe('2026-10-05');
      expect(toLocalDateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
    });

    it('本地午夜不会被换算成前一天（UTC+8 下 toISOString 的 bug）', () => {
      // 2026-10-04 是周日；本地午夜的 toISOString() 在 UTC+8 下是 '2026-10-03'
      expect(toLocalDateStr(new Date(2026, 9, 4, 0, 0, 0))).toBe('2026-10-04');
    });

    it('月末/年末边界正确', () => {
      expect(toLocalDateStr(new Date(2026, 8, 30))).toBe('2026-09-30');
      expect(toLocalDateStr(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
    });
  });

  describe('todayISO', () => {
    it('与 toLocalDateStr(new Date()) 一致', () => {
      expect(todayISO()).toBe(toLocalDateStr(new Date()));
    });

    it('支持偏移天数', () => {
      const expected = new Date();
      expected.setDate(expected.getDate() - 29);
      expect(todayISO(-29)).toBe(toLocalDateStr(expected));
    });
  });

  describe('getWeekStart / getWeekEnd', () => {
    it('周日归属本周：start=本周一，end=当周周日（当天）', () => {
      // 2026-10-04 是周日，本周一为 2026-09-28
      expect(getWeekStart('2026-10-04')).toBe('2026-09-28');
      expect(getWeekEnd('2026-10-04')).toBe('2026-10-04');
    });

    it('周一 start/end 为同一周', () => {
      // 2026-10-05 是周一
      expect(getWeekStart('2026-10-05')).toBe('2026-10-05');
      expect(getWeekEnd('2026-10-05')).toBe('2026-10-11');
    });

    it('周六 end 为次日周日', () => {
      expect(getWeekEnd('2026-10-03')).toBe('2026-10-04');
    });
  });

  describe('lastNWeeks', () => {
    it('返回 N 个周一，最后一个为本周一（本地日期）', () => {
      const weeks = lastNWeeks(4);
      expect(weeks).toHaveLength(4);
      expect(weeks[3]).toBe(getWeekStart(todayISO()));
      for (const w of weeks) expect(w).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
