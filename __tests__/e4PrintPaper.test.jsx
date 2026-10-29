import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import ProgressPrint from '../src/components/e4/ProgressPrint.jsx';
import { buildProgressDraft } from '../src/lib/e4ProgressTemplate.js';

const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

function e4PrintBlock() {
  // E4 打印规则所在的 @media print 块（含 .e4-print-page.e4-page-shell）
  const start = css.indexOf('@media print {\n  /* 不强制纸型');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('E4 应用 UI 升级', start));
}

const autoPages = fs.readFileSync(path.join(__dirname, '../src/components/e4/AutoPages.jsx'), 'utf8');

describe('E4 报告打印纸型（A4 / US Letter，Safari 与 Chrome）', () => {
  test('不强制 A4：Safari 会按 297mm 排版却打在 Letter 纸上，隔页空白', () => {
    const block = e4PrintBlock();
    expect(block).toMatch(/@page\s*\{\s*margin:\s*0;\s*\}/);
    expect(block).not.toMatch(/size:\s*A4/);
  });

  test('打印规则不用 vw/vh：Safari 打印时它们是窗口尺寸，会把整页撑宽挤出纸外', () => {
    const rules = e4PrintBlock().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\d*v[wh]\b/);
  });

  test('页面 210×270mm：Chrome 原尺寸放得下 A4 / Letter；Safari 打印 Letter 按纸宽放大 215.9/210 后仍在 279.4mm 内', () => {
    const block = e4PrintBlock();
    expect(block).toMatch(/width:\s*210mm\s*!important/);
    expect(block).toMatch(/height:\s*270mm\s*!important/);
    expect(270 * (215.9 / 210)).toBeLessThanOrEqual(279.4);
  });

  test('页内版心：章节条 12–18mm，正文从 23mm 起（下划线不压标题），页脚距页底 8mm', () => {
    expect(css).toMatch(/top: 12mm; left: 20mm; right: 20mm;/);
    expect(css).toMatch(/padding: 23mm 16mm 19mm;/);
    expect(css).toMatch(/bottom: 8mm; left: 16mm; right: 16mm;/);
    expect(12 + 6.2).toBeLessThan(23);
  });

  test('分页预算与版心一致：Chrome 等 270 − 23 − 19 = 228mm，Safari 250 − 21 − 16 = 213mm', () => {
    expect(autoPages).toMatch(/const INNER_HEIGHT_MM = IS_SAFARI \? 213 : 228;/);
    expect(css).toMatch(/html\.e4-safari \.e4-print-page\.e4-page-shell \{ min-height: 250mm; padding-top: 21mm; padding-bottom: 16mm; \}/);
  });

  test('Safari：250mm 页面无论 Safari 是否在纸顶多出约 21.2mm，按纸宽放大后都放得进 Letter（270mm 会把页脚挤到下一张纸）', () => {
    expect(e4PrintBlock()).toMatch(/html\.e4-safari \.e4-print-page\.e4-page-shell \{ height: 250mm !important; \}/);
    const scale = 215.9 / 210;
    expect(21.2 + 250 * scale).toBeLessThanOrEqual(279.4);
    expect(21.2 + 270 * scale).toBeGreaterThan(279.4);
  });
});

describe('Safari 识别（只认 Safari，不把 Chrome / Edge 当成 Safari）', () => {
  const load = (ua) => {
    let mod;
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
    document.documentElement.classList.remove('e4-safari');
    jest.isolateModules(() => { mod = require('../src/lib/e4Browser.js'); });
    return mod.IS_SAFARI;
  };

  test.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15', true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', false],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', false],
  ])('%s → %s', (ua, expected) => {
    expect(load(ua)).toBe(expected);
    expect(document.documentElement.classList.contains('e4-safari')).toBe(expected);
  });
});

describe('过程报告走自适应分页（之前固定 8 页，内容超高时溢出纸张、Letter 下多出空白页）', () => {
  const draft = buildProgressDraft(
    { subjects: [{ subject: '数学', minutes: 120, sharePct: 100 }] },
    { display_name: 'Ethan' },
    { periodStart: '2026-10-01', periodEnd: '2026-10-14' },
  );

  test('8 个章节各有页壳，页脚为「第 n 页 / 共 n 页」', () => {
    const { container } = render(<ProgressPrint report={{ form_data: draft }} />);
    expect(container.querySelectorAll('.e4-print-doc.e4-progress-doc .e4-page-shell')).toHaveLength(8);
    expect(screen.getByText('第 1 页 / 共 8 页')).toBeInTheDocument();
    expect(screen.getAllByText('数学').length).toBeGreaterThan(0);
  });

  test('可编辑模式仍有加行按钮', () => {
    render(<ProgressPrint report={{ form_data: draft }} editable onPatch={() => {}} onTableOp={() => {}} />);
    expect(screen.getByText('+ 添加学科行')).toBeInTheDocument();
    expect(screen.getByText('+ 添加问题行')).toBeInTheDocument();
    expect(screen.getByText('+ 添加一条方案')).toBeInTheDocument();
  });
});
