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

    // 整表放得下当前页：直接放；否则按行拆分填满当前页
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
  avoidOrphanLastPage(pages, units, usable);
  return pages;
}

// 防孤页：本组（章节）最后一页只剩一小段文字（如表格后的「排序说明」、首次报告的「阅读原则」），
// 上一页却塞满。把上一页最后一个块、或表格最后一行（表头在续页重复）带过来，两页不再一满一空。
const ORPHAN_RATIO = 1 / 3;

function avoidOrphanLastPage(pages, units, usable) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const headHeight = (u) => Math.max(0, (u.height || 0) - (u.rowHeights || []).reduce((a, b) => a + b, 0));
  const pageHeight = (page) => page.reduce((sum, s) => {
    const u = byId.get(s.id);
    if (s.kind !== 'table') return sum + (u.height || 0);
    const rows = (u.rowHeights || []).slice(s.start, s.end);
    return sum + headHeight(u) + rows.reduce((a, b) => a + b, 0);
  }, 0);

  if (pages.length < 2) return;
  const page = pages[pages.length - 1];
  const prev = pages[pages.length - 2];
  // 末页已有一定内容不动
  if (pageHeight(page) >= usable * ORPHAN_RATIO) return;
  const last = prev[prev.length - 1];
  const u = byId.get(last.id);

  // 末页只有拆表剩下的一行：从上一页再带一行过来（上一页至少留两行）
  if (page[0].kind === 'table') {
    const cont = page[0];
    if (page.length !== 1 || last.id !== cont.id || last.end !== cont.start
      || cont.end - cont.start !== 1 || last.end - last.start < 3) return;
    if (pageHeight(page) + u.rowHeights[last.end - 1] > usable) return;
    last.end -= 1;
    cont.start = last.end;
    return;
  }

  if (last.kind !== 'table') {
    // 上一页至少留一个块
    if (prev.length < 2 || pageHeight(page) + (u.height || 0) > usable) return;
    page.unshift(prev.pop());
    return;
  }
  const rowCount = (u.rowHeights || []).length;
  // 只处理「表格末段 → 紧跟的块」，且上一页至少留一行
  if (last.end !== rowCount || last.end - last.start < 2) return;
  if (pageHeight(page) + headHeight(u) + u.rowHeights[last.end - 1] > usable) return;
  last.end -= 1;
  page.unshift({ id: last.id, kind: 'table', start: last.end, end: rowCount });
}
