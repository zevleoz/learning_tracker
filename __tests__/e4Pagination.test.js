import { paginateUnits } from '../src/lib/e4Pagination.js';

const block = (id, height) => ({ id, kind: 'block', height });
const table = (id, headH, rowHeights) => ({
  id,
  kind: 'table',
  height: headH + rowHeights.reduce((a, b) => a + b, 0),
  rowHeights,
});

describe('paginateUnits', () => {
  it('全部放得下时只产生 1 页', () => {
    const pages = paginateUnits([block('a', 100), block('b', 200)], 1000);
    expect(pages).toEqual([[{ id: 'a', kind: 'block' }, { id: 'b', kind: 'block' }]]);
  });

  it('逐块溢出时开新页', () => {
    const pages = paginateUnits([block('a', 600), block('b', 600)], 1000);
    expect(pages).toEqual([[{ id: 'a', kind: 'block' }], [{ id: 'b', kind: 'block' }]]);
  });

  it('安全余量：贴边高度视为放不下', () => {
    // 可用高度 1000 - 20 = 980
    const pages = paginateUnits([block('a', 985), block('b', 975)], 1000, 20);
    expect(pages).toEqual([[{ id: 'a', kind: 'block' }], [{ id: 'b', kind: 'block' }]]);
  });

  it('表格按行拆分且每段保留行区间', () => {
    const units = [table('t', 100, [200, 200, 200, 200])];
    const pages = paginateUnits(units, 500);
    // 每页可用 500：表头 100 + 2 行 400
    expect(pages).toEqual([
      [{ id: 't', kind: 'table', start: 0, end: 2 }],
      [{ id: 't', kind: 'table', start: 2, end: 4 }],
    ]);
  });

  it('表格整表放得下当前页时不拆分', () => {
    const units = [block('a', 600), table('t', 50, [100, 100])];
    const pages = paginateUnits(units, 1000);
    expect(pages).toEqual([
      [{ id: 'a', kind: 'block' }, { id: 't', kind: 'table', start: 0, end: 2 }],
    ]);
  });

  it('当前页只能放部分行时先放部分、剩余换页', () => {
    const units = [block('a', 400), table('t', 100, [200, 200, 200])];
    const pages = paginateUnits(units, 800);
    // 第一页：400 + 表头100 + 2 行 400 > 800 → 放 1 行（400+100+200=700）
    expect(pages).toEqual([
      [{ id: 'a', kind: 'block' }, { id: 't', kind: 'table', start: 0, end: 1 }],
      [{ id: 't', kind: 'table', start: 1, end: 3 }],
    ]);
  });

  it('单块超高时独占一页', () => {
    const pages = paginateUnits([block('a', 100), block('big', 3000), block('b', 100)], 1000);
    expect(pages).toEqual([
      [{ id: 'a', kind: 'block' }],
      [{ id: 'big', kind: 'block' }],
      [{ id: 'b', kind: 'block' }],
    ]);
  });

  it('单行超高时表格独占一页自然流动', () => {
    const units = [table('t', 100, [5000, 100])];
    const pages = paginateUnits(units, 1000);
    expect(pages).toEqual([[{ id: 't', kind: 'table', start: 0, end: 2 }]]);
  });

  it('空表格按块处理', () => {
    const units = [{ id: 't', kind: 'table', height: 50, rowHeights: [] }];
    const pages = paginateUnits(units, 1000);
    expect(pages).toEqual([[{ id: 't', kind: 'table', start: 0, end: 0 }]]);
  });

  it('空输入返回空页列表', () => {
    expect(paginateUnits([], 1000)).toEqual([]);
  });
});
