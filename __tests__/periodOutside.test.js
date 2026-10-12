import { outsideRangeStats } from '../src/lib/periodOutside.js';

describe('outsideRangeStats · 时段外记录统计', () => {
  test('空数组 → total 0 / earliest null', () => {
    expect(outsideRangeStats([], '2026-10-12', '2026-10-18')).toEqual({ total: 0, earliest: null });
  });

  test('全部在时段内 → total 0', () => {
    const sessions = [{ date: '2026-10-12' }, { date: '2026-10-18' }];
    expect(outsideRangeStats(sessions, '2026-10-12', '2026-10-18').total).toBe(0);
  });

  test('正好落在边界日期 → 算时段内，不计入', () => {
    const sessions = [{ date: '2026-10-12' }, { date: '2026-10-18' }];
    expect(outsideRangeStats(sessions, '2026-10-12', '2026-10-18')).toEqual({ total: 0, earliest: null });
  });

  test('时段外记录：统计数量并给出最早日期', () => {
    const sessions = [
      { date: '2026-10-15' }, // 内
      { date: '2026-10-09' }, // 外（前）
      { date: '2026-09-18' }, // 外（前，最早）
      { date: '2026-10-25' }, // 外（后）
    ];
    expect(outsideRangeStats(sessions, '2026-10-12', '2026-10-18'))
      .toEqual({ total: 3, earliest: '2026-09-18' });
  });

  test('date 含时间后缀（T）也能正确截取日期', () => {
    const sessions = [{ date: '2026-09-30T00:00:00' }];
    expect(outsideRangeStats(sessions, '2026-10-12', '2026-10-18'))
      .toEqual({ total: 1, earliest: '2026-09-30' });
  });

  test('缺失/非法 date 的记录被跳过', () => {
    const sessions = [{ date: null }, { date: '' }, {}, { date: '2026-10-01' }];
    expect(outsideRangeStats(sessions, '2026-10-12', '2026-10-18'))
      .toEqual({ total: 1, earliest: '2026-10-01' });
  });
});
