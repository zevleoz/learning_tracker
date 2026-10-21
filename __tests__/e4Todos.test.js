import { daysUntil, GROUPS, groupKeyFor } from '../src/lib/e4Todos.js';

describe('groupKeyFor（待办事项归组规则）', () => {
  it('未排期归入「待安排」', () => {
    expect(groupKeyFor(null)).toBe('unscheduled');
  });

  it('日期已过与未排期同等对待，归入「待安排」', () => {
    expect(groupKeyFor(-1)).toBe('unscheduled');
    expect(groupKeyFor(-30)).toBe('unscheduled');
  });

  it('当天归入「今天」', () => {
    expect(groupKeyFor(0)).toBe('today');
  });

  it('未来 7 天内归入「未来 7 天」', () => {
    expect(groupKeyFor(1)).toBe('week');
    expect(groupKeyFor(7)).toBe('week');
  });

  it('8 天及以后归入「之后」', () => {
    expect(groupKeyFor(8)).toBe('later');
    expect(groupKeyFor(30)).toBe('later');
  });
});

describe('GROUPS 互斥且完备', () => {
  it('每个天数恰好命中一个分组', () => {
    const values = [null, -30, -2, -1, 0, 1, 3, 7, 8, 30];
    for (const d of values) {
      const hits = GROUPS.filter((g) => g.match(d));
      expect(hits).toHaveLength(1);
      expect(groupKeyFor(d)).toBe(hits[0].key);
    }
  });
});

describe('daysUntil', () => {
  it('空值返回 null', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('')).toBeNull();
  });

  it('今天返回 0', () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(daysUntil(iso)).toBe(0);
  });

  it('过去日期返回负数', () => {
    expect(daysUntil('2000-01-01')).toBeLessThan(0);
  });
});
