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

describe('E4 报告打印纸型（A4 / US Letter）', () => {
  test('不再强制 A4：纸型由打印对话框决定（强制 A4 时选 Letter 会整页缩小，Safari 会溢出成空白页）', () => {
    const block = e4PrintBlock();
    expect(block).toMatch(/@page\s*\{\s*margin:\s*0;\s*\}/);
    expect(block).not.toMatch(/size:\s*A4/);
  });

  test('打印时每页撑满实际纸张，正文列 178mm 居中（与分页测量同宽）', () => {
    const block = e4PrintBlock();
    expect(block).toMatch(/height:\s*calc\(100vh - 0\.5mm\)\s*!important/);
    expect(block).toMatch(/padding-left:\s*calc\(\(100vw - 178mm\) \/ 2\)/);
    expect(block).not.toMatch(/height:\s*279mm/);
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
