import { replaceRecent } from '../src/pages/Learning';

// 编辑记录后「最近记录」的修补：列表必须仍按日期倒序，否则按天分组会出现重复的日期分组
const row = (id, date, extra = {}) => ({ id, session_date: date, ...extra });

describe('replaceRecent', () => {
  const list = [row('a', '2026-11-05'), row('b', '2026-11-05'), row('c', '2026-11-04'), row('d', '2026-11-02')];

  it('日期没变：原地替换，顺序不变', () => {
    const out = replaceRecent(list, row('b', '2026-11-05', { notes: '改了' }));
    expect(out.map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out[1].notes).toBe('改了');
  });

  it('日期改早：挪到新日期的位置，不留旧行', () => {
    const out = replaceRecent(list, row('a', '2026-11-03'));
    expect(out.map(x => x.id)).toEqual(['b', 'c', 'a', 'd']);
    const dates = out.map(x => x.session_date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('日期改晚：挪到最前', () => {
    const out = replaceRecent(list, row('d', '2026-11-05'));
    expect(out.map(x => x.id)).toEqual(['d', 'a', 'b', 'c']);
  });
});
