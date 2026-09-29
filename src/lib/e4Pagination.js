// E4 打印自适应分页：纯函数贪心装箱。
// 输入每个内容单元的实测高度（px），输出每页的单元切片；
// 无 DOM 依赖，可直接单测。表格可在行边界拆分，表头在续页重复。

// units: [{ id, kind: 'block' | 'table', height, rowHeights? }]
// 返回 [[slice...], ...]；slice = { id, kind }（block）或 { id, kind, start, end }（table 行区间，end 不含）
export function paginateUnits(units, pageInnerHeightPx, safetyPx = 0) {
  const usable = Math.max(0, pageInnerHeightPx - safetyPx);
  const pages = [];
  let cur = [];
  let curHeight = 0;

  const flush = () => {
    if (cur.length > 0) pages.push(cur);
    cur = [];
    curHeight = 0;
  };

  for (const u of units) {
    const h = u.height || 0;

    if (u.kind !== 'table') {
      // 单块高于整页：独占一页，允许自然流动（极端情况兜底）
      if (h > usable) {
        flush();
        pages.push([{ id: u.id, kind: u.kind }]);
        continue;
      }
      if (curHeight + h > usable) flush();
      cur.push({ id: u.id, kind: u.kind });
      curHeight += h;
      continue;
    }

    // 表格：表头高度 = 总高 − 行高之和，拆分时每段都计入表头
    const rows = u.rowHeights || [];
    const rowsTotal = rows.reduce((a, b) => a + b, 0);
    const headH = Math.max(0, h - rowsTotal);

    // 整表放得下：当前页或新页直接放
    if (h <= usable && curHeight + h > usable) flush();
    if (h <= usable && curHeight + h <= usable) {
      cur.push({ id: u.id, kind: 'table', start: 0, end: rows.length });
      curHeight += h;
      continue;
    }

    // 需要按行拆分
    let rowIdx = 0;
    while (rowIdx < rows.length) {
      const avail = usable - curHeight - headH;
      let take = 0;
      let takeH = 0;
      while (rowIdx + take < rows.length && takeH + rows[rowIdx + take] <= avail) {
        takeH += rows[rowIdx + take];
        take += 1;
      }
      if (take === 0) {
        if (cur.length > 0) {
          // 当前页放不下任何一行：换页再试
          flush();
          continue;
        }
        // 空页连表头加第一行都放不下：独占一页自然流动（兜底）
        pages.push([{ id: u.id, kind: 'table', start: rowIdx, end: rows.length }]);
        rowIdx = rows.length;
        break;
      }
      cur.push({ id: u.id, kind: 'table', start: rowIdx, end: rowIdx + take });
      curHeight += headH + takeH;
      rowIdx += take;
      if (rowIdx < rows.length) flush();
    }
    // 空表（无行）按 block 处理
    if (rows.length === 0) {
      if (curHeight + h > usable && cur.length > 0) flush();
      cur.push({ id: u.id, kind: 'table', start: 0, end: 0 });
      curHeight += h;
    }
  }
  flush();
  return pages;
}
