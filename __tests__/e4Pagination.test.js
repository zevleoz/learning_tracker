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

  it('较大安全余量（约 6mm≈23px）从每页预算中扣除', () => {
    // 可用高度 1000 - 23 = 977；500 + 480 = 980 在无余量时同页放得下，有余量时必须换页
    const pages = paginateUnits([block('a', 500), block('b', 480)], 1000, 23);
    expect(pages).toEqual([[{ id: 'a', kind: 'block' }], [{ id: 'b', kind: 'block' }]]);
  });

  it('表格后的说明不独占一页：表格最后一行随说明换页（会前准备「排序说明」）', () => {
    // 表格整表 100 + 3×250 = 850 放满第一页，说明 200 放不下 → 原先第二页只有说明
    const units = [table('t', 100, [250, 250, 250]), block('note', 200)];
    expect(paginateUnits(units, 1000)).toEqual([
      [{ id: 't', kind: 'table', start: 0, end: 2 }],
      [{ id: 't', kind: 'table', start: 2, end: 3 }, { id: 'note', kind: 'block' }],
    ]);
  });

  it('末页只剩一个小块时，上一页最后一个块也带过去（首次报告「阅读原则」）', () => {
    const units = [block('a', 300), block('b', 300), block('c', 300), block('tip', 150)];
    expect(paginateUnits(units, 1000)).toEqual([
      [{ id: 'a', kind: 'block' }, { id: 'b', kind: 'block' }],
      [{ id: 'c', kind: 'block' }, { id: 'tip', kind: 'block' }],
    ]);
  });

  it('拆表后末页只剩一行时，再带一行过去（会前准备 Engagement 表）', () => {
    const units = [table('t', 100, [200, 200, 200, 200, 200])];
    expect(paginateUnits(units, 1000)).toEqual([
      [{ id: 't', kind: 'table', start: 0, end: 3 }],
      [{ id: 't', kind: 'table', start: 3, end: 5 }],
    ]);
  });

  it('末页内容够多时不搬', () => {
    const units = [block('a', 500), block('b', 400), block('c', 400)];
    expect(paginateUnits(units, 1000)).toEqual([
      [{ id: 'a', kind: 'block' }, { id: 'b', kind: 'block' }],
      [{ id: 'c', kind: 'block' }],
    ]);
  });

  it('表格只剩一行、或带过去放不下时不搬', () => {
    const one = [block('a', 700), table('t', 100, [150]), block('note', 200)];
    expect(paginateUnits(one, 1000)).toEqual([
      [{ id: 'a', kind: 'block' }, { id: 't', kind: 'table', start: 0, end: 1 }],
      [{ id: 'note', kind: 'block' }],
    ]);
    const tooBig = [table('t', 100, [400, 400]), block('note', 600)];
    expect(paginateUnits(tooBig, 1000)).toEqual([
      [{ id: 't', kind: 'table', start: 0, end: 2 }],
      [{ id: 'note', kind: 'block' }],
    ]);
  });

  it('安全余量同样作用于表格拆行预算', () => {
    // 可用 500 - 50 = 450：表头 100 + 1 行 300 = 400，第二行 300 放不下
    const units = [table('t', 100, [300, 300])];
    const pages = paginateUnits(units, 500, 50);
    expect(pages).toEqual([
      [{ id: 't', kind: 'table', start: 0, end: 1 }],
      [{ id: 't', kind: 'table', start: 1, end: 2 }],
    ]);
  });
});
